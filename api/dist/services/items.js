import { assign, clone, cloneDeep, isEqual, isPlainObject, omit, pick, without } from "../utils/lodash-es-used.js";
import { takenOverScopedCacheKey } from "../scoped-cache/pins.js";
import { createScopedCacheHookDeclarations } from "../scoped-cache/hook-declarations.js";
import { foldScopedCacheEpochsFromHookDeclarations, readScopedCacheEpochs } from "../scoped-cache/fill-guard.js";
import { scopedCacheMutatedFingerprints, scopedCacheUpdatedRows, scopedCacheWrittenRows } from "../scoped-cache/mutated-rows.js";
import { stripScopedCacheOwnershipInjections, withScopedCacheOwnershipInjections } from "../scoped-cache/ownership-injection.js";
import { getDatabaseForAccountability } from "../database/connections.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { scopedCacheCollectionsChangedByOnDelete } from "../scoped-cache/purge.js";
import { transaction } from "../utils/transaction.js";
import { ItemScopedCacheService } from "../scoped-cache/item-scoped-cache-service.js";
import "../scoped-cache/index.js";
import { getCache } from "../cache.js";
import { readMeta, withMeta } from "../utils/read-meta.js";
import { processAst } from "../permissions/modules/process-ast/process-ast.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { translateDatabaseError } from "../database/errors/translate.js";
import { getAstFromQuery } from "../database/get-ast-from-query/get-ast-from-query.js";
import { PayloadService } from "./payload.js";
import { runAst } from "../database/run-ast/run-ast.js";
import { processPayload } from "../permissions/modules/process-payload/process-payload.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { isPrimaryKey } from "../utils/is-primary-key.js";
import { validateKeys } from "../utils/validate-keys.js";
import { validateUserCountIntegrity } from "../utils/validate-user-count-integrity.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { oneLine } from "@directus/utils";
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
/**
* Whether a grouped `items.create` filter answered one entry per row it received,
* each a `CreateEntry` or `null`, a `sameRowAs` pointing at an earlier position.
*/
function isCreateEntryList(entriesAfterHooks, rowCount) {
	if (!Array.isArray(entriesAfterHooks) || entriesAfterHooks.length !== rowCount) return false;
	return entriesAfterHooks.every((entry, index) => {
		if (entry === null) return true;
		if (!isPlainObject(entry) || Object.keys(entry).length !== 1) return false;
		if ("data" in entry) return isPlainObject(entry.data);
		if ("key" in entry) return isPrimaryKey(entry.key);
		return "sameRowAs" in entry && Number.isInteger(entry.sameRowAs) && entry.sameRowAs >= 0 && entry.sameRowAs < index;
	});
}
/**
* Merge the groups carrying the same change, wherever they sit, so one statement
* writes them all. A group never joins one written before a later change to one of
* its own rows, so two changes to the same row still land in the caller's order.
*/
function mergeUpdateGroups(candidateGroups) {
	const mergedGroups = [];
	const groupIndexByData = /* @__PURE__ */ new Map();
	const lastGroupIndexByKey = /* @__PURE__ */ new Map();
	for (const candidateGroup of candidateGroups) {
		const serializedData = JSON.stringify(candidateGroup.data, (_field, value) => {
			return typeof value === "bigint" ? value.toString() : value;
		});
		let latestConflictIndex = -1;
		for (const key of candidateGroup.keys) latestConflictIndex = Math.max(latestConflictIndex, lastGroupIndexByKey.get(String(key)) ?? -1);
		const sameDataIndex = groupIndexByData.get(serializedData);
		let targetIndex;
		if (sameDataIndex !== void 0 && sameDataIndex >= latestConflictIndex && isEqual(mergedGroups[sameDataIndex].data, candidateGroup.data)) {
			targetIndex = sameDataIndex;
			for (const key of candidateGroup.keys) mergedGroups[targetIndex].keys.push(key);
		} else {
			targetIndex = mergedGroups.length;
			mergedGroups.push({
				data: candidateGroup.data,
				keys: [...candidateGroup.keys]
			});
			groupIndexByData.set(serializedData, targetIndex);
		}
		for (const key of candidateGroup.keys) lastGroupIndexByKey.set(String(key), targetIndex);
	}
	return mergedGroups;
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
	scopedCache;
	constructor(collection, options) {
		this.collection = collection;
		this.knex = options.knex || getDatabaseForAccountability(options.accountability);
		this.accountability = options.accountability || null;
		this.eventScope = isSystemCollection(this.collection) ? this.collection.substring(9) : "items";
		this.schema = options.schema;
		this.cache = getCache().cache;
		this.nested = options.nested ?? [];
		this.scopedCache = new ItemScopedCacheService(this.collection, this.schema, this.knex, this.cache, this.accountability);
		return this;
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
		}).readByQuery(readQuery, { skipScopedCacheEpochs: true })).map((item) => item[primaryKeyField]).filter((pk) => pk);
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
		const resetsAutoIncrementSequence = pkField !== void 0 && !opts.bypassAutoIncrementSequenceReset && ["integer", "bigInteger"].includes(pkField.type) && pkField.defaultValue === "AUTO_INCREMENT";
		const results = new Array(data.length);
		const createEvent = this.eventScope === "items" ? ["items.create", `${this.collection}.items.create`] : `${this.eventScope}.create`;
		const rowEvent = this.eventScope === "items" ? ["items.create.one", `${this.collection}.items.create.one`] : `${this.eventScope}.create.one`;
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations ?? createScopedCacheHookDeclarations(this.schema);
		const declaredPurgesAtStart = scopedCacheHookDeclarations.purgeFingerprints.length;
		const { nestedActionEvents, actionPayloads } = await transaction(this.knex, async (trx) => {
			const nestedActionEvents$1 = [];
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
			let autoIncrementSequenceNeedsToBeReset = false;
			const prepared = [];
			const sameRowPositions = [];
			const filterContext = {
				database: trx,
				schema: this.schema,
				accountability: this.accountability,
				scopedCache: scopedCacheHookDeclarations.purge
			};
			const entries = data.map((row) => {
				return { data: cloneDeep(row) };
			});
			const entriesAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(createEvent, entries, { collection: this.collection }, filterContext) : entries;
			const createEntries = entriesAfterHooks === null ? data.map(() => null) : entriesAfterHooks;
			if (!isCreateEntryList(createEntries, data.length)) throw new InvalidPayloadError({ reason: oneLine`
						A "${this.eventScope}.create" filter hook must return one
						{ data } | { key } | { sameRowAs } | null per row it received, a
						sameRowAs pointing at an earlier row; a hook that handles one row
						belongs on "${this.eventScope}.create.one"
					` });
			for (const [index, entry] of createEntries.entries()) {
				if (entry !== null && "sameRowAs" in entry) {
					sameRowPositions.push({
						index,
						sameRowAs: entry.sameRowAs
					});
					continue;
				}
				let payloadAfterHooks = null;
				if (entry !== null && "key" in entry) payloadAfterHooks = entry.key;
				else if (entry !== null) payloadAfterHooks = opts.emitEvents !== false && emitter_default.hasFilterListeners(rowEvent) ? await emitter_default.emitFilter(rowEvent, entry.data, { collection: this.collection }, filterContext) : entry.data;
				if (typeof payloadAfterHooks === "string" || typeof payloadAfterHooks === "number") {
					scopedCacheHookDeclarations.takenOverKeys.add(takenOverScopedCacheKey(this.collection, payloadAfterHooks));
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
				if (primaryKey && resetsAutoIncrementSequence) autoIncrementSequenceNeedsToBeReset = true;
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
			if (autoIncrementSequenceNeedsToBeReset) {
				const providedPrimaryKeys = prepared.map((p) => Number(p.primaryKey)).filter((key) => Number.isFinite(key));
				if (providedPrimaryKeys.length < prepared.length) await getHelpers(trx).sequence.raiseAutoIncrementSequence(this.collection, primaryKeyField, Math.max(...providedPrimaryKeys));
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
			for (const { index, sameRowAs } of sameRowPositions) results[index] = results[sameRowAs];
			return {
				nestedActionEvents: nestedActionEvents$1,
				actionPayloads: postPrepared.map((p) => ({
					primaryKey: p.primaryKey,
					actionHookPayload: p.actionHookPayload
				}))
			};
		}, opts.mutationTracker.snapshot());
		if (opts.emitEvents !== false && actionPayloads.length > 0) {
			const actionContext = {
				database: database_default(),
				schema: this.schema,
				accountability: this.accountability
			};
			const rowActionEvents = emitter_default.hasActionListeners(rowEvent) ? actionPayloads.map(({ primaryKey, actionHookPayload }) => {
				return {
					event: rowEvent,
					meta: {
						payload: actionHookPayload,
						key: primaryKey,
						collection: this.collection
					},
					context: actionContext
				};
			}) : [];
			await emitActionEvents([
				{
					event: createEvent,
					meta: {
						payload: actionPayloads.map(({ actionHookPayload }) => {
							return actionHookPayload;
						}),
						keys: actionPayloads.map(({ primaryKey }) => primaryKey),
						collection: this.collection
					},
					context: actionContext
				},
				...rowActionEvents,
				...nestedActionEvents
			], opts);
		}
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const changedKeys = [...new Set(results.filter((key) => key !== null))].filter((key) => {
				return !scopedCacheHookDeclarations.purgeSkippedKeys.has(String(key));
			});
			if (changedKeys.length === 0 && scopedCacheHookDeclarations.purgeFingerprints.length === declaredPurgesAtStart) return results;
			const scopedCacheSnapshot = changedKeys.length > actionPayloads.length && scopedCacheHookDeclarations.purgeFingerprints.length === declaredPurgesAtStart ? null : await this.scopedCache.snapshot(changedKeys);
			this.scopedCachePurged = await this.scopedCache.purge(scopedCacheMutatedFingerprints(scopedCacheSnapshot), scopedCacheHookDeclarations, [], {
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: scopedCacheWrittenRows(scopedCacheSnapshot)
			});
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
		const ownershipInjections = this.scopedCache.ownershipInjections(updatedQuery);
		let ast = await getAstFromQuery({
			collection: this.collection,
			query: withScopedCacheOwnershipInjections(updatedQuery, ownershipInjections),
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
		const scopedCachePlan = this.scopedCache.planRead(ast, ownershipInjections);
		const scopedCacheEpochs = opts?.skipScopedCacheEpochs === true ? {} : await readScopedCacheEpochs(scopedCachePlan.collectionsToGuard());
		const records = await runAst(ast, this.schema, this.accountability, {
			knex: this.knex,
			stripNonRequested: opts?.stripNonRequested !== void 0 ? opts.stripNonRequested : true,
			onRowsWithTemporaryFields: (rows) => scopedCachePlan.pinFromRows(rows)
		});
		if (records === null) throw new ForbiddenError();
		const scopedCacheHookDeclarations = createScopedCacheHookDeclarations(this.schema);
		const filteredRecords = opts?.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.read", `${this.collection}.items.read`] : `${this.eventScope}.read`, records, {
			query: updatedQuery,
			collection: this.collection
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
			scopedCache: scopedCacheHookDeclarations.scope
		}) : records;
		const { fingerprints: scopedCacheFingerprints, unautopurgeable: scopedCacheUnautopurgeableFingerprints } = await this.scopedCache.readFingerprints({
			ast,
			plan: scopedCachePlan,
			updatedQuery,
			filteredRecords,
			hookDeclarations: scopedCacheHookDeclarations
		});
		if (opts?.emitEvents !== false) emitter_default.emitAction(this.eventScope === "items" ? ["items.read", `${this.collection}.items.read`] : `${this.eventScope}.read`, {
			payload: filteredRecords,
			query: updatedQuery,
			collection: this.collection
		}, {
			database: this.knex || database_default(),
			schema: this.schema,
			accountability: this.accountability
		});
		stripScopedCacheOwnershipInjections(filteredRecords, ownershipInjections);
		return withMeta(filteredRecords, {
			scopedCacheFingerprints,
			scopedCacheUnautopurgeableFingerprints,
			scopedCacheEpochs: foldScopedCacheEpochsFromHookDeclarations(scopedCacheEpochs, scopedCacheHookDeclarations.epochs)
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
		return withMeta(results[0], readMeta(results) ?? { scopedCacheFingerprints: [] });
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
		const primaryKeyField = this.schema.collections[this.collection].primary;
		return await this.updateGroups(data.map((item) => {
			const primaryKey = item[primaryKeyField];
			if (!primaryKey) throw new InvalidPayloadError({ reason: `Item in update misses primary key` });
			return {
				data: omit(item, primaryKeyField),
				keys: [primaryKey]
			};
		}), opts);
	}
	async updateMany(keys, data, opts = {}) {
		return await this.updateGroups([{
			data,
			keys
		}], opts);
	}
	/**
	* Whether a group would write nothing: an empty payload, a primary-key-only one,
	* or one whose every field is an alterations object carrying no item. Decided
	* before the transaction opens, so a no-op update costs no round trip.
	*/
	groupChangesNothing(group, aliases) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const payloadAfterHooks = group.data;
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
		return Object.keys(payloadAfterHooks ?? {}).every(changesNothing);
	}
	/**
	* Update rows in groups, each group one change applied to the keys it names.
	*
	* Every update entrypoint funnels through here so the `items.update` events fire
	* once for the whole update, carrying every group, rather than once per row.
	*/
	async updateGroups(groups, opts = {}) {
		const mutationTracker = opts.mutationTracker ?? this.createMutationTracker();
		opts.mutationTracker = mutationTracker;
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const inputKeys = groups.flatMap((group) => group.keys);
		if (!opts.bypassLimits) mutationTracker.trackMutations(inputKeys.length);
		validateKeys(this.schema, this.collection, primaryKeyField, inputKeys);
		const updateEvent = this.eventScope === "items" ? ["items.update", `${this.collection}.items.update`] : `${this.eventScope}.update`;
		const rowEvent = this.eventScope === "items" ? ["items.update.one", `${this.collection}.items.update.one`] : `${this.eventScope}.update.one`;
		const eventContext = {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		};
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations ?? createScopedCacheHookDeclarations(this.schema);
		const payload = groups.map((group) => {
			return {
				data: cloneDeep(group.data),
				keys: [...group.keys]
			};
		});
		const groupsAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(updateEvent, payload, { collection: this.collection }, {
			...eventContext,
			scopedCache: scopedCacheHookDeclarations.purge
		}) : payload;
		if (groupsAfterHooks === null) {
			if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: `A filter hook cancelled the update, but this operation requires it` });
			await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
			return inputKeys.map(() => null);
		}
		if (!(Array.isArray(groupsAfterHooks) && groupsAfterHooks.every((group) => isPlainObject(group?.data) && Array.isArray(group?.keys)))) throw new InvalidPayloadError({ reason: oneLine`
					A "${this.eventScope}.update" filter hook must return the
					{ data, keys }[] it received; a hook that handles one row belongs on
					"${this.eventScope}.update.one"
				` });
		const keys = groupsAfterHooks.flatMap((group) => group.keys);
		if (!opts.bypassLimits && keys.length > inputKeys.length) mutationTracker.trackMutations(keys.length - inputKeys.length);
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
		let rowKeys = [];
		let candidateGroups = [];
		if (opts.emitEvents !== false && emitter_default.hasFilterListeners(rowEvent)) for (const group of groupsAfterHooks) for (const key of group.keys) {
			const rowAfterHooks = await emitter_default.emitFilter(rowEvent, {
				[primaryKeyField]: key,
				...cloneDeep(group.data)
			}, { collection: this.collection }, {
				...eventContext,
				scopedCache: scopedCacheHookDeclarations.purge
			});
			if (rowAfterHooks === null) {
				if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: oneLine`
									A filter hook cancelled a row of the update, but this operation
									requires it
								` });
				rowKeys.push(null);
				continue;
			}
			if (!isPlainObject(rowAfterHooks)) throw new InvalidPayloadError({ reason: oneLine`
								A "${this.eventScope}.update.one" filter hook must return the row
								it received, or null to cancel it
							` });
			rowKeys.push(key);
			candidateGroups.push({
				data: omit(rowAfterHooks, primaryKeyField),
				keys: [key]
			});
		}
		else {
			rowKeys = keys;
			candidateGroups = groupsAfterHooks;
		}
		const mergedGroups = mergeUpdateGroups(candidateGroups);
		const aliases = Object.values(this.schema.collections[this.collection].fields).filter((field) => field.alias === true).map((field) => field.field);
		const writingGroups = mergedGroups.filter((group) => {
			return !this.groupChangesNothing(group, aliases);
		});
		const writtenKeys = writingGroups.flatMap((group) => group.keys);
		const oldScopedCacheSnapshot = await this.scopedCache.snapshot(writtenKeys);
		if (writingGroups.length === 0) {
			await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
			return rowKeys;
		}
		const { applied, nestedActionEvents } = await transaction(this.knex, async (trx) => {
			const service = this.fork({ knex: trx });
			const applied$1 = [];
			const nestedActionEvents$1 = [];
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
			for (const group of writingGroups) {
				const result = await service.applyUpdateGroup(group, aliases, {
					...opts,
					mutationTracker,
					onRequireUserIntegrityCheck: (flags) => {
						userIntegrityCheckFlags |= flags;
					}
				}, nestedActionEvents$1);
				applied$1.push(result);
			}
			if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: userIntegrityCheckFlags,
				knex: trx
			});
			return {
				applied: applied$1,
				nestedActionEvents: nestedActionEvents$1
			};
		}, mutationTracker.snapshot()).catch(async (error) => {
			await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
			throw error;
		});
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const newScopedCacheSnapshot = await this.scopedCache.snapshot(writtenKeys);
			this.scopedCachePurged = await this.scopedCache.purge(scopedCacheMutatedFingerprints(oldScopedCacheSnapshot, newScopedCacheSnapshot), scopedCacheHookDeclarations, [], {
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: scopedCacheUpdatedRows(oldScopedCacheSnapshot, newScopedCacheSnapshot)
			});
		}
		if (opts.emitEvents !== false) {
			const actionContext = {
				database: database_default(),
				schema: this.schema,
				accountability: this.accountability
			};
			const rowActionEvents = emitter_default.hasActionListeners(rowEvent) ? applied.flatMap((group) => {
				return group.keys.map((key) => {
					return {
						event: rowEvent,
						meta: {
							payload: {
								[primaryKeyField]: key,
								...group.data
							},
							collection: this.collection
						},
						context: actionContext
					};
				});
			}) : [];
			await emitActionEvents([
				{
					event: updateEvent,
					meta: {
						payload: applied,
						collection: this.collection
					},
					context: actionContext
				},
				...rowActionEvents,
				...nestedActionEvents
			], opts);
		}
		return rowKeys;
	}
	/**
	* Purge only what a hook declared via `purgeBy`, for an update that wrote
	* nothing of its own: a cancel, a no-op, or a failure. A cancel or a failure can
	* follow a hook's out-of-band write, so the declaration stands, while
	* `includeBareFingerprint: false` leaves this collection's own bare fingerprint
	* warm. A plain no-op declares nothing and so purges nothing.
	*/
	async purgeDeclaredScopedCache(declarations, opts) {
		if (declarations.purgeFingerprints.length === 0 || !shouldClearCache(this.cache, opts, this.collection)) return;
		this.scopedCachePurged = await this.scopedCache.purge([], declarations, [], { includeBareFingerprint: false });
	}
	/**
	* Apply one group's change to the rows it names, in its own transaction.
	*
	* The `items.update` events belong to the whole update and are emitted by
	* `updateGroups` around the loop, never here. Returns what was written: the
	* payload after presets, and the keys it reached. A group that changes nothing
	* never gets here — `updateGroups` filters those out before the transaction.
	*/
	async applyUpdateGroup(group, aliases, opts, nestedActionEvents) {
		const { ActivityService } = await import("./activity.js");
		const { RevisionsService } = await import("./revisions.js");
		const keys = [...group.keys].sort();
		const payloadAfterHooks = group.data;
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const fields = Object.keys(this.schema.collections[this.collection].fields);
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
				throw await translateDatabaseError(err, payloadAfterHooks, this.knex, {
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
		return {
			data: payloadWithPresets,
			keys: group.keys
		};
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
		const oldScopedCacheSnapshot = await this.scopedCache.snapshot(inputKeys);
		const scopedCacheHookDeclarations = createScopedCacheHookDeclarations(this.schema);
		const primaryKeys = await transaction(this.knex, async (knex) => {
			const service = this.fork({ knex });
			const primaryKeys$1 = [];
			for (const payload of payloads) {
				const primaryKey = await service.upsertOne(payload, {
					...opts || {},
					autoPurgeCache: false,
					scopedCacheHookDeclarations
				});
				primaryKeys$1.push(primaryKey);
			}
			return primaryKeys$1;
		}, opts.mutationTracker.snapshot());
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const newScopedCacheSnapshot = await this.scopedCache.snapshot(primaryKeys.filter((key) => key !== null && key !== void 0));
			const scopedCacheFingerprints = primaryKeys.some((key) => {
				return key != null && scopedCacheHookDeclarations.takenOverKeys.has(takenOverScopedCacheKey(this.collection, key));
			}) && scopedCacheHookDeclarations.purgeFingerprints.length === 0 ? null : scopedCacheMutatedFingerprints(oldScopedCacheSnapshot, newScopedCacheSnapshot);
			this.scopedCachePurged = await this.scopedCache.purge(scopedCacheFingerprints, scopedCacheHookDeclarations, [], {
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: scopedCacheFingerprints === null ? void 0 : scopedCacheUpdatedRows(oldScopedCacheSnapshot, newScopedCacheSnapshot)
			});
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
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations ?? createScopedCacheHookDeclarations(this.schema);
		if ((opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`, keys, { collection: this.collection }, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability,
			scopedCache: scopedCacheHookDeclarations.purge
		}) : keys) === null) {
			if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: `A filter hook cancelled the deletion, but this operation requires it` });
			if (scopedCacheHookDeclarations.purgeFingerprints.length > 0 && shouldClearCache(this.cache, opts, this.collection)) this.scopedCachePurged = await this.scopedCache.purge([], scopedCacheHookDeclarations, [], { includeBareFingerprint: false });
			return keys.map(() => null);
		}
		const selfRelationSurvivorKeys = await this.scopedCache.selfRelationSurvivorKeys(keys);
		const oldScopedCacheSnapshot = await this.scopedCache.snapshot([...keys, ...selfRelationSurvivorKeys]);
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
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const survivorScopedCacheSnapshot = await this.scopedCache.snapshot(selfRelationSurvivorKeys);
			this.scopedCachePurged = await this.scopedCache.purge(scopedCacheMutatedFingerprints(oldScopedCacheSnapshot, survivorScopedCacheSnapshot), scopedCacheHookDeclarations, scopedCacheCollectionsChangedByOnDelete(this.schema, this.collection), {
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: scopedCacheWrittenRows(oldScopedCacheSnapshot, survivorScopedCacheSnapshot)
			});
		}
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
		const singletonMeta = readMeta(records) ?? { scopedCacheFingerprints: [] };
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
			return withMeta(defaults, singletonMeta);
		}
		return withMeta(record, singletonMeta);
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