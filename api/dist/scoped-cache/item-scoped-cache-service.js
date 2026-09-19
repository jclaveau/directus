import { scopedCachePurgeEnabled } from "./config.js";
import { scopedCacheMaxPinsPerCollection, scopedCacheTagKey, scopedCacheTagsFromRows } from "./tags.js";
import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { composeScopedCachePaths, resolveScopedCacheM2oJoinChainFromPath } from "./paths.js";
import { scopedCacheOwnershipInjections } from "./ownership-injection.js";
import { pinnedScopedCacheTagsFromFilter, scopedCacheNestedCollections, scopedCachePathReversesChain } from "./read-tags.js";
import { collectionsInFieldMap } from "../permissions/modules/process-ast/utils/collections-in-field-map.js";
import { ScopedCacheReadPlan } from "./read-plan.js";
import emitter_default from "../emitter.js";
import { purgeScopedCache } from "./purge.js";
import { randomUUID } from "node:crypto";

//#region src/scoped-cache/item-scoped-cache-service.ts
/**
* Stateless read-side metadata for a collection's scoped cache. Derives the flat
* fields, dotted paths, terminal types and related primary keys the snapshot and
* read-tag assembly consume. Every member is a pure function of (collection,
* schema), both fixed for the owning ItemsService, so the getters memoize on
* first access.
*/
var ItemScopedCacheService = class ItemScopedCacheService {
	collection;
	schema;
	knex;
	cache;
	accountability;
	fieldsMemo;
	flatFieldsMemo;
	pathsMemo;
	fieldTypesMemo;
	relatedPksMemo;
	constructor(collection, schema, knex, cache, accountability) {
		this.collection = collection;
		this.schema = schema;
		this.knex = knex;
		this.cache = cache;
		this.accountability = accountability;
	}
	get fields() {
		return this.fieldsMemo ??= this.schema.collections[this.collection]?.scopedCacheFields ?? [];
	}
	get flatFields() {
		return this.flatFieldsMemo ??= this.fields.filter((field) => !field.includes("."));
	}
	get paths() {
		if (this.pathsMemo) return this.pathsMemo;
		const byField = /* @__PURE__ */ new Map();
		const addPath = (field) => {
			if (byField.has(field)) return;
			const resolved = this.resolvePath(field);
			if (resolved) byField.set(field, {
				field,
				segments: resolved.segments
			});
		};
		for (const field of this.fields) if (field.includes(".")) addPath(field);
		for (const { field } of composeScopedCachePaths(this.schema, this.collection)) addPath(field);
		return this.pathsMemo = [...byField.values()];
	}
	resolvePath(path) {
		const segments = path.split(".");
		if (segments.length < 2) return null;
		const joins = resolveScopedCacheM2oJoinChainFromPath(this.schema, this.collection, segments.slice(0, -1));
		if (joins === null) return null;
		return {
			segments,
			joins,
			terminalCollection: joins[joins.length - 1].relatedCollection,
			terminalField: segments[segments.length - 1]
		};
	}
	get fieldTypes() {
		if (this.fieldTypesMemo) return this.fieldTypesMemo;
		const rootFields = this.schema.collections[this.collection]?.fields ?? {};
		const types = {};
		const primaryKeyField = this.schema.collections[this.collection]?.primary;
		if (primaryKeyField !== void 0) types[primaryKeyField] = rootFields[primaryKeyField]?.type;
		for (const field of this.flatFields) types[field] = rootFields[field]?.type;
		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);
			if (!resolved) continue;
			types[field] = this.schema.collections[resolved.terminalCollection]?.fields[resolved.terminalField]?.type;
		}
		return this.fieldTypesMemo = types;
	}
	get relatedPks() {
		if (this.relatedPksMemo) return this.relatedPksMemo;
		const map = {};
		const addRelatedPk = (field, fromCollection, fromField) => {
			const relatedCollection = this.schema.relations.find((rel) => {
				return rel.collection === fromCollection && rel.field === fromField;
			})?.related_collection;
			const primaryKey = relatedCollection ? this.schema.collections[relatedCollection]?.primary : void 0;
			if (primaryKey) map[field] = primaryKey;
		};
		for (const field of this.flatFields) addRelatedPk(field, this.collection, field);
		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);
			if (resolved) addRelatedPk(field, resolved.terminalCollection, resolved.terminalField);
		}
		return this.relatedPksMemo = map;
	}
	/**
	* Snapshot the current scope values for the given keys as scoped cache tags,
	* before a mutation runs. Snapshots the *old* values an update/delete is
	* about to change so their slices get purged (an update that moves a row from
	* `student=A` to `student=B` must drop both). Returns an empty list when
	* there are no keys (a collection-level purge then suffices).
	*
	* Always emits the primary-key slice of every key, on every collection, whether it
	* declares scope fields or not: the read side pins that axis on every collection,
	* and a read pinning an axis the write never emits is never purged — stale, which
	* is worse than any hit ratio. It costs no query, since the keys are already here.
	*/
	async snapshot(keys) {
		if (!scopedCachePurgeEnabled() || keys.length === 0) return [];
		const primaryKeyField = this.schema.collections[this.collection]?.primary;
		if (primaryKeyField === void 0) return [];
		const fieldTypes = this.fieldTypes;
		const tags = keys.map((key) => {
			return {
				collection: this.collection,
				field: primaryKeyField,
				value: key,
				type: fieldTypes[primaryKeyField]
			};
		});
		const valueSliceTags = await this.snapshotValueSliceTags(keys, fieldTypes);
		if (valueSliceTags === null) return null;
		tags.push(...valueSliceTags);
		return tags;
	}
	/**
	* Every value slice the mutated rows sit in right now: the flat columns the
	* collection scopes on, plus the terminal value each path scope resolves to
	* through its M2O join chain. The mutated row carries only the first-hop fk, so
	* the ancestor joins recover the SAME terminals the read side pinned — the
	* identical `field=<path>` slices.
	*
	* One query for all of it, not one per path and one more for the flat columns.
	* The joins already select FROM the mutated collection, so its own columns ride
	* along, and composition derives the paths by extending each other
	* (`teaching_unit.discipline`, then `teaching_unit.discipline.enrollment`) so a
	* join keyed by the segments leading to it is shared and each further path costs
	* at most one more join. A M2O join cannot multiply the rows it is read from, so
	* the flat columns read the same as they did on their own query.
	*/
	async snapshotValueSliceTags(keys, fieldTypes) {
		const flatFields = this.flatFields;
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const aliasByLeadingSegments = /* @__PURE__ */ new Map();
		const terminalRefByPath = [];
		let query = this.knex.from({ root: this.collection });
		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);
			if (!resolved) continue;
			let leadingSegments = "";
			let prevAlias = "root";
			for (const join of resolved.joins) {
				leadingSegments = `${leadingSegments}.${join.field}`;
				let alias = aliasByLeadingSegments.get(leadingSegments);
				if (alias === void 0) {
					alias = `p${aliasByLeadingSegments.size}`;
					aliasByLeadingSegments.set(leadingSegments, alias);
					query = query.leftJoin({ [alias]: join.relatedCollection }, `${alias}.${join.relatedPk}`, `${prevAlias}.${join.field}`);
				}
				prevAlias = alias;
			}
			terminalRefByPath.push({
				field,
				terminalRef: `${prevAlias}.${resolved.terminalField}`
			});
		}
		if (flatFields.length === 0 && terminalRefByPath.length === 0) return [];
		const rows = await query.select([...[...new Set([primaryKeyField, ...flatFields])].map((field) => {
			return this.knex.ref(`root.${field}`).as(field);
		}), ...terminalRefByPath.map(({ terminalRef }, index) => {
			return this.knex.ref(terminalRef).as(`value${index}`);
		})]).whereIn(`root.${primaryKeyField}`, keys);
		const tags = [];
		if (flatFields.length > 0) {
			const flatTags = scopedCacheTagsFromRows(this.collection, flatFields, rows, "coarse", fieldTypes);
			if (flatTags === null) return null;
			tags.push(...flatTags);
		}
		terminalRefByPath.forEach(({ field }, index) => {
			tags.push(...scopedCacheTagsFromRows(this.collection, [field], rows.map((row) => ({ [field]: row[`value${index}`] })), "skip", { [field]: fieldTypes[field] }));
		});
		return tags;
	}
	/**
	* The rows a delete REWRITES rather than removes: children reaching the deleted
	* keys through a direct self-relation whose `on_delete` sets the fk to null or
	* to its default. The database changes them under the delete, so they are
	* snapshotted like an update — old slices before, new slices after — and none
	* of the slices they sit in stays warm: their key, every scope field, the
	* `<fk>=<deleted>` slice they leave and the one they land in.
	*
	* A self-relation that CASCADES is not here: its children go with the parent,
	* and `scopedCacheCollectionsChangedByOnDelete` takes the whole collection.
	* Nothing to read costs no query.
	*/
	async selfRelationSurvivorKeys(deletedKeys) {
		const primaryKeyField = this.schema.collections[this.collection]?.primary;
		if (!scopedCachePurgeEnabled() || deletedKeys.length === 0 || primaryKeyField === void 0) return [];
		const rewritingFields = this.schema.relations.filter((relation) => {
			const rule = relation.schema?.on_delete;
			return relation.collection === this.collection && relation.related_collection === this.collection && (rule === "SET NULL" || rule === "SET DEFAULT");
		}).map((relation) => relation.field);
		if (rewritingFields.length === 0) return [];
		const rows = await this.knex.select(primaryKeyField).from(this.collection).where((builder) => {
			for (const field of rewritingFields) builder.orWhereIn(field, deletedKeys);
		}).whereNotIn(primaryKeyField, deletedKeys);
		return [...new Set(rows.map((row) => row[primaryKeyField]))];
	}
	/**
	* Ownership ancestors to nest into the read so the scope pins them by key rather
	* than by the bare tag a `fields: ['*']` read would over-purge on. Stripped from
	* the response again once the tags are built.
	*/
	ownershipInjections(query) {
		if (!scopedCachePurgeEnabled()) return [];
		return scopedCacheOwnershipInjections(this.schema, this.collection, query.fields ?? []);
	}
	/**
	* Everything this read's tags need that the AST alone decides, resolved before
	* the query runs. The plan fills its own row-dependent half from inside it.
	*/
	planRead(ast, injections) {
		return new ScopedCacheReadPlan(this.collection, this.schema, ast, injections);
	}
	/**
	* Event context handed to the `cache.purge` filter so extensions can resolve their
	* own tags.
	*/
	purgeContext() {
		return {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		};
	}
	async purge(tags, collector, changedCollections = [], { includeCollectionTag = true } = {}) {
		const cache = this.cache;
		if (cache === null) return [];
		const context = this.purgeContext();
		const hookTags = collector?.tags ?? [];
		const ownTags = changedCollections.includes(this.collection) ? null : tags;
		const otherCollections = scopedCachePurgeEnabled() ? changedCollections.filter((changedCollection) => {
			return changedCollection !== this.collection;
		}) : [];
		if (ownTags !== null && otherCollections.length === 0) {
			const ownAndHookTags = [...ownTags, ...hookTags];
			if (includeCollectionTag) return purgeScopedCache(cache, this.collection, ownAndHookTags, context);
			return purgeScopedCache(cache, this.collection, ownAndHookTags, context, { includeCollectionTag: false });
		}
		const scopedCachePurgeId = randomUUID();
		const purgedTagSets = [];
		if (ownTags !== null) purgedTagSets.push(await purgeScopedCache(cache, this.collection, [...ownTags, ...hookTags], context, { scopedCachePurgeId }));
		else {
			purgedTagSets.push(await purgeScopedCache(cache, this.collection, null, context, { scopedCachePurgeId }));
			if (hookTags.length > 0) purgedTagSets.push(await purgeScopedCache(cache, this.collection, hookTags, context, {
				includeCollectionTag: false,
				scopedCachePurgeId
			}));
		}
		purgedTagSets.push(...await Promise.all(otherCollections.map((changedCollection) => {
			return purgeScopedCache(cache, changedCollection, null, context, { scopedCachePurgeId });
		})));
		return purgedTagSets.some((tagSet) => tagSet === null) ? null : purgedTagSets.flatMap((tagSet) => tagSet ?? []);
	}
	/**
	* The scoped-cache tags this read depends on. The root collection gets value
	* slices only when the query filter *bounds* it to those values
	* (`pinnedScopedCacheTagsFromFilter`), so one owner's/partition's later write
	* drops only their entries. An unbounded root (no scope-field filter — e.g. an
	* admin list) and every other touched collection fall back to a bare collection
	* tag, so any write to them invalidates the read (a value-slice tag would miss
	* an insert of a brand-new value). The `cache.scope` filter lets extensions
	* augment these (resolve M2M owners, or tag a collection an `items.read` hook
	* enriched from); it receives the enriched `records`. Whatever they add must be
	* reproducible on the `cache.purge` side or it leaks. Returns the tags plus any
	* unautopurgeable scopeTo tags respond.ts leaves the read uncached for.
	*/
	async readTags(inputs) {
		const { ast, plan, updatedQuery, filteredRecords, collector: scopedCacheCollector } = inputs;
		let tags = [];
		let unautopurgeable = [];
		if (!scopedCachePurgeEnabled()) return {
			tags,
			unautopurgeable
		};
		const { fieldMap, filterKeying, keyedFilterPins, m2oParentPins, o2mChildPins, o2mConflicted, beyondNestedRows } = plan;
		const nestedCollections = scopedCacheNestedCollections(ast);
		const rootPaths = /* @__PURE__ */ new Set();
		for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) if (entry.collection === this.collection) rootPaths.add(path);
		const rootScopedCacheTags = rootPaths.size > 1 ? [] : pinnedScopedCacheTagsFromFilter(this.collection, this.flatFields, joinFilterWithCases(updatedQuery.filter, ast.cases), this.fieldTypes, this.relatedPks, this.paths, this.schema.collections[this.collection]?.primary);
		const taggedCollections = new Set([...collectionsInFieldMap(fieldMap), ...filterKeying.keys()]);
		const pathsTo = (collection, groups = [fieldMap.read, fieldMap.other]) => {
			const paths = /* @__PURE__ */ new Set();
			for (const group of groups) for (const [path, entry] of group) if (entry.collection === collection) paths.add(path);
			return [...paths];
		};
		const isToOnePath = (path) => {
			return resolveScopedCacheM2oJoinChainFromPath(this.schema, this.collection, plan.unaliased(path)) !== null;
		};
		const effectiveFilter = joinFilterWithCases(updatedQuery.filter, ast.cases);
		const rootPrimary = this.schema.collections[this.collection]?.primary;
		const rootKeyPins = rootPaths.size > 1 || rootPrimary === void 0 ? [] : pinnedScopedCacheTagsFromFilter(this.collection, [], effectiveFilter, this.fieldTypes, {}, [], rootPrimary);
		const slicesMemo = /* @__PURE__ */ new Map();
		const relatedServices = /* @__PURE__ */ new Map();
		const relatedServiceOf = (collection) => {
			const memoized = relatedServices.get(collection);
			if (memoized) return memoized;
			const related = new ItemScopedCacheService(collection, this.schema, this.knex, this.cache, this.accountability);
			relatedServices.set(collection, related);
			return related;
		};
		const slicesOf = (collection) => {
			const memoized = slicesMemo.get(collection);
			if (memoized) return memoized;
			const related = relatedServiceOf(collection);
			const primary = this.schema.collections[collection]?.primary;
			const slices = [...(primary === void 0 ? related.flatFields : [primary, ...related.flatFields]).map((field) => ({
				field,
				segments: [field]
			})), ...related.paths.map(({ field, segments }) => ({
				field,
				segments
			}))];
			slicesMemo.set(collection, slices);
			return slices;
		};
		const sliceTagsFor = (collection) => {
			if (collection === this.collection) return [];
			const paths = pathsTo(collection);
			if (paths.length === 0 || paths.includes("")) return [];
			const nestedRowsBounded = m2oParentPins.has(collection) || o2mChildPins.has(collection) || pathsTo(collection, [fieldMap.other]).every(isToOnePath);
			const fieldTypes = this.schema.collections[collection]?.fields ?? {};
			for (const slice of slicesOf(collection)) {
				const prefix = slice.segments.slice(0, -1);
				const terminalCollection = prefix.length > 0 ? resolveScopedCacheM2oJoinChainFromPath(this.schema, collection, prefix)?.[prefix.length - 1]?.relatedCollection : collection;
				const terminalField = slice.segments[slice.segments.length - 1];
				if (terminalCollection === void 0) continue;
				const type = prefix.length > 0 ? this.schema.collections[terminalCollection]?.fields[terminalField]?.type : fieldTypes[terminalField]?.type;
				if (paths.every((path) => {
					return scopedCachePathReversesChain(this.schema, this.collection, plan.unaliased(path), collection, slice.segments);
				}) && rootKeyPins.length > 0) return rootKeyPins.map((pin) => {
					return {
						collection,
						field: slice.field,
						value: pin.value,
						type
					};
				});
				if (!nestedRowsBounded) continue;
				const relatedPk = (() => {
					const target = this.schema.relations.find((rel) => {
						return rel.collection === terminalCollection && rel.field === terminalField;
					})?.related_collection;
					return target ? this.schema.collections[target]?.primary : void 0;
				})();
				const bound = /* @__PURE__ */ new Map();
				let everyPathBound = true;
				for (const path of paths) {
					const fields = plan.unaliased(path);
					const prefixed = `${fields.join(".")}.${slice.field}`;
					const relatedPks = relatedPk === void 0 ? {} : { [prefixed]: relatedPk };
					const tags$1 = pinnedScopedCacheTagsFromFilter(this.collection, [], effectiveFilter, { [prefixed]: type }, relatedPks, [{
						field: prefixed,
						segments: [...fields, ...slice.segments]
					}]);
					if (tags$1.length === 0) {
						everyPathBound = false;
						break;
					}
					for (const { value } of tags$1) {
						const sliced = {
							collection,
							field: slice.field,
							value,
							type
						};
						bound.set(scopedCacheTagKey(sliced), sliced);
					}
				}
				if (everyPathBound && bound.size > 0 && bound.size <= scopedCacheMaxPinsPerCollection()) return [...bound.values()];
			}
			return [];
		};
		const nodeBoundTagsFor = (collection) => {
			const bounds = plan.nodeBounds.get(collection) ?? [];
			if (collection === this.collection || bounds.length === 0) return [];
			const related = relatedServiceOf(collection);
			const bound = /* @__PURE__ */ new Map();
			for (const nodeBound of bounds) {
				const nodeTags = nodeBound === null ? [] : pinnedScopedCacheTagsFromFilter(collection, related.flatFields, nodeBound, related.fieldTypes, related.relatedPks, related.paths, this.schema.collections[collection]?.primary);
				if (nodeTags.length === 0) return [];
				for (const tag of nodeTags) bound.set(scopedCacheTagKey(tag), tag);
			}
			return bound.size <= scopedCacheMaxPinsPerCollection() ? [...bound.values()] : [];
		};
		const pushNodeBoundOrBare = (collection, pins) => {
			const nodeTags = nodeBoundTagsFor(collection);
			if (nodeTags.length === 0) {
				tags.push({ collection });
				return;
			}
			for (const tag of nodeTags) pins.set(scopedCacheTagKey(tag), tag);
			tags.push(...pins.values());
		};
		const pushSliceOrBare = (collection, pins) => {
			const sliceTags = sliceTagsFor(collection);
			if (sliceTags.length > 0) {
				tags.push(...sliceTags);
				return;
			}
			pushNodeBoundOrBare(collection, pins);
		};
		for (const collection of taggedCollections) {
			if (collection === this.collection && rootScopedCacheTags.length > 0) {
				tags.push(...rootScopedCacheTags);
				continue;
			}
			const pins = /* @__PURE__ */ new Map();
			for (const pin of [
				...m2oParentPins.get(collection) ?? [],
				...o2mChildPins.get(collection) ?? [],
				...keyedFilterPins.get(collection) ?? []
			]) pins.set(scopedCacheTagKey(pin), pin);
			if (o2mConflicted.has(collection)) {
				if (beyondNestedRows.has(collection)) {
					tags.push({ collection });
					continue;
				}
				pushNodeBoundOrBare(collection, pins);
				continue;
			}
			if (collection !== this.collection && filterKeying.get(collection)?.kind === "independent" && !nestedCollections.has(collection) && !beyondNestedRows.has(collection)) continue;
			if (beyondNestedRows.has(collection)) {
				const sliceTags = sliceTagsFor(collection);
				if (sliceTags.length === 0) {
					tags.push({ collection });
					continue;
				}
				for (const tag of sliceTags) pins.set(scopedCacheTagKey(tag), tag);
				tags.push(...pins.values());
				continue;
			}
			const paths = pathsTo(collection);
			if (paths.length > 0 && paths.every((path) => plan.injectedAncestorPaths.has(path))) {
				tags.push(...pins.values());
				continue;
			}
			if (nestedCollections.has(collection) && !m2oParentPins.has(collection) && !o2mChildPins.has(collection)) {
				pushSliceOrBare(collection, pins);
				continue;
			}
			if (pins.size === 0) {
				pushSliceOrBare(collection, pins);
				continue;
			}
			tags.push(...pins.values());
		}
		const computedTagKeys = new Set(tags.map(scopedCacheTagKey));
		tags = await emitter_default.emitFilter("cache.scope", tags, {
			collection: this.collection,
			query: updatedQuery,
			records: filteredRecords
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
		tags.push(...scopedCacheCollector.tags);
		const seenTagKeys = new Set(tags.map(scopedCacheTagKey));
		const crossedTags = [];
		tags = tags.map((tag) => {
			if (tag.field === void 0 || !tag.field.includes(".") || !slicesOf(tag.collection).some(({ field }) => field === tag.field)) return tag;
			const resolved = new ItemScopedCacheService(tag.collection, this.schema, this.knex, this.cache, this.accountability).resolvePath(tag.field);
			if (resolved === null) return tag;
			const { segments, joins, terminalCollection, terminalField } = resolved;
			const type = tag.type ?? this.schema.collections[terminalCollection]?.fields[terminalField]?.type;
			for (const [hop, join] of joins.entries()) {
				const crossed = join.relatedCollection;
				const suffix = segments.slice(hop + 1).join(".");
				const crossedTag = slicesOf(crossed).some(({ field }) => field === suffix) ? {
					collection: crossed,
					field: suffix,
					value: tag.value,
					type
				} : { collection: crossed };
				const crossedKey = scopedCacheTagKey(crossedTag);
				if (!seenTagKeys.has(crossedKey)) {
					seenTagKeys.add(crossedKey);
					crossedTags.push(crossedTag);
				}
			}
			return type === void 0 ? tag : {
				...tag,
				type
			};
		});
		tags.push(...crossedTags);
		const hookAddedTags = /* @__PURE__ */ new Map();
		for (const tag of tags) {
			const tagKey = scopedCacheTagKey(tag);
			if (!computedTagKeys.has(tagKey)) hookAddedTags.set(tagKey, tag);
		}
		const reproducedByAWrite = (tag) => {
			if (tag.field === void 0) return true;
			const collectionSchema = this.schema.collections[tag.collection];
			if (tag.field === collectionSchema?.primary) return true;
			if (tag.field.includes(".")) return slicesOf(tag.collection).some(({ field }) => field === tag.field);
			return collectionSchema?.scopedCacheFields?.includes(tag.field) === true;
		};
		const collectionsAWriteReaches = new Set(tags.filter(reproducedByAWrite).map((tag) => tag.collection));
		unautopurgeable = [...hookAddedTags.values()].filter((tag) => {
			return reproducedByAWrite(tag) === false && collectionsAWriteReaches.has(tag.collection) === false && !scopedCacheCollector.manuallyPurgedKeys.has(scopedCacheTagKey(tag));
		});
		return {
			tags,
			unautopurgeable
		};
	}
};

//#endregion
export { ItemScopedCacheService };