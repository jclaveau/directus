import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { scopedCacheCollectionPinsFromRows, scopedCacheMaxPinsPerCollection, scopedCachePinKey } from "./pins.js";
import { composeScopedCachePaths, resolveScopedCacheM2oJoinChainFromPath } from "./paths.js";
import { renderScopedCacheFingerprint, scopedCacheFingerprintOf, scopedCacheFingerprintsByCollection } from "./fingerprint.js";
import { scopedCachePurgeEnabled } from "./config.js";
import { scopedCacheIndexPath } from "./index-path.js";
import { scopedCacheOwnershipInjections } from "./ownership-injection.js";
import { pinnedScopedCacheQueryCasesFromFilter, scopedCacheNestedCollections, scopedCachePathReversesChain, scopedCachePinsFromFilter, scopedCachePinsOfQueryCases } from "./read-pins.js";
import { collectionsInFieldMap } from "../permissions/modules/process-ast/utils/collections-in-field-map.js";
import { ScopedCacheReadPlan } from "./read-plan.js";
import emitter_default from "../emitter.js";
import { purgeScopedCache } from "./purge.js";
import { queueMergedAfterCommit } from "../utils/transaction.js";
import { randomUUID } from "node:crypto";

//#region src/scoped-cache/item-scoped-cache-service.ts
/**
* Stateless read-side metadata for a collection's scoped cache. Derives the flat
* fields, dotted paths, terminal types and related primary keys the snapshot and
* read-fingerprint assembly consume. Every member is a pure function of (collection,
* schema), both fixed for the owning ItemsService, so the getters memoize on
* first access.
*/
/**
* The alias each scope path's terminal is selected under, since two paths ending
* on the same field would collide under their own name. Prefixed with a character
* no column of a Directus collection carries, because the select beside it now
* projects every column and a plain `value0` could be one of them.
*/
const PATH_ALIAS = "#path";
/**
* Each fingerprint of both lists once. Writes sharing one declarations sink each
* queue every fingerprint declared so far, so concatenated, N writes would hand
* the purge N² of them to test against every entry it scans.
*/
function uniqueScopedCacheFingerprints(queuedFingerprints, incomingFingerprints) {
	const fingerprintsByRendering = /* @__PURE__ */ new Map();
	for (const fingerprint of [...queuedFingerprints, ...incomingFingerprints]) fingerprintsByRendering.set(renderScopedCacheFingerprint(fingerprint), fingerprint);
	return [...fingerprintsByRendering.values()];
}
/**
* One purge reaching every entry either of two purges of a collection reaches. It
* may drop more than both would have — an entry one request pins, matched by a row
* of the other — and never fewer: a `null` or a missing side widens the merge to
* what that side alone would sweep.
*/
function mergeScopedCachePurgeRequests(queuedRequest, incomingRequest) {
	const queuedRows = queuedRequest.rows;
	const incomingRows = incomingRequest.rows;
	return {
		scopedCacheFingerprints: queuedRequest.scopedCacheFingerprints === null || incomingRequest.scopedCacheFingerprints === null ? null : uniqueScopedCacheFingerprints(queuedRequest.scopedCacheFingerprints, incomingRequest.scopedCacheFingerprints),
		hookDeclarations: queuedRequest.hookDeclarations === void 0 && incomingRequest.hookDeclarations === void 0 ? void 0 : { purgeFingerprints: uniqueScopedCacheFingerprints(queuedRequest.hookDeclarations?.purgeFingerprints ?? [], incomingRequest.hookDeclarations?.purgeFingerprints ?? []) },
		changedCollections: [...new Set([...queuedRequest.changedCollections, ...incomingRequest.changedCollections])],
		rows: queuedRows === void 0 || incomingRows === void 0 ? void 0 : {
			fingerprints: uniqueScopedCacheFingerprints(queuedRows.fingerprints, incomingRows.fingerprints),
			changed: queuedRows.changed === null || incomingRows.changed === null ? null : [...new Set([...queuedRows.changed, ...incomingRows.changed])]
		}
	};
}
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
	* What a mutation's purge is built from, read before it runs and again once it
	* commits: every row it touches, each carrying the fingerprint of the scope it
	* sits in.
	*
	* One fingerprint per ROW, never one per value: `owner=alpha` and
	* `method=spaced` coming from two DIFFERENT rows must not read as one row
	* holding both, which is exactly what a read pinned to that pin depends on.
	*
	* Always emits the primary-key slice of every key, on every collection, whether it
	* declares scope fields or not: the read side pins that axis on every collection,
	* and a read pinning an axis the write never emits is never purged — stale, which
	* is worse than any hit ratio. It costs no query, since the keys are already here.
	*
	* `canResolveSlicesFromRows: false` is the fail-safe: the scope of these rows is
	* unresolvable, so their collection is purged whole.
	*/
	async snapshot(keys) {
		if (!scopedCachePurgeEnabled() || keys.length === 0) return {
			canResolveSlicesFromRows: true,
			rows: []
		};
		const primaryKeyField = this.schema.collections[this.collection]?.primary;
		if (primaryKeyField === void 0) return {
			canResolveSlicesFromRows: true,
			rows: []
		};
		const fieldTypes = this.fieldTypes;
		const keyPins = keys.map((key) => {
			return {
				field: primaryKeyField,
				value: key,
				type: fieldTypes[primaryKeyField]
			};
		});
		const flatFields = this.flatFields;
		const pathFields = this.resolvablePathFields();
		if (flatFields.length === 0 && pathFields.length === 0) return {
			canResolveSlicesFromRows: true,
			rows: keyPins.map((keyPin) => {
				return {
					key: keyPin.value,
					row: null,
					fingerprint: scopedCacheFingerprintOf(this.collection, [keyPin])
				};
			})
		};
		const scopedRows = await this.scopeValueRows(keys);
		if (scopedRows.every((scopedRow) => {
			return flatFields.every((flatField) => flatField in scopedRow);
		}) === false) return {
			canResolveSlicesFromRows: false,
			rows: []
		};
		const pinnableFields = [...new Set([
			primaryKeyField,
			...flatFields,
			...pathFields
		])];
		return {
			canResolveSlicesFromRows: true,
			rows: scopedRows.map((row) => {
				const rowPins = scopedCacheCollectionPinsFromRows(this.collection, pinnableFields, [row], "skip", fieldTypes);
				return {
					key: row[primaryKeyField],
					row,
					fingerprint: scopedCacheFingerprintOf(this.collection, rowPins)
				};
			})
		};
	}
	/**
	* The mutated rows, holding every column of the collection — a read binds the
	* fields it selected, sorted and filtered on, and any of them can be a column
	* no scope names — plus the terminal each path scope resolves to through its
	* M2O join chain. The mutated row carries only the first-hop fk, so the
	* ancestor joins recover the SAME terminals the read side pinned.
	*
	* One query for all of it, not one per path and one more for the flat columns.
	* The joins already select FROM the mutated collection, so its own columns ride
	* along, and composition derives the paths by extending each other
	* (`teaching_unit.discipline`, then `teaching_unit.discipline.enrollment`) so a
	* join keyed by the segments leading to it is shared and each further path costs
	* at most one more join. A M2O join cannot multiply the rows it is read from, so
	* the flat columns read the same as they did on their own query.
	*
	* Each path terminal comes back under the path's own dotted name, which is what
	* both callers name it as. The query selects it positionally instead — two paths
	* ending on the same terminal field would collide under that name in SQL.
	*/
	async scopeValueRows(keys) {
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
		return (await query.select([...[...new Set([
			primaryKeyField,
			...this.flatFields,
			...this.rootColumns()
		])].map((field) => {
			return this.knex.ref(`root.${field}`).as(field);
		}), ...terminalRefByPath.map(({ terminalRef }, index) => {
			return this.knex.ref(terminalRef).as(`${PATH_ALIAS}${index}`);
		})]).whereIn(`root.${primaryKeyField}`, keys)).map((row) => {
			const namedRow = {};
			for (const [column, value] of Object.entries(row)) namedRow[column] = value;
			terminalRefByPath.forEach(({ field }, index) => {
				delete namedRow[`${PATH_ALIAS}${index}`];
				namedRow[field] = row[`${PATH_ALIAS}${index}`];
			});
			return namedRow;
		});
	}
	/**
	* Every column of the collection as the schema knows it. An alias field (o2m,
	* m2m, a presentation block) has no column to read and would break the select.
	*/
	rootColumns() {
		const collectionFields = this.schema.collections[this.collection]?.fields ?? {};
		return Object.values(collectionFields).filter(({ alias }) => alias === false).map(({ field }) => field);
	}
	/**
	* The dotted scope paths that still resolve to a terminal value. A path whose
	* chain has gained a to-many hop resolves to nothing and pins nothing, which is
	* what makes it drop to the bare collection fingerprint on both sides.
	*/
	resolvablePathFields() {
		return this.paths.filter(({ field }) => Boolean(this.resolvePath(field))).map(({ field }) => field);
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
	* than by the bare fingerprint a `fields: ['*']` read would over-purge on.
	* Stripped from the response again once the fingerprints are built.
	*/
	ownershipInjections(query) {
		if (!scopedCachePurgeEnabled()) return [];
		return scopedCacheOwnershipInjections(this.schema, this.collection, query.fields ?? []);
	}
	/**
	* Everything this read's fingerprints need that the AST alone decides, resolved
	* before
	* the query runs. The plan fills its own row-dependent half from inside it.
	*/
	planRead(ast, injections) {
		return new ScopedCacheReadPlan(this.collection, this.schema, ast, injections);
	}
	/**
	* Event context handed to the `cache.purge` filter so extensions can resolve their
	* own fingerprints.
	*/
	purgeContext() {
		return {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		};
	}
	async purge(scopedCacheFingerprints, hookDeclarations, changedCollections = [], { includeBareFingerprint = true, rows } = {}) {
		if (queueMergedAfterCommit(this.knex, [
			"scoped-cache-purge",
			this.collection,
			includeBareFingerprint,
			JSON.stringify(this.accountability)
		].join(":"), {
			scopedCacheFingerprints,
			hookDeclarations: hookDeclarations === void 0 ? void 0 : { purgeFingerprints: [...hookDeclarations.purgeFingerprints] },
			changedCollections,
			rows
		}, {
			mergeRequests: mergeScopedCachePurgeRequests,
			runRequest: async (database, mergedRequest) => {
				await new ItemScopedCacheService(this.collection, this.schema, database, this.cache, this.accountability).purge(mergedRequest.scopedCacheFingerprints, mergedRequest.hookDeclarations, mergedRequest.changedCollections, {
					includeBareFingerprint,
					rows: mergedRequest.rows
				});
			}
		})) return [];
		const cache = this.cache;
		if (cache === null) return [];
		const context = this.purgeContext();
		const hookFingerprints = hookDeclarations?.purgeFingerprints ?? [];
		const ownFingerprints = changedCollections.includes(this.collection) ? null : scopedCacheFingerprints;
		const otherCollections = scopedCachePurgeEnabled() ? changedCollections.filter((changedCollection) => {
			return changedCollection !== this.collection;
		}) : [];
		const boundToRows = rows === void 0 ? {} : {
			rowFingerprints: rows.fingerprints,
			changed: rows.changed,
			indexPath: scopedCacheIndexPath(this.schema, this.collection)
		};
		const declared = {
			declaredFingerprints: hookFingerprints,
			changedCollections: otherCollections
		};
		if (ownFingerprints !== null && otherCollections.length === 0) {
			if (includeBareFingerprint) return purgeScopedCache(cache, this.collection, ownFingerprints, context, {
				...boundToRows,
				...declared
			});
			return purgeScopedCache(cache, this.collection, ownFingerprints, context, {
				...boundToRows,
				...declared,
				includeBareFingerprint: false
			});
		}
		const scopedCachePurgeId = randomUUID();
		const purgedFingerprintSets = [];
		if (ownFingerprints !== null) purgedFingerprintSets.push(await purgeScopedCache(cache, this.collection, ownFingerprints, context, includeBareFingerprint ? {
			...boundToRows,
			...declared,
			scopedCachePurgeId
		} : {
			...boundToRows,
			...declared,
			includeBareFingerprint: false,
			scopedCachePurgeId
		}));
		else {
			purgedFingerprintSets.push(await purgeScopedCache(cache, this.collection, null, context, { scopedCachePurgeId }));
			if (hookFingerprints.length > 0) purgedFingerprintSets.push(await purgeScopedCache(cache, this.collection, [], context, {
				...declared,
				includeBareFingerprint: false,
				scopedCachePurgeId
			}));
		}
		purgedFingerprintSets.push(...await Promise.all(otherCollections.map((changedCollection) => {
			return purgeScopedCache(cache, changedCollection, null, context, { scopedCachePurgeId });
		})));
		return purgedFingerprintSets.some((purgedSet) => purgedSet === null) ? null : purgedFingerprintSets.flatMap((purgedSet) => purgedSet ?? []);
	}
	/**
	* The scoped-cache fingerprints this read depends on. The root collection gets
	* value slices only when the query filter *bounds* it to those values
	* (`scopedCachePinsFromFilter`), so one owner's/partition's later write
	* drops only their entries. An unbounded root (no scope-field filter — e.g. an
	* admin list) and every other touched collection fall back to a bare collection
	* fingerprint, so any write to them invalidates the read (a value-sliced one
	* would miss an insert of a brand-new value). The `cache.scope` filter lets
	* extensions augment these (resolve M2M owners, or name a collection an
	* `items.read` hook enriched from); it receives the enriched `records`. Whatever
	* they add must be reproducible on the `cache.purge` side or it leaks. Returns
	* the fingerprints plus any unautopurgeable scopeTo ones respond.ts leaves the
	* read uncached for.
	*/
	async readFingerprints(inputs) {
		const { ast, plan, updatedQuery, filteredRecords, hookDeclarations } = inputs;
		let readPins = [];
		let unautopurgeablePins = [];
		if (!scopedCachePurgeEnabled()) return {
			fingerprints: [],
			unautopurgeable: []
		};
		const { fieldMap, filterKeying, keyedFilterPins, m2oParentPins, o2mChildPins, o2mConflicted, beyondNestedRows } = plan;
		const nestedCollections = scopedCacheNestedCollections(ast);
		const rootPaths = /* @__PURE__ */ new Set();
		for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) if (entry.collection === this.collection) rootPaths.add(path);
		const rootScopedCacheQueryCases = rootPaths.size > 1 ? [] : pinnedScopedCacheQueryCasesFromFilter(this.collection, this.flatFields, joinFilterWithCases(updatedQuery.filter, ast.cases), this.fieldTypes, this.relatedPks, this.paths, this.schema.collections[this.collection]?.primary);
		const rootScopedCachePins = scopedCachePinsOfQueryCases(rootScopedCacheQueryCases);
		const fingerprintedCollections = new Set([...collectionsInFieldMap(fieldMap), ...filterKeying.keys()]);
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
		const rootKeyPins = rootPaths.size > 1 || rootPrimary === void 0 ? [] : scopedCachePinsFromFilter(this.collection, [], effectiveFilter, this.fieldTypes, {}, [], rootPrimary);
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
		const slicePinsFor = (collection) => {
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
				const queryCase = /* @__PURE__ */ new Map();
				let everyPathBound = true;
				for (const path of paths) {
					const fields = plan.unaliased(path);
					const prefixed = `${fields.join(".")}.${slice.field}`;
					const relatedPks = relatedPk === void 0 ? {} : { [prefixed]: relatedPk };
					const pathPins = scopedCachePinsFromFilter(this.collection, [], effectiveFilter, { [prefixed]: type }, relatedPks, [{
						field: prefixed,
						segments: [...fields, ...slice.segments]
					}]);
					if (pathPins.length === 0) {
						everyPathBound = false;
						break;
					}
					for (const { value } of pathPins) {
						const sliced = {
							collection,
							field: slice.field,
							value,
							type
						};
						queryCase.set(scopedCachePinKey(sliced), sliced);
					}
				}
				if (everyPathBound && queryCase.size > 0 && queryCase.size <= scopedCacheMaxPinsPerCollection()) return [...queryCase.values()];
			}
			return [];
		};
		const nodeBoundPinsFor = (collection) => {
			const bounds = plan.nodeBounds.get(collection) ?? [];
			if (collection === this.collection || bounds.length === 0) return [];
			const related = relatedServiceOf(collection);
			const queryCase = /* @__PURE__ */ new Map();
			for (const nodeBound of bounds) {
				const nodePins = nodeBound === null ? [] : scopedCachePinsFromFilter(collection, related.flatFields, nodeBound, related.fieldTypes, related.relatedPks, related.paths, this.schema.collections[collection]?.primary);
				if (nodePins.length === 0) return [];
				for (const pin of nodePins) queryCase.set(scopedCachePinKey(pin), pin);
			}
			return queryCase.size <= scopedCacheMaxPinsPerCollection() ? [...queryCase.values()] : [];
		};
		const pushNodeBoundOrBare = (collection, pins) => {
			const nodePins = nodeBoundPinsFor(collection);
			if (nodePins.length === 0) {
				readPins.push({ collection });
				return;
			}
			for (const pin of nodePins) pins.set(scopedCachePinKey(pin), pin);
			readPins.push(...pins.values());
		};
		const pushSliceOrBare = (collection, pins) => {
			const slicePins = slicePinsFor(collection);
			if (slicePins.length > 0) {
				readPins.push(...slicePins);
				return;
			}
			pushNodeBoundOrBare(collection, pins);
		};
		for (const collection of fingerprintedCollections) {
			if (collection === this.collection && rootScopedCachePins.length > 0) {
				readPins.push(...rootScopedCachePins);
				continue;
			}
			const pins = /* @__PURE__ */ new Map();
			for (const pin of [
				...m2oParentPins.get(collection) ?? [],
				...o2mChildPins.get(collection) ?? [],
				...keyedFilterPins.get(collection) ?? []
			]) pins.set(scopedCachePinKey(pin), pin);
			if (o2mConflicted.has(collection)) {
				if (beyondNestedRows.has(collection)) {
					readPins.push({ collection });
					continue;
				}
				pushNodeBoundOrBare(collection, pins);
				continue;
			}
			if (collection !== this.collection && filterKeying.get(collection)?.kind === "independent" && !nestedCollections.has(collection) && !beyondNestedRows.has(collection)) continue;
			if (beyondNestedRows.has(collection)) {
				const slicePins = slicePinsFor(collection);
				if (slicePins.length === 0) {
					readPins.push({ collection });
					continue;
				}
				for (const pin of slicePins) pins.set(scopedCachePinKey(pin), pin);
				readPins.push(...pins.values());
				continue;
			}
			const paths = pathsTo(collection);
			if (paths.length > 0 && paths.every((path) => plan.injectedAncestorPaths.has(path))) {
				readPins.push(...pins.values());
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
			readPins.push(...pins.values());
		}
		const computedPinKeys = new Set(readPins.map(scopedCachePinKey));
		const computedPins = new Set(readPins);
		readPins = await emitter_default.emitFilter("cache.scope", readPins, {
			collection: this.collection,
			query: updatedQuery,
			records: filteredRecords
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
		const declaredCasesStart = readPins.length;
		const declaredCaseSizes = hookDeclarations.scopeQueryCases.map((queryCase) => queryCase.length);
		for (const queryCase of hookDeclarations.scopeQueryCases) readPins.push(...queryCase);
		const hookNamedCollections = new Set(readPins.filter((pin) => !computedPins.has(pin)).map((pin) => pin.collection));
		const seenPinKeys = new Set(readPins.map(scopedCachePinKey));
		const crossedPins = [];
		readPins = readPins.map((pin) => {
			if (pin.field === void 0 || !pin.field.includes(".") || !slicesOf(pin.collection).some(({ field }) => field === pin.field)) return pin;
			const resolved = new ItemScopedCacheService(pin.collection, this.schema, this.knex, this.cache, this.accountability).resolvePath(pin.field);
			if (resolved === null) return pin;
			const { segments, joins, terminalCollection, terminalField } = resolved;
			const type = pin.type ?? this.schema.collections[terminalCollection]?.fields[terminalField]?.type;
			for (const [hop, join] of joins.entries()) {
				const crossed = join.relatedCollection;
				const suffix = segments.slice(hop + 1).join(".");
				const crossedPin = slicesOf(crossed).some(({ field }) => field === suffix) ? {
					collection: crossed,
					field: suffix,
					value: pin.value,
					type
				} : { collection: crossed };
				const crossedKey = scopedCachePinKey(crossedPin);
				if (!seenPinKeys.has(crossedKey)) {
					seenPinKeys.add(crossedKey);
					crossedPins.push(crossedPin);
				}
				if (!computedPins.has(pin)) hookNamedCollections.add(crossed);
			}
			return type === void 0 ? pin : {
				...pin,
				type
			};
		});
		readPins.push(...crossedPins);
		const declaredQueryCases = [];
		let declaredCaseOffset = declaredCasesStart;
		for (const size of declaredCaseSizes) {
			declaredQueryCases.push(readPins.slice(declaredCaseOffset, declaredCaseOffset + size));
			declaredCaseOffset += size;
		}
		const hookAddedPins = /* @__PURE__ */ new Map();
		for (const pin of readPins) {
			const pinKey = scopedCachePinKey(pin);
			if (!computedPinKeys.has(pinKey)) hookAddedPins.set(pinKey, pin);
		}
		const reproducedByAWrite = (pin) => {
			if (pin.field === void 0) return true;
			const collectionSchema = this.schema.collections[pin.collection];
			if (pin.field === collectionSchema?.primary) return true;
			if (pin.field.includes(".")) return slicesOf(pin.collection).some(({ field }) => field === pin.field);
			return collectionSchema?.scopedCacheFields?.includes(pin.field) === true;
		};
		const collectionsAWriteReaches = new Set(readPins.filter(reproducedByAWrite).map((pin) => pin.collection));
		unautopurgeablePins = [...hookAddedPins.values()].filter((pin) => {
			return reproducedByAWrite(pin) === false && collectionsAWriteReaches.has(pin.collection) === false && !hookDeclarations.manuallyPurgedKeys.has(scopedCachePinKey(pin));
		});
		const queryCaseFields = plan.fieldsByCollection();
		for (const collection of hookNamedCollections) queryCaseFields.delete(collection);
		for (const [collection, viewFields] of queryCaseFields) {
			const schemaFields = Object.keys(this.schema.collections[collection]?.fields ?? {});
			if (schemaFields.length > 0 && schemaFields.every((schemaField) => viewFields.includes(schemaField))) queryCaseFields.delete(collection);
		}
		const rootPinKeys = new Set(readPins.map(scopedCachePinKey));
		const rootQueryCases = rootScopedCacheQueryCases.filter((queryCase) => {
			return queryCase.every((pin) => rootPinKeys.has(scopedCachePinKey(pin)));
		});
		const rootQueryCasePinKeys = new Set(rootQueryCases.flat().map(scopedCachePinKey));
		const declaredCasePinKeys = new Set(declaredQueryCases.flat().map(scopedCachePinKey));
		const standaloneQueryCases = readPins.filter((pin) => {
			const pinKey = scopedCachePinKey(pin);
			if (rootQueryCasePinKeys.has(pinKey)) return false;
			return declaredCasePinKeys.has(pinKey) === false || computedPinKeys.has(pinKey);
		}).map((pin) => [pin]);
		const pinOrder = /* @__PURE__ */ new Map();
		readPins.forEach((pin, index) => {
			const pinKey = scopedCachePinKey(pin);
			if (!pinOrder.has(pinKey)) pinOrder.set(pinKey, index);
		});
		const derivedAt = (queryCase) => {
			return queryCase.reduce((earliest, pin) => {
				return Math.min(earliest, pinOrder.get(scopedCachePinKey(pin)) ?? Infinity);
			}, Infinity);
		};
		return {
			fingerprints: scopedCacheFingerprintsByCollection([
				...rootQueryCases,
				...declaredQueryCases,
				...standaloneQueryCases
			].sort((left, right) => derivedAt(left) - derivedAt(right)), queryCaseFields),
			unautopurgeable: unautopurgeablePins.map((pin) => {
				return scopedCacheFingerprintOf(pin.collection, [pin]);
			})
		};
	}
};

//#endregion
export { ItemScopedCacheService };