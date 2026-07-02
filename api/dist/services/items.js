import { getCache } from "../cache.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { pinnedScopedCacheTagsFromFilter, purgeScopedCache, scopedCachePurgeEnabled, scopedCacheTagsFromRows } from "../scoped-cache.js";
import { fieldMapFromAst } from "../permissions/modules/process-ast/lib/field-map-from-ast.js";
import { collectionsInFieldMap } from "../permissions/modules/process-ast/utils/collections-in-field-map.js";
import { processAst } from "../permissions/modules/process-ast/process-ast.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { translateDatabaseError } from "../database/errors/translate.js";
import { getAstFromQuery } from "../database/get-ast-from-query/get-ast-from-query.js";
import { PayloadService } from "./payload.js";
import { runAst } from "../database/run-ast/run-ast.js";
import { processPayload } from "../permissions/modules/process-payload/process-payload.js";
import { readMeta, withMeta } from "../utils/read-meta.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { transaction } from "../utils/transaction.js";
import { validateKeys } from "../utils/validate-keys.js";
import { validateUserCountIntegrity } from "../utils/validate-user-count-integrity.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { assign, clone, cloneDeep, isPlainObject, omit, pick, without } from "lodash-es";
import { ALTERATIONS_KEYS, Action } from "@directus/constants";
import { isSystemCollection } from "@directus/system-data";
import { UserIntegrityCheckFlag } from "@directus/types";

//#region src/services/items.ts
const env = useEnv();
/**
* Emit a mutation's action events (the item's own event plus any queued nested ones) in parallel.
* They run together, so a slow handler on one event doesn't serialize the rest. By default the
* mutation does not wait for them (Directus' historical fire-and-forget behaviour); pass
* `awaitActionHooks` to block until every handler has settled.
*/
async function emitActionEvents(actionEvents, opts) {
	const emitting = Promise.all(actionEvents.map((actionEvent) => opts.bypassEmitAction ? opts.bypassEmitAction(actionEvent) : emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context)));
	if (opts.awaitActionHooks) await emitting;
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
	constructor(collection, options) {
		this.collection = collection;
		this.knex = options.knex || database_default();
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
	* must drop both). Returns an empty list when the collection has no scoped cache
	* fields or there are no keys (a collection-level purge then suffices).
	*/
	async snapshotScopedCacheTags(keys) {
		if (!scopedCachePurgeEnabled()) return [];
		const scopedCacheFields = this.collectionScopedCacheFields;
		if (scopedCacheFields.length === 0 || keys.length === 0) return [];
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const rows = await this.knex.select(primaryKeyField, ...scopedCacheFields).from(this.collection).whereIn(primaryKeyField, keys);
		return scopedCacheTagsFromRows(this.collection, scopedCacheFields, rows, "coarse", this.collectionScopedCacheFieldTypes);
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
	async purgeScopedCache(tags) {
		await purgeScopedCache(this.cache, this.collection, tags, this.scopedCachePurgeContext());
	}
	get collectionScopedCacheFields() {
		return this.schema.collections[this.collection]?.scopedCacheFields ?? [];
	}
	get collectionScopedCacheFieldTypes() {
		const fields = this.schema.collections[this.collection]?.fields ?? {};
		return Object.fromEntries(this.collectionScopedCacheFields.map((field) => [field, fields[field]?.type]));
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
					accountability: this.accountability
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
				const dbError = await translateDatabaseError(err, data);
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
		});
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
			const scopedCacheFields = this.collectionScopedCacheFields;
			let scopedCacheTags = [];
			if (scopedCacheFields.length > 0) {
				const liveKeys = results.filter((key) => key !== null);
				scopedCacheTags = liveKeys.length > actionPayloads.length ? null : await this.snapshotScopedCacheTags(liveKeys);
			}
			await this.purgeScopedCache(scopedCacheTags);
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
		const records = await runAst(ast, this.schema, this.accountability, {
			knex: this.knex,
			stripNonRequested: opts?.stripNonRequested !== void 0 ? opts.stripNonRequested : true
		});
		if (records === null) throw new ForbiddenError();
		const filteredRecords = opts?.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.read", `${this.collection}.items.read`] : `${this.eventScope}.read`, records, {
			query: updatedQuery,
			collection: this.collection
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		}) : records;
		let scopedCacheTags = [];
		if (scopedCachePurgeEnabled()) {
			const scopedCacheFields = this.collectionScopedCacheFields;
			const fieldMap = fieldMapFromAst(ast, this.schema);
			const rootPaths = /* @__PURE__ */ new Set();
			for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) if (entry.collection === this.collection) rootPaths.add(path);
			const rootScopedCacheTags = rootPaths.size > 1 ? [] : pinnedScopedCacheTagsFromFilter(this.collection, scopedCacheFields, updatedQuery.filter, this.collectionScopedCacheFieldTypes);
			for (const collection of collectionsInFieldMap(fieldMap)) if (collection === this.collection && rootScopedCacheTags.length > 0) scopedCacheTags.push(...rootScopedCacheTags);
			else scopedCacheTags.push({ collection });
			scopedCacheTags = await emitter_default.emitFilter("cache.scope", scopedCacheTags, {
				collection: this.collection,
				query: updatedQuery,
				records: filteredRecords
			}, {
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability
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
		return withMeta(filteredRecords, { scopedCacheTags });
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
		const batchKeys = data.map((item) => item[primaryKeyField]).filter((key) => key !== void 0 && key !== null);
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(batchKeys);
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
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags
					};
					keys.push(await service.updateOne(primaryKey, omit(item, primaryKeyField), combinedOpts));
				}
				if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
				else await validateUserCountIntegrity({
					flags: userIntegrityCheckFlags,
					knex
				});
			});
		} finally {
			if (shouldClearCache(this.cache, opts, this.collection)) {
				const newScopedCacheTags = await this.snapshotScopedCacheTags(batchKeys);
				const scopedCacheTags = oldScopedCacheTags === null || newScopedCacheTags === null ? null : [...oldScopedCacheTags, ...newScopedCacheTags];
				await this.purgeScopedCache(scopedCacheTags);
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
		const payloadAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.update", `${this.collection}.items.update`] : `${this.eventScope}.update`, payload, {
			keys,
			collection: this.collection
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		}) : payload;
		if (payloadAfterHooks === null) {
			if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: `A filter hook cancelled the update, but this operation requires it` });
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
				throw await translateDatabaseError(err, data);
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
					const revisionsService = new RevisionsService({
						knex: trx,
						schema: this.schema
					});
					const revisions = (await Promise.all(activity.map(async (activity$1, index) => ({
						activity: activity$1,
						collection: this.collection,
						item: keys[index],
						data: snapshots && Array.isArray(snapshots) ? JSON.stringify(snapshots[index]) : JSON.stringify(snapshots),
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
		});
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const newScopedCacheTags = await this.snapshotScopedCacheTags(keys);
			const scopedCacheTags = oldScopedCacheTags === null || newScopedCacheTags === null ? null : [...oldScopedCacheTags, ...newScopedCacheTags];
			await this.purgeScopedCache(scopedCacheTags);
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
		const inputKeys = payloads.map((payload) => payload[primaryKeyField]).filter((key) => key !== void 0 && key !== null);
		const oldScopedCacheTags = await this.snapshotScopedCacheTags(inputKeys);
		const primaryKeys = await transaction(this.knex, async (knex) => {
			const service = this.fork({ knex });
			const primaryKeys$1 = [];
			for (const payload of payloads) {
				const primaryKey = await service.upsertOne(payload, {
					...opts || {},
					autoPurgeCache: false
				});
				primaryKeys$1.push(primaryKey);
			}
			return primaryKeys$1;
		});
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const newScopedCacheTags = await this.snapshotScopedCacheTags(primaryKeys.filter((key) => key !== null && key !== void 0));
			const scopedCacheTags = oldScopedCacheTags === null || newScopedCacheTags === null ? null : [...oldScopedCacheTags, ...newScopedCacheTags];
			await this.purgeScopedCache(scopedCacheTags);
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
		const keysAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`, keys, { collection: this.collection }, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		}) : keys;
		if (keysAfterHooks === null) {
			if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: `A filter hook cancelled the deletion, but this operation requires it` });
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
		if (opts.emitEvents !== false) await emitter_default.emitFilter(this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`, keys, { collection: this.collection }, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
		await transaction(this.knex, async (trx) => {
			await trx(this.collection).whereIn(primaryKeyField, keys).delete();
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
		});
		if (shouldClearCache(this.cache, opts, this.collection)) await this.purgeScopedCache(oldScopedCacheTags);
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