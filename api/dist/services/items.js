import { assign, clone, cloneDeep, isPlainObject, omit, pick, without } from "../utils/lodash-es-used.js";
import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { getDatabaseForAccountability } from "../database/connections.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { composeScopedCachePaths, createScopedCacheCollector, pinnedScopedCacheTagsFromFilter, pinnedScopedCacheTagsFromM2oParents, purgeScopedCache, resolveScopedCacheM2oJoinChainFromPath, scopedCacheCollectionsBeyondNestedRows, scopedCacheCollectionsChangedByOnDelete, scopedCachePurgeEnabled, scopedCacheTagKey, scopedCacheTagsFromRows } from "../scoped-cache.js";
import { getCache } from "../cache.js";
import { readMeta, withMeta } from "../utils/read-meta.js";
import { fieldMapFromAst } from "../permissions/modules/process-ast/lib/field-map-from-ast.js";
import { collectionsInFieldMap } from "../permissions/modules/process-ast/utils/collections-in-field-map.js";
import { processAst } from "../permissions/modules/process-ast/process-ast.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { translateDatabaseError } from "../database/errors/translate.js";
import { getAstFromQuery } from "../database/get-ast-from-query/get-ast-from-query.js";
import { PayloadService } from "./payload.js";
import { runAst } from "../database/run-ast/run-ast.js";
import { processPayload } from "../permissions/modules/process-payload/process-payload.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { transaction } from "../utils/transaction.js";
import { isPrimaryKey } from "../utils/is-primary-key.js";
import { validateKeys } from "../utils/validate-keys.js";
import { validateUserCountIntegrity } from "../utils/validate-user-count-integrity.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { toArray } from "@directus/utils";
import { randomUUID } from "node:crypto";
import { ALTERATIONS_KEYS, Action } from "@directus/constants";
import { isSystemCollection } from "@directus/system-data";
import { UserIntegrityCheckFlag } from "@directus/types";

//#region src/services/items.ts
const env = useEnv();
/**
* Emit a mutation's action events in parallel. This fork awaits them by default so a
* mutation read-back sees rows its action hooks create (e.g. the notifying fan-out).
* Pass `awaitActionHooks: false` for the historical fire-and-forget behaviour.
*/
async function emitActionEvents(actionEvents, opts) {
	const emitting = Promise.all(actionEvents.map((actionEvent) => opts.bypassEmitAction ? opts.bypassEmitAction(actionEvent) : emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context)));
	if (opts.awaitActionHooks !== false) await emitting;
	else emitting.catch(() => {});
}
var ItemsService = class ItemsService {
	collection;
	knex;
	accountability;
	eventScope;
	schema;
	cache;
	nested;
	scopedCachePurged = null;
	constructor(collection, options) {
		this.collection = collection;
		this.knex = options.knex || getDatabaseForAccountability(options.accountability);
		this.accountability = options.accountability || null;
		this.eventScope = isSystemCollection(this.collection) ? this.collection.substring(9) : "items";
		this.schema = options.schema;
		this.cache = getCache().cache;
		this.nested = options.nested ?? [];
		return this;
	}
	/**
	* Snapshot the current scope values for the given keys as scoped cache tags, before
	* a mutation runs. Snapshots the *old* values an update/delete is about to change so
	* their slices get purged (an update that moves a row from `student=A` to `student=B`
	* must drop both). Returns an empty list when there are no keys (a
	* collection-level purge then suffices).
	*
	* Always emits the primary-key slice of every key, on every collection, whether it
	* declares scope fields or not: the read side pins that axis on every collection,
	* and a read pinning an axis the write never emits is never purged — stale, which
	* is worse than any hit ratio. It costs no query, since the keys are already here.
	*/
	async snapshotScopedCacheTags(keys) {
		if (!scopedCachePurgeEnabled() || keys.length === 0) return [];
		const primaryKeyField = this.schema.collections[this.collection]?.primary;
		if (primaryKeyField === void 0) return [];
		const flatFields = this.collectionScopedCacheFlatFields;
		const paths = this.collectionScopedCachePaths;
		const fieldTypes = this.collectionScopedCacheFieldTypes;
		const tags = keys.map((key) => {
			return {
				collection: this.collection,
				field: primaryKeyField,
				value: key,
				type: fieldTypes[primaryKeyField]
			};
		});
		if (flatFields.length > 0) {
			const rows = await this.knex.select([...new Set([primaryKeyField, ...flatFields])]).from(this.collection).whereIn(primaryKeyField, keys);
			const flatTags = scopedCacheTagsFromRows(this.collection, flatFields, rows, "coarse", fieldTypes);
			if (flatTags === null) return null;
			tags.push(...flatTags);
		}
		tags.push(...await this.snapshotScopedCachePathTags(paths, keys, fieldTypes));
		return tags;
	}
	/**
	* Resolve every path scope field to its terminal value per mutated row via its M2O
	* join chain, then reuse the row-tag builder for canonicalization + dedup. The
	* mutated row carries only the first-hop fk, so the ancestor joins recover the
	* SAME terminals the read side pinned — the identical `field=<path>` slices.
	*
	* One query for every path, not one per path: composition derives the paths by
	* extending each other (`teaching_unit.discipline`, then
	* `teaching_unit.discipline.enrollment`), so a join keyed by the segments leading
	* to it is shared and each further path costs at most one more join. On
	* `student_course` that turns four round trips into one, per snapshot, and a
	* mutation snapshots twice.
	*/
	async snapshotScopedCachePathTags(paths, keys, fieldTypes) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const aliasByLeadingSegments = /* @__PURE__ */ new Map();
		const terminalRefByPath = [];
		let query = this.knex.from({ root: this.collection });
		for (const { field } of paths) {
			const resolved = this.resolveScopedCachePath(field);
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
		if (terminalRefByPath.length === 0) return [];
		const rows = await query.select(terminalRefByPath.map(({ terminalRef }, index) => {
			return this.knex.ref(terminalRef).as(`value${index}`);
		})).whereIn(`root.${primaryKeyField}`, keys);
		const tags = [];
		terminalRefByPath.forEach(({ field }, index) => {
			tags.push(...scopedCacheTagsFromRows(this.collection, [field], rows.map((row) => ({ [field]: row[`value${index}`] })), "skip", { [field]: fieldTypes[field] }));
		});
		return tags;
	}
	/**
	* Event context handed to the `cache.purge` filter so extensions can resolve their
	* own tags.
	*/
	scopedCachePurgeContext() {
		return {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		};
	}
	async purgeScopedCache(tags, collector, changedCollections = []) {
		const cache = this.cache;
		if (cache === null) return;
		const context = this.scopedCachePurgeContext();
		const hookTags = collector?.tags ?? [];
		const ownTags = changedCollections.includes(this.collection) ? null : tags;
		const otherCollections = scopedCachePurgeEnabled() ? changedCollections.filter((changedCollection) => {
			return changedCollection !== this.collection;
		}) : [];
		if (ownTags !== null && otherCollections.length === 0) {
			this.scopedCachePurged = await purgeScopedCache(cache, this.collection, [...ownTags, ...hookTags], context);
			return;
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
		this.scopedCachePurged = purgedTagSets.some((tagSet) => tagSet === null) ? null : purgedTagSets.flatMap((tagSet) => tagSet ?? []);
	}
	get collectionScopedCacheFields() {
		return this.schema.collections[this.collection]?.scopedCacheFields ?? [];
	}
	get collectionScopedCacheFlatFields() {
		return this.collectionScopedCacheFields.filter((field) => !field.includes("."));
	}
	get collectionScopedCachePaths() {
		const byField = /* @__PURE__ */ new Map();
		const addPath = (field) => {
			if (byField.has(field)) return;
			const resolved = this.resolveScopedCachePath(field);
			if (resolved) byField.set(field, {
				field,
				segments: resolved.segments
			});
		};
		for (const field of this.collectionScopedCacheFields) if (field.includes(".")) addPath(field);
		for (const { field } of composeScopedCachePaths(this.schema, this.collection)) addPath(field);
		return [...byField.values()];
	}
	resolveScopedCachePath(path) {
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
	get collectionScopedCacheFieldTypes() {
		const rootFields = this.schema.collections[this.collection]?.fields ?? {};
		const types = {};
		const primaryKeyField = this.schema.collections[this.collection]?.primary;
		if (primaryKeyField !== void 0) types[primaryKeyField] = rootFields[primaryKeyField]?.type;
		for (const field of this.collectionScopedCacheFlatFields) types[field] = rootFields[field]?.type;
		for (const { field } of this.collectionScopedCachePaths) {
			const resolved = this.resolveScopedCachePath(field);
			if (!resolved) continue;
			types[field] = this.schema.collections[resolved.terminalCollection]?.fields[resolved.terminalField]?.type;
		}
		return types;
	}
	get collectionScopedCacheFieldRelatedPks() {
		const map = {};
		const addRelatedPk = (field, fromCollection, fromField) => {
			const relatedCollection = this.schema.relations.find((rel) => {
				return rel.collection === fromCollection && rel.field === fromField;
			})?.related_collection;
			const primaryKey = relatedCollection ? this.schema.collections[relatedCollection]?.primary : void 0;
			if (primaryKey) map[field] = primaryKey;
		};
		for (const field of this.collectionScopedCacheFlatFields) addRelatedPk(field, this.collection, field);
		for (const { field } of this.collectionScopedCachePaths) {
			const resolved = this.resolveScopedCachePath(field);
			if (resolved) addRelatedPk(field, resolved.terminalCollection, resolved.terminalField);
		}
		return map;
	}
	/**
	* Create a fork of the current service, allowing instantiation with different options.
	*/
	fork(options) {
		const Service = this.constructor;
		const isItemsService = Service.length === 2;
		const newOptions = {
			knex: this.knex,
			accountability: this.accountability,
			schema: this.schema,
			nested: this.nested,
			...options
		};
		if (isItemsService) return new ItemsService(this.collection, newOptions);
		return new Service(newOptions);
	}
	createMutationTracker(initialCount = 0) {
		const maxCount = Number(env["MAX_BATCH_MUTATION"]);
		let mutationCount = initialCount;
		return {
			trackMutations(count) {
				mutationCount += count;
				if (mutationCount > maxCount) throw new InvalidPayloadError({ reason: `Exceeded max batch mutation limit of ${maxCount}` });
			},
			getCount() {
				return mutationCount;
			},
			snapshot() {
				const savedCount = mutationCount;
				return () => {
					mutationCount = savedCount;
				};
			}
		};
	}
	async getKeysByQuery(query) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const readQuery = cloneDeep(query);
		readQuery.fields = [primaryKeyField];
		return (await new ItemsService(this.collection, {
			knex: this.knex,
			schema: this.schema
		}).readByQuery(readQuery)).map((item) => item[primaryKeyField]).filter((pk) => pk);
	}
	async createOne(data, opts = {}) {
		const [primaryKey] = await this.createMany([data], opts);
		return primaryKey ?? null;
	}
	async createMany(data, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (data.length === 0) return [];
		if (!opts.bypassLimits) opts.mutationTracker.trackMutations(data.length);
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const fields = Object.keys(this.schema.collections[this.collection].fields);
		const aliases = Object.values(this.schema.collections[this.collection].fields).filter((field) => field.alias === true).map((field) => field.field);
		const pkField = this.schema.collections[this.collection].fields[primaryKeyField];
		const results = new Array(data.length);
		const scopedCacheCollector = opts.scopedCacheCollector ?? createScopedCacheCollector(this.schema);
		const scopedCacheTagsAtStart = scopedCacheCollector.tags.length;
		const { nestedActionEvents, actionPayloads } = await transaction(this.knex, async (trx) => {
			const nestedActionEvents$1 = [];
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
			let autoIncrementSequenceNeedsToBeReset = false;
			const prepared = [];
			for (const [index, payloadInput] of data.entries()) {
				const payload = cloneDeep(payloadInput);
				const payloadAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.create", `${this.collection}.items.create`] : `${this.eventScope}.create`, payload, { collection: this.collection }, {
					database: trx,
					schema: this.schema,
					accountability: this.accountability,
					scopedCache: scopedCacheCollector.purge
				}) : payload;
				if (typeof payloadAfterHooks === "string" || typeof payloadAfterHooks === "number") {
					results[index] = payloadAfterHooks;
					continue;
				}
				if (payloadAfterHooks === null) {
					if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: `A filter hook cancelled the creation, but this operation requires a created item` });
					results[index] = null;
					continue;
				}
				const payloadWithPresets = this.accountability ? await processPayload({
					accountability: this.accountability,
					action: "create",
					collection: this.collection,
					payload: payloadAfterHooks,
					nested: this.nested
				}, {
					knex: trx,
					schema: this.schema
				}) : payloadAfterHooks;
				if (opts.preMutationError) throw opts.preMutationError;
				const actionHookPayload = payloadWithPresets;
				const payloadService = new PayloadService(this.collection, {
					accountability: this.accountability,
					knex: trx,
					schema: this.schema,
					nested: this.nested
				});
				const { payload: payloadWithM2O, revisions: revisionsM2O, nestedActionEvents: nestedActionEventsM2O, userIntegrityCheckFlags: userIntegrityCheckFlagsM2O } = await payloadService.processM2O(payloadWithPresets, opts);
				const { payload: payloadWithA2O, revisions: revisionsA2O, nestedActionEvents: nestedActionEventsA2O, userIntegrityCheckFlags: userIntegrityCheckFlagsA2O } = await payloadService.processA2O(payloadWithM2O, opts);
				const payloadWithoutAliases = pick(payloadWithA2O, without(fields, ...aliases));
				const primaryKey = (await payloadService.processValues("create", payloadWithoutAliases))[primaryKeyField];
				if (primaryKey) validateKeys(this.schema, this.collection, primaryKeyField, primaryKey);
				if (primaryKey && pkField && !opts.bypassAutoIncrementSequenceReset && ["integer", "bigInteger"].includes(pkField.type) && pkField.defaultValue === "AUTO_INCREMENT") autoIncrementSequenceNeedsToBeReset = true;
				prepared.push({
					index,
					actionHookPayload,
					payloadAfterHooks,
					payloadWithPresets,
					payloadWithoutAliases,
					primaryKey,
					revisionsM2O,
					revisionsA2O,
					nestedActionEventsM2O,
					nestedActionEventsA2O,
					userIntegrityCheckFlagsM2O,
					userIntegrityCheckFlagsA2O,
					payloadService
				});
			}
			const useBatchInsert = prepared.length > 1 && await getHelpers(trx).capabilities.preservesInsertOrderInReturning();
			try {
				if (useBatchInsert) {
					const chunkSize = env["DB_BATCH_INSERT_CHUNK_SIZE"];
					const rowsToInsert = getHelpers(trx).capabilities.padRowsForBatchInsert(prepared.map((p) => p.payloadWithoutAliases), {
						fields: this.schema.collections[this.collection].fields,
						primaryKeyField
					});
					const insertedRows = await trx.batchInsert(this.collection, rowsToInsert, chunkSize).returning(primaryKeyField);
					if (insertedRows.length !== prepared.length) throw new Error(`batchInsert returned ${insertedRows.length} rows but expected ${prepared.length}`);
					for (let i = 0; i < prepared.length; i++) {
						const row = insertedRows[i];
						const p = prepared[i];
						const returnedKey = typeof row === "object" && row !== null ? row[primaryKeyField] : row;
						if (pkField?.type === "uuid") p.primaryKey = getHelpers(trx).schema.formatUUID(p.primaryKey ?? returnedKey);
						else p.primaryKey = p.primaryKey ?? returnedKey;
						p.actionHookPayload[primaryKeyField] = p.primaryKey;
					}
				} else {
					const returningOptions = getHelpers(trx).capabilities.insertReturningOptions();
					for (const p of prepared) {
						const result = await trx.insert(p.payloadWithoutAliases).into(this.collection).returning(primaryKeyField, returningOptions).then((rows) => rows[0]);
						const returnedKey = typeof result === "object" && result !== null ? result[primaryKeyField] : result;
						if (pkField?.type === "uuid") p.primaryKey = getHelpers(trx).schema.formatUUID(p.primaryKey ?? returnedKey);
						else p.primaryKey = p.primaryKey ?? returnedKey;
						if (!p.primaryKey) p.primaryKey = (await trx.max(primaryKeyField, { as: "id" }).from(this.collection).first())?.id;
						p.actionHookPayload[primaryKeyField] = p.primaryKey;
					}
				}
			} catch (err) {
				const dbError = await translateDatabaseError(err, data, this.knex, {
					collection: this.collection,
					operation: "create"
				});
				if (isDirectusError(dbError, ErrorCode.RecordNotUnique) && dbError.extensions.primaryKey) {
					dbError.extensions.field = pkField?.field ?? null;
					delete dbError.extensions.primaryKey;
				}
				throw dbError;
			}
			const postPrepared = [];
			for (const p of prepared) {
				const primaryKey = p.primaryKey;
				const { revisions: revisionsO2M, nestedActionEvents: nestedActionEventsO2M, userIntegrityCheckFlags: userIntegrityCheckFlagsO2M } = await p.payloadService.processO2M(p.payloadWithPresets, primaryKey, opts);
				userIntegrityCheckFlags |= p.userIntegrityCheckFlagsM2O | p.userIntegrityCheckFlagsA2O | userIntegrityCheckFlagsO2M;
				nestedActionEvents$1.push(...p.nestedActionEventsM2O, ...p.nestedActionEventsA2O, ...nestedActionEventsO2M);
				postPrepared.push({
					...p,
					primaryKey,
					revisionsO2M,
					nestedActionEventsO2M
				});
			}
			if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: userIntegrityCheckFlags,
				knex: trx
			});
			if (this.accountability && this.schema.collections[this.collection].accountability !== null) {
				const { ActivityService } = await import("./activity.js");
				const { RevisionsService } = await import("./revisions.js");
				const activityIds = await new ActivityService({
					knex: trx,
					schema: this.schema
				}).createMany(postPrepared.map((p) => ({
					action: Action.CREATE,
					user: this.accountability.user,
					collection: this.collection,
					ip: this.accountability.ip,
					user_agent: this.accountability.userAgent,
					origin: this.accountability.origin,
					item: p.primaryKey
				})));
				if (this.schema.collections[this.collection].accountability === "all") {
					const revisionsService = new RevisionsService({
						knex: trx,
						schema: this.schema
					});
					const revisionInputs = await Promise.all(postPrepared.map(async (p, index) => {
						const revisionPayload = await p.payloadService.prepareDelta(p.payloadAfterHooks);
						return {
							activity: activityIds[index],
							collection: this.collection,
							item: p.primaryKey,
							data: revisionPayload,
							delta: revisionPayload
						};
					}));
					const revisionIds = await revisionsService.createMany(revisionInputs);
					for (let i = 0; i < postPrepared.length; i++) {
						const p = postPrepared[i];
						const revisionId = revisionIds[i];
						const childrenRevisions = [
							...p.revisionsM2O,
							...p.revisionsA2O,
							...p.revisionsO2M
						];
						if (childrenRevisions.length > 0) await revisionsService.updateMany(childrenRevisions, { parent: revisionId });
						if (opts.onRevisionCreate) opts.onRevisionCreate(revisionId);
					}
				}
			}
			if (autoIncrementSequenceNeedsToBeReset) await getHelpers(trx).sequence.resetAutoIncrementSequence(this.collection, primaryKeyField);
			for (const p of postPrepared) results[p.index] = p.primaryKey;
			return {
				nestedActionEvents: nestedActionEvents$1,
				actionPayloads: postPrepared.map((p) => ({
					primaryKey: p.primaryKey,
					actionHookPayload: p.actionHookPayload
				}))
			};
		}, opts.mutationTracker.snapshot());
		if (opts.emitEvents !== false) {
			const eventName = this.eventScope === "items" ? ["items.create", `${this.collection}.items.create`] : `${this.eventScope}.create`;
			await emitActionEvents([...actionPayloads.map(({ primaryKey, actionHookPayload }) => ({
				event: eventName,
				meta: {
					payload: actionHookPayload,
					key: primaryKey,
					collection: this.collection
				},
				context: {
					database: database_default(),
					schema: this.schema,
					accountability: this.accountability
				}
			})), ...nestedActionEvents], opts);
		}
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const changedKeys = results.filter((key) => key !== null).filter((key) => {
				return !scopedCacheCollector.purgeSkippedKeys.has(String(key));
			});
			if (changedKeys.length === 0 && scopedCacheCollector.tags.length === scopedCacheTagsAtStart) return results;
			const scopedCacheTags = changedKeys.length > actionPayloads.length && scopedCacheCollector.tags.length === scopedCacheTagsAtStart ? null : await this.snapshotScopedCacheTags(changedKeys);
			await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
		}
		return results;
	}
	/**
	* Get items by query.
	*/
	async readByQuery(query, opts) {
		const updatedQuery = opts?.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.query", `${this.collection}.items.query`] : `${this.eventScope}.query`, query, { collection: this.collection }, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		}) : query;
		let ast = await getAstFromQuery({
			collection: this.collection,
			query: updatedQuery,
			accountability: this.accountability
		}, {
			schema: this.schema,
			knex: this.knex
		});
		ast = await processAst({
			ast,
			action: "read",
			accountability: this.accountability
		}, {
			knex: this.knex,
			schema: this.schema
		});
		const fieldMap = scopedCachePurgeEnabled() ? fieldMapFromAst(ast, this.schema) : {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		let m2oParentPins = /* @__PURE__ */ new Map();
		const records = await runAst(ast, this.schema, this.accountability, {
			knex: this.knex,
			stripNonRequested: opts?.stripNonRequested !== void 0 ? opts.stripNonRequested : true,
			onRowsWithTemporaryFields: (rows) => {
				if (scopedCachePurgeEnabled() === false) return;
				m2oParentPins = pinnedScopedCacheTagsFromM2oParents(this.schema, this.collection, fieldMap, toArray(rows), scopedCacheCollectionsBeyondNestedRows(this.schema, ast));
			}
		});
		if (records === null) throw new ForbiddenError();
		const scopedCacheCollector = createScopedCacheCollector(this.schema);
		const filteredRecords = opts?.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.read", `${this.collection}.items.read`] : `${this.eventScope}.read`, records, {
			query: updatedQuery,
			collection: this.collection
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
			scopedCache: scopedCacheCollector.scope
		}) : records;
		let scopedCacheTags = [];
		let scopedCacheUnautopurgeableTags = [];
		if (scopedCachePurgeEnabled()) {
			const rootPaths = /* @__PURE__ */ new Set();
			for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) if (entry.collection === this.collection) rootPaths.add(path);
			const rootScopedCacheTags = rootPaths.size > 1 ? [] : pinnedScopedCacheTagsFromFilter(this.collection, this.collectionScopedCacheFlatFields, joinFilterWithCases(updatedQuery.filter, ast.cases), this.collectionScopedCacheFieldTypes, this.collectionScopedCacheFieldRelatedPks, this.collectionScopedCachePaths, this.schema.collections[this.collection]?.primary);
			for (const collection of collectionsInFieldMap(fieldMap)) {
				if (collection === this.collection && rootScopedCacheTags.length > 0) {
					scopedCacheTags.push(...rootScopedCacheTags);
					continue;
				}
				const parentPins = m2oParentPins.get(collection);
				if (parentPins === void 0) {
					scopedCacheTags.push({ collection });
					continue;
				}
				scopedCacheTags.push(...parentPins);
			}
			scopedCacheTags = await emitter_default.emitFilter("cache.scope", scopedCacheTags, {
				collection: this.collection,
				query: updatedQuery,
				records: filteredRecords
			}, {
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability
			});
			scopedCacheTags.push(...scopedCacheCollector.tags);
			scopedCacheUnautopurgeableTags = scopedCacheCollector.tags.filter((tag) => {
				if (tag.field === void 0) return false;
				const collectionSchema = this.schema.collections[tag.collection];
				if (tag.field === collectionSchema?.primary) return false;
				return !collectionSchema?.scopedCacheFields?.includes(tag.field) && !scopedCacheCollector.manuallyPurgedKeys.has(scopedCacheTagKey(tag));
			});
		}
		if (opts?.emitEvents !== false) emitter_default.emitAction(this.eventScope === "items" ? ["items.read", `${this.collection}.items.read`] : `${this.eventScope}.read`, {
			payload: filteredRecords,
			query: updatedQuery,
			collection: this.collection
		}, {
			database: this.knex || database_default(),
			schema: this.schema,
			accountability: this.accountability
		});
		return withMeta(filteredRecords, {
			scopedCacheTags,
			scopedCacheUnautopurgeableTags
		});
	}
	/**
	* Get single item by primary key.
	*
	* Uses `this.readByQuery` under the hood.
	*/
	async readOne(key, query = {}, opts) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, key);
		const queryWithKey = assign({}, query, { filter: assign({}, query.filter, { [primaryKeyField]: { _eq: key } }) });
		const results = await this.readByQuery(queryWithKey, opts);
		if (results.length === 0) throw new ForbiddenError({ reason: `No result found for key ${key} in ${this.collection} during items.readOne()` });
		return withMeta(results[0], readMeta(results) ?? { scopedCacheTags: [] });
	}
	/**
	* Get multiple items by primary keys.
	*
	* Uses `this.readByQuery` under the hood.
	*/
	async readMany(keys, query = {}, opts) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
		const queryWithKey = assign({}, query, { filter: { _and: [{ [primaryKeyField]: { _in: keys } }, query.filter ?? {}] } });
		if (Array.isArray(keys) && keys.length > 0 && !queryWithKey.limit) queryWithKey.limit = keys.length;
		return await this.readByQuery(queryWithKey, opts);
	}
	/**
	* Update multiple items by query.
	*
	* Uses `this.updateMany` under the hood.
	*/
	async updateByQuery(query, data, opts) {
		const keys = await this.getKeysByQuery(query);
		return keys.length ? await this.updateMany(keys, data, opts) : [];
	}
	/**
	* Update a single item by primary key.
	*
	* Uses `this.updateMany` under the hood.
	*/
	async updateOne(key, data, opts) {
		await this.updateMany([key], data, opts);
		return key;
	}
	/**
	* Update multiple items in a single transaction.
	*
	* Uses `this.updateOne` under the hood.
	*/
	async updateBatch(data, opts = {}) {
		if (!Array.isArray(data)) throw new InvalidPayloadError({ reason: "Input should be an array of items" });
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const keys = [];
		const batchKeys = data.flatMap((item) => {
			const key = item[primaryKeyField];
			return isPrimaryKey(key) ? [key] : [];
		});
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(batchKeys);
		const scopedCacheCollector = createScopedCacheCollector(this.schema);
		try {
			await transaction(this.knex, async (knex) => {
				const service = this.fork({ knex });
				let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
				for (const item of data) {
					const primaryKey = item[primaryKeyField];
					if (!primaryKey) throw new InvalidPayloadError({ reason: `Item in update misses primary key` });
					const combinedOpts = {
						autoPurgeCache: false,
						...opts,
						scopedCacheCollector,
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags
					};
					keys.push(await service.updateOne(primaryKey, omit(item, primaryKeyField), combinedOpts));
				}
				if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
				else await validateUserCountIntegrity({
					flags: userIntegrityCheckFlags,
					knex
				});
			}, opts.mutationTracker.snapshot());
		} finally {
			if (shouldClearCache(this.cache, opts, this.collection)) {
				const newScopedCacheTags = await this.snapshotScopedCacheTags(batchKeys);
				const scopedCacheTags = oldScopedCacheTags === null || newScopedCacheTags === null ? null : [...oldScopedCacheTags, ...newScopedCacheTags];
				await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
			}
		}
		return keys;
	}
	async updateMany(keys, data, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (!opts.bypassLimits) opts.mutationTracker.trackMutations(keys.length);
		const { ActivityService } = await import("./activity.js");
		const { RevisionsService } = await import("./revisions.js");
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(keys);
		const fields = Object.keys(this.schema.collections[this.collection].fields);
		const aliases = Object.values(this.schema.collections[this.collection].fields).filter((field) => field.alias === true).map((field) => field.field);
		const payload = cloneDeep(data);
		const nestedActionEvents = [];
		const scopedCacheCollector = opts.scopedCacheCollector ?? createScopedCacheCollector(this.schema);
		const payloadAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.update", `${this.collection}.items.update`] : `${this.eventScope}.update`, payload, {
			keys,
			collection: this.collection
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
			scopedCache: scopedCacheCollector.purge
		}) : payload;
		if (payloadAfterHooks === null) {
			if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: `A filter hook cancelled the update, but this operation requires it` });
			if (scopedCacheCollector.tags.length > 0 && shouldClearCache(this.cache, opts, this.collection)) this.scopedCachePurged = await purgeScopedCache(this.cache, this.collection, scopedCacheCollector.tags, this.scopedCachePurgeContext(), { includeCollectionTag: false });
			return keys.map(() => null);
		}
		const isEmptyAlterations = (value) => {
			if (!isPlainObject(value)) return false;
			const alterations = value;
			if (Object.keys(alterations).some((key) => !ALTERATIONS_KEYS.includes(key))) return false;
			return ALTERATIONS_KEYS.every((operation) => !alterations[operation]?.length);
		};
		const changesNothing = (field) => {
			if (field === primaryKeyField) return true;
			if (aliases.includes(field)) return isEmptyAlterations(payloadAfterHooks[field]);
			return false;
		};
		if (Object.keys(payloadAfterHooks ?? {}).filter((field) => !changesNothing(field)).length === 0) return [];
		keys.sort();
		if (this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "update",
			collection: this.collection,
			primaryKeys: keys,
			fields: Object.keys(payloadAfterHooks)
		}, {
			schema: this.schema,
			knex: this.knex
		});
		const payloadWithPresets = this.accountability ? await processPayload({
			accountability: this.accountability,
			action: "update",
			collection: this.collection,
			payload: payloadAfterHooks,
			nested: this.nested
		}, {
			knex: this.knex,
			schema: this.schema
		}) : payloadAfterHooks;
		if (opts.preMutationError) throw opts.preMutationError;
		await transaction(this.knex, async (trx) => {
			const payloadService = new PayloadService(this.collection, {
				accountability: this.accountability,
				knex: trx,
				schema: this.schema,
				nested: this.nested
			});
			const { payload: payloadWithM2O, revisions: revisionsM2O, nestedActionEvents: nestedActionEventsM2O, userIntegrityCheckFlags: userIntegrityCheckFlagsM2O } = await payloadService.processM2O(payloadWithPresets, opts);
			const { payload: payloadWithA2O, revisions: revisionsA2O, nestedActionEvents: nestedActionEventsA2O, userIntegrityCheckFlags: userIntegrityCheckFlagsA2O } = await payloadService.processA2O(payloadWithM2O, opts);
			const payloadWithoutAliasAndPK = pick(payloadWithA2O, without(fields, primaryKeyField, ...aliases));
			const payloadWithTypeCasting = await payloadService.processValues("update", payloadWithoutAliasAndPK);
			if (Object.keys(payloadWithTypeCasting).length > 0) try {
				await trx(this.collection).update(payloadWithTypeCasting).whereIn(primaryKeyField, keys);
			} catch (err) {
				throw await translateDatabaseError(err, data, this.knex, {
					collection: this.collection,
					operation: "update"
				});
			}
			const childrenRevisions = [...revisionsM2O, ...revisionsA2O];
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None | userIntegrityCheckFlagsM2O | userIntegrityCheckFlagsA2O;
			nestedActionEvents.push(...nestedActionEventsM2O);
			nestedActionEvents.push(...nestedActionEventsA2O);
			for (const key of keys) {
				const { revisions, nestedActionEvents: nestedActionEventsO2M, userIntegrityCheckFlags: userIntegrityCheckFlagsO2M } = await payloadService.processO2M(payloadWithA2O, key, opts);
				childrenRevisions.push(...revisions);
				nestedActionEvents.push(...nestedActionEventsO2M);
				userIntegrityCheckFlags |= userIntegrityCheckFlagsO2M;
			}
			if (userIntegrityCheckFlags) if (opts?.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: userIntegrityCheckFlags,
				knex: trx
			});
			if (this.accountability && this.schema.collections[this.collection].accountability !== null) {
				const activity = await new ActivityService({
					knex: trx,
					schema: this.schema
				}).createMany(keys.map((key) => ({
					action: Action.UPDATE,
					user: this.accountability.user,
					collection: this.collection,
					ip: this.accountability.ip,
					user_agent: this.accountability.userAgent,
					origin: this.accountability.origin,
					item: key
				})), { bypassLimits: true });
				if (this.schema.collections[this.collection].accountability === "all") {
					const snapshots = await new ItemsService(this.collection, {
						knex: trx,
						schema: this.schema
					}).readMany(keys);
					const snapshotJsonByKey = /* @__PURE__ */ new Map();
					if (Array.isArray(snapshots)) for (const snapshot of snapshots) snapshotJsonByKey.set(String(snapshot[primaryKeyField]), JSON.stringify(snapshot));
					const revisionsService = new RevisionsService({
						knex: trx,
						schema: this.schema
					});
					const revisions = (await Promise.all(activity.map(async (activity$1, index) => ({
						activity: activity$1,
						collection: this.collection,
						item: keys[index],
						data: snapshots && Array.isArray(snapshots) ? snapshotJsonByKey.get(String(keys[index])) : JSON.stringify(snapshots),
						delta: await payloadService.prepareDelta(payloadWithTypeCasting)
					})))).filter((revision) => revision.delta);
					const revisionIDs = await revisionsService.createMany(revisions);
					for (let i = 0; i < revisionIDs.length; i++) {
						const revisionID = revisionIDs[i];
						if (opts.onRevisionCreate) opts.onRevisionCreate(revisionID);
						if (i === 0) {
							if (childrenRevisions.length > 0) await revisionsService.updateMany(childrenRevisions, { parent: revisionID });
						}
					}
				}
			}
		}, opts.mutationTracker.snapshot());
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const newScopedCacheTags = await this.snapshotScopedCacheTags(keys);
			const scopedCacheTags = oldScopedCacheTags === null || newScopedCacheTags === null ? null : [...oldScopedCacheTags, ...newScopedCacheTags];
			await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
		}
		if (opts.emitEvents !== false) await emitActionEvents([{
			event: this.eventScope === "items" ? ["items.update", `${this.collection}.items.update`] : `${this.eventScope}.update`,
			meta: {
				payload: payloadWithPresets,
				keys,
				collection: this.collection
			},
			context: {
				database: database_default(),
				schema: this.schema,
				accountability: this.accountability
			}
		}, ...nestedActionEvents], opts);
		return keys;
	}
	/**
	* Upsert a single item.
	*
	* Uses `this.createOne` / `this.updateOne` under the hood.
	*/
	async upsertOne(payload, opts) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const primaryKey = payload[primaryKeyField];
		if (primaryKey) validateKeys(this.schema, this.collection, primaryKeyField, primaryKey);
		if (primaryKey && !!await this.knex.select(primaryKeyField).from(this.collection).where({ [primaryKeyField]: primaryKey }).first()) {
			const { [primaryKeyField]: _,...data } = payload;
			return await this.updateOne(primaryKey, data, opts);
		} else return await this.createOne(payload, opts);
	}
	/**
	* Upsert many items.
	*
	* Uses `this.upsertOne` under the hood.
	*/
	async upsertMany(payloads, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const inputKeys = payloads.flatMap((payload) => {
			const key = payload[primaryKeyField];
			return isPrimaryKey(key) ? [key] : [];
		});
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(inputKeys);
		const scopedCacheCollector = createScopedCacheCollector(this.schema);
		const primaryKeys = await transaction(this.knex, async (knex) => {
			const service = this.fork({ knex });
			const primaryKeys$1 = [];
			for (const payload of payloads) {
				const primaryKey = await service.upsertOne(payload, {
					...opts || {},
					autoPurgeCache: false,
					scopedCacheCollector
				});
				primaryKeys$1.push(primaryKey);
			}
			return primaryKeys$1;
		}, opts.mutationTracker.snapshot());
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const newScopedCacheTags = await this.snapshotScopedCacheTags(primaryKeys.filter((key) => key !== null && key !== void 0));
			const scopedCacheTags = oldScopedCacheTags === null || newScopedCacheTags === null ? null : [...oldScopedCacheTags, ...newScopedCacheTags];
			await this.purgeScopedCache(scopedCacheTags, scopedCacheCollector);
		}
		return primaryKeys;
	}
	/**
	* Delete multiple items by query.
	*
	* Uses `this.deleteMany` under the hood.
	*/
	async deleteByQuery(query, opts) {
		const keys = await this.getKeysByQuery(query);
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
		return keys.length ? await this.deleteMany(keys, opts) : [];
	}
	/**
	* Delete a single item by primary key.
	*
	* Uses `this.deleteMany` under the hood.
	*/
	async deleteOne(key, opts) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, key);
		await this.deleteMany([key], opts);
		return key;
	}
	async deleteMany(keys, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (!opts.bypassLimits) opts.mutationTracker.trackMutations(keys.length);
		const { ActivityService } = await import("./activity.js");
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
		const scopedCacheCollector = opts.scopedCacheCollector ?? createScopedCacheCollector(this.schema);
		const keysAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`, keys, { collection: this.collection }, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
			scopedCache: scopedCacheCollector.purge
		}) : keys;
		if (keysAfterHooks === null) {
			if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: `A filter hook cancelled the deletion, but this operation requires it` });
			if (scopedCacheCollector.tags.length > 0 && shouldClearCache(this.cache, opts, this.collection)) this.scopedCachePurged = await purgeScopedCache(this.cache, this.collection, scopedCacheCollector.tags, this.scopedCachePurgeContext(), { includeCollectionTag: false });
			return keys.map(() => null);
		}
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(keysAfterHooks);
		if (this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "delete",
			collection: this.collection,
			primaryKeys: keys
		}, {
			knex: this.knex,
			schema: this.schema
		});
		if (opts.preMutationError) throw opts.preMutationError;
		await transaction(this.knex, async (trx) => {
			try {
				await trx(this.collection).whereIn(primaryKeyField, keys).delete();
			} catch (err) {
				throw await translateDatabaseError(err, {}, this.knex, {
					collection: this.collection,
					operation: "delete"
				});
			}
			if (opts.userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(opts.userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: opts.userIntegrityCheckFlags,
				knex: trx
			});
			if (this.accountability && this.schema.collections[this.collection].accountability !== null) await new ActivityService({
				knex: trx,
				schema: this.schema
			}).createMany(keys.map((key) => ({
				action: Action.DELETE,
				user: this.accountability.user,
				collection: this.collection,
				ip: this.accountability.ip,
				user_agent: this.accountability.userAgent,
				origin: this.accountability.origin,
				item: key
			})), { bypassLimits: true });
		}, opts.mutationTracker.snapshot());
		if (shouldClearCache(this.cache, opts, this.collection)) await this.purgeScopedCache(oldScopedCacheTags, scopedCacheCollector, scopedCacheCollectionsChangedByOnDelete(this.schema, this.collection));
		if (opts.emitEvents !== false) await emitActionEvents([{
			event: this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`,
			meta: {
				payload: keys,
				keys,
				collection: this.collection
			},
			context: {
				database: database_default(),
				schema: this.schema,
				accountability: this.accountability
			}
		}], opts);
		return keys;
	}
	/**
	* Read/treat collection as singleton.
	*/
	async readSingleton(query, opts) {
		query = clone(query);
		query.limit = 1;
		const records = await this.readByQuery(query, opts);
		const meta = readMeta(records) ?? { scopedCacheTags: [] };
		const record = records[0];
		if (!record) {
			let fields = Object.entries(this.schema.collections[this.collection].fields);
			const defaults = {};
			if (query.fields && query.fields.includes("*") === false) fields = fields.filter(([name]) => {
				return query.fields.includes(name);
			});
			for (const [name, field] of fields) {
				if (this.schema.collections[this.collection].primary === name) {
					defaults[name] = null;
					continue;
				}
				if (field.defaultValue !== null) defaults[name] = field.defaultValue;
			}
			return withMeta(defaults, meta);
		}
		return withMeta(record, meta);
	}
	/**
	* Upsert/treat collection as singleton.
	*
	* Uses `this.createOne` / `this.updateOne` under the hood.
	*/
	async upsertSingleton(data, opts) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const record = await this.knex.select(primaryKeyField).from(this.collection).limit(1).first();
		if (record) return await this.updateOne(record[primaryKeyField], data, opts);
		return await this.createOne(data, opts);
	}
};

//#endregion
export { ItemsService };