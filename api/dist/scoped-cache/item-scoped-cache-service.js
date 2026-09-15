import { scopedCachePurgeEnabled } from "./config.js";
import { scopedCacheTagKey, scopedCacheTagsFromRows } from "./tags.js";
import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { composeScopedCachePaths, resolveScopedCacheM2oJoinChainFromPath, scopedCacheOwnershipNestedPkPaths } from "./paths.js";
import { pinnedScopedCacheTagsFromFilter, scopedCacheAncestorSliceCandidates, scopedCacheNestedCollections } from "./read-tags.js";
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
var ItemScopedCacheService = class {
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
	*
	* `deleting` adds the slices the delete VACATES rather than occupies — rows that
	* survive it holding a foreign key it rewrites. They belong to the same snapshot
	* because they are read off the same keys and purged in the same pass; leaving
	* their union to the caller only asked it to redo the `null` handling below.
	*/
	async snapshot(keys, { deleting = false } = {}) {
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
		if (deleting) tags.push(...this.vacatedSelfRelationTags(keys));
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
	* Slices a delete vacates through a DIRECT self-relation whose `on_delete`
	* rewrites the fk (SET NULL / SET DEFAULT). Deleting key X leaves surviving
	* children with `<field> = X` rewritten to null, so a read pinned to
	* `<field>=X` would go stale. Emitted only for a self-relation field the
	* collection scopes on (else no read pins it). Keyed by the deleted keys.
	*/
	vacatedSelfRelationTags(deletedKeys) {
		if (!scopedCachePurgeEnabled() || deletedKeys.length === 0) return [];
		const tags = [];
		for (const relation of this.schema.relations) {
			const rule = relation.schema?.on_delete;
			if (relation.collection !== this.collection || relation.related_collection !== this.collection || !this.flatFields.includes(relation.field) || rule !== "SET NULL" && rule !== "SET DEFAULT") continue;
			for (const key of deletedKeys) tags.push({
				collection: this.collection,
				field: relation.field,
				value: key,
				type: this.fieldTypes[relation.field]
			});
		}
		return tags;
	}
	/**
	* Ownership ancestors to nest into the read so the scope pins them by key rather
	* than by the bare tag a `fields: ['*']` read would over-purge on. Stripped from
	* the response again once the tags are built.
	*/
	ownershipPathsToInject(query) {
		if (!scopedCachePurgeEnabled()) return [];
		return scopedCacheOwnershipNestedPkPaths(this.schema, this.collection).filter((path) => {
			const ancestorPath = path.split(".").slice(0, -1);
			return !(query.fields ?? []).some((field) => {
				const segments = field.split(".");
				return segments.length > ancestorPath.length && ancestorPath.every((seg, at) => segments[at] === seg);
			});
		});
	}
	/**
	* Everything this read's tags need that the AST alone decides, resolved before
	* the query runs. The plan fills its own row-dependent half from inside it.
	*/
	planRead(ast, injectedOwnershipPaths) {
		return new ScopedCacheReadPlan(this.collection, this.schema, ast, injectedOwnershipPaths);
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
		const collectionsFetchedAsRows = new Set([...fieldMap.other].map(([, entry]) => entry.collection));
		const ancestorSliceTagsFor = (collection) => {
			const pinsOf = (ancestor) => {
				if (ancestor === this.collection) return rootScopedCacheTags;
				return keyedFilterPins.get(ancestor) ?? [];
			};
			for (const candidate of scopedCacheAncestorSliceCandidates(this.schema, collection)) {
				const matched = pinsOf(candidate.ancestor).filter((pin) => {
					return pin.field === candidate.terminalField;
				});
				if (matched.length > 0) return matched.map((pin) => {
					return {
						collection,
						field: candidate.field,
						value: pin.value,
						type: pin.type
					};
				});
			}
			return [];
		};
		const ownKeyedSliceFor = (collection) => {
			const own = keyedFilterPins.get(collection) ?? [];
			if (own.length === 0) return [];
			const paths = [...fieldMap.read, ...fieldMap.other].filter(([, entry]) => entry.collection === collection).map(([path]) => path);
			return paths.length > 0 && paths.every((path) => {
				return path === "" || resolveScopedCacheM2oJoinChainFromPath(this.schema, this.collection, path.split(".")) !== null;
			}) ? own : [];
		};
		const pushAncestorSliceOrBare = (collection) => {
			const ancestorSliceTags = o2mConflicted.has(collection) || collection === this.collection ? [] : ancestorSliceTagsFor(collection);
			const sliceTags = ancestorSliceTags.length > 0 ? ancestorSliceTags : ownKeyedSliceFor(collection);
			tags.push(...sliceTags.length > 0 ? sliceTags : [{ collection }]);
		};
		for (const collection of taggedCollections) {
			if (collection === this.collection && rootScopedCacheTags.length > 0) {
				tags.push(...rootScopedCacheTags);
				continue;
			}
			if (o2mConflicted.has(collection)) {
				tags.push({ collection });
				continue;
			}
			if (collection !== this.collection && filterKeying.get(collection)?.kind === "independent" && !nestedCollections.has(collection) && !beyondNestedRows.has(collection)) continue;
			if (nestedCollections.has(collection) && !m2oParentPins.has(collection) && !o2mChildPins.has(collection) && !(keyedFilterPins.has(collection) && !collectionsFetchedAsRows.has(collection))) {
				pushAncestorSliceOrBare(collection);
				continue;
			}
			const pins = /* @__PURE__ */ new Map();
			for (const pin of [
				...m2oParentPins.get(collection) ?? [],
				...o2mChildPins.get(collection) ?? [],
				...keyedFilterPins.get(collection) ?? []
			]) pins.set(scopedCacheTagKey(pin), pin);
			if (pins.size === 0) {
				pushAncestorSliceOrBare(collection);
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
		const hookAddedTags = /* @__PURE__ */ new Map();
		for (const tag of tags) {
			const tagKey = scopedCacheTagKey(tag);
			if (!computedTagKeys.has(tagKey)) hookAddedTags.set(tagKey, tag);
		}
		const reproducedByAWrite = (tag) => {
			if (tag.field === void 0) return true;
			const collectionSchema = this.schema.collections[tag.collection];
			if (tag.field === collectionSchema?.primary) return true;
			return collectionSchema?.scopedCacheFields?.includes(tag.field) === true && (!tag.field.includes(".") || resolveScopedCacheM2oJoinChainFromPath(this.schema, tag.collection, tag.field.split(".").slice(0, -1)) !== null);
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