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
import { isUniqueViolation } from "../database/errors/dialects/postgres.js";
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
* Whether a list holds nothing but its entries, with no hole among them. A hook
* written for one payload sets `payload.field = x` on the list itself, where no
* write ever reads it, and `every` skips a hole.
*/
function carriesOnlyIndices(answeredList) {
	for (let index = 0; index < answeredList.length; index++) if (!(index in answeredList)) return false;
	return Object.keys(answeredList).length === answeredList.length;
}
/**
* The list a grouped filter receives, refusing any touch of one of its
* collection's fields: a hook written for one payload deletes or checks a field
* on the list itself, where the write never reads it, and would let the write
* through unchecked.
*/
function refuseFieldAccess(answeredList, fieldNames, createRefusal) {
	const refusedNames = new Set(fieldNames.filter((fieldName) => {
		return !/^\d+$/.test(fieldName) && !(fieldName in answeredList) && fieldName !== "then" && fieldName !== "toJSON";
	}));
	function guardProperty(property) {
		if (typeof property === "string" && refusedNames.has(property)) throw createRefusal();
	}
	return new Proxy(answeredList, {
		get(target, property, receiver) {
			guardProperty(property);
			return Reflect.get(target, property, receiver);
		},
		has(target, property) {
			guardProperty(property);
			return Reflect.has(target, property);
		},
		set(target, property, value, receiver) {
			guardProperty(property);
			return Reflect.set(target, property, value, receiver);
		},
		deleteProperty(target, property) {
			guardProperty(property);
			return Reflect.deleteProperty(target, property);
		},
		defineProperty(target, property, descriptor) {
			guardProperty(property);
			return Reflect.defineProperty(target, property, descriptor);
		}
	});
}
/**
* Whether a grouped `items.create` filter answered one entry per row it received,
* each a `CreateEntry` or `null`, a `sameRowAs` pointing at an earlier position.
*/
function isCreateEntryList(entriesAfterHooks, rowCount) {
	if (!Array.isArray(entriesAfterHooks) || entriesAfterHooks.length !== rowCount) return false;
	if (!carriesOnlyIndices(entriesAfterHooks)) return false;
	return entriesAfterHooks.every((entry, index) => {
		if (entry === null) return true;
		if (!isPlainObject(entry) || Object.keys(entry).length !== 1) return false;
		if ("data" in entry) return isPlainObject(entry.data);
		if ("key" in entry) return isPrimaryKey(entry.key);
		return "sameRowAs" in entry && Number.isInteger(entry.sameRowAs) && entry.sameRowAs >= 0 && entry.sameRowAs < index;
	});
}
function isUpdateGroup(entry) {
	return isPlainObject(entry) && isPlainObject(entry.data) && Array.isArray(entry.keys);
}
/**
* A row a filter hook wrote itself, answered with its key as `{ key }`. Directus
* writes nothing for it, so it skips the access check, the revision and activity,
* the action event, the action flows and the websocket messages; the mutation
* returns its key. A created row a hook answers with a key skips the same.
*/
function isTakenOverRow(entry) {
	return isPlainObject(entry) && Object.keys(entry).length === 1 && isPrimaryKey(entry.key);
}
const BATCH_TEXT_FIELD_TYPES = new Set([
	"csv",
	"hash",
	"string",
	"text",
	"uuid"
]);
/**
* Merge each group into the one before it when both carry the same change, so one
* statement writes rows sent side by side. Rows apart are never merged: a row in
* between may take a value the earlier row frees, or free one the later row takes,
* so the rows are written in the order the caller sent them.
*
* A group writing a nested item creates it once per group and walks its O2M rows
* per group, so it never merges: two groups merged would create one related item
* where the caller asked for two.
*
* TODO(#606): merge them when their nested items share an identity, once #337
* brings the by-unique-identity dedup to the fork.
*/
function mergeUpdateGroups(candidateGroups, writesNestedItems, keyNameOf) {
	const mergedGroups = [];
	let lastSerializedData = null;
	let lastKeyNames = /* @__PURE__ */ new Set();
	for (const candidateGroup of candidateGroups) {
		const serializedData = JSON.stringify(candidateGroup.data, (_field, value) => {
			return typeof value === "bigint" ? value.toString() : value;
		});
		const lastGroup = mergedGroups.at(-1);
		if (lastGroup === void 0 || writesNestedItems(candidateGroup.data) || serializedData !== lastSerializedData || !isEqual(lastGroup.data, candidateGroup.data)) {
			mergedGroups.push({
				data: candidateGroup.data,
				keys: []
			});
			lastSerializedData = serializedData;
			lastKeyNames = /* @__PURE__ */ new Set();
		}
		const targetGroup = mergedGroups.at(-1);
		for (const key of candidateGroup.keys) if (!lastKeyNames.has(keyNameOf(key))) {
			lastKeyNames.add(keyNameOf(key));
			targetGroup.keys.push(key);
		}
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
		const scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations ?? createScopedCacheHookDeclarations(this.schema);
		const declaredPurgesAtStart = scopedCacheHookDeclarations.purgeFingerprints.length;
		let attemptTakenOverKeys = [];
		const { nestedActionEvents, actionPayloads, takenOverRowKeys } = await transaction(this.knex, async (trx) => {
			const nestedActionEvents$1 = [];
			const takenOverRowKeys$1 = [];
			attemptTakenOverKeys = takenOverRowKeys$1;
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
			let autoIncrementSequenceNeedsToBeReset = false;
			const prepared = [];
			const sameRowPositions = [];
			const filterContext = {
				transaction: trx,
				database: trx,
				schema: this.schema,
				accountability: this.accountability,
				scopedCache: scopedCacheHookDeclarations.purgeHandleFor(this.collection)
			};
			const entries = data.map((row) => {
				return { data: cloneDeep(row) };
			});
			const createEntryListRefusal = () => {
				return new InvalidPayloadError({ reason: oneLine`
						A "${this.eventScope}.create" filter hook must return one
						{ data } | { key } | { sameRowAs } | null per row it received, a
						sameRowAs pointing at an earlier row; a hook that handles one row
						maps them with mapCreateRows
					` });
			};
			const guardedEntries = refuseFieldAccess(entries, Object.keys(this.schema.collections[this.collection].fields), createEntryListRefusal);
			const answeredEntries = opts.emitEvents !== false ? await emitter_default.emitFilter(createEvent, guardedEntries, { collection: this.collection }, filterContext) : entries;
			const entriesAfterHooks = answeredEntries === guardedEntries ? entries : answeredEntries;
			const createEntries = entriesAfterHooks === null ? data.map(() => null) : entriesAfterHooks;
			if (!isCreateEntryList(createEntries, data.length)) throw createEntryListRefusal();
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
				else if (entry !== null) payloadAfterHooks = entry.data;
				if (typeof payloadAfterHooks === "string" || typeof payloadAfterHooks === "number") {
					validateKeys(this.schema, this.collection, primaryKeyField, payloadAfterHooks);
					scopedCacheHookDeclarations.takenOverKeys.add(takenOverScopedCacheKey(this.collection, payloadAfterHooks));
					results[index] = payloadAfterHooks;
					takenOverRowKeys$1.push(payloadAfterHooks);
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
			if (opts.emitEvents !== false && postPrepared.length > 0) await this.emitWrittenEvent("created", postPrepared.map((p) => p.actionHookPayload), postPrepared.map((p) => p.primaryKey), trx, scopedCacheHookDeclarations);
			return {
				nestedActionEvents: nestedActionEvents$1,
				actionPayloads: postPrepared.map((p) => ({
					primaryKey: p.primaryKey,
					actionHookPayload: p.actionHookPayload
				})),
				takenOverRowKeys: takenOverRowKeys$1
			};
		}, opts.mutationTracker.snapshot()).catch(async (error) => {
			if (!shouldClearCache(this.cache, opts, this.collection)) throw error;
			if (this.knex.isTransaction) {
				this.scopedCachePurged = await this.scopedCache.purge(null, scopedCacheHookDeclarations, [], { includeBareFingerprint: opts.purgeBareFingerprint !== false });
				await this.purgeHookWrittenScopedCache(attemptTakenOverKeys, scopedCacheHookDeclarations, opts);
			} else await this.purgeCreatedScopedCache([...new Set(attemptTakenOverKeys)], attemptTakenOverKeys, scopedCacheHookDeclarations, declaredPurgesAtStart, opts);
			throw error;
		});
		if (opts.emitEvents !== false && actionPayloads.length > 0) {
			const actionContext = {
				database: database_default(),
				schema: this.schema,
				accountability: this.accountability
			};
			await emitActionEvents([{
				event: createEvent,
				meta: {
					payload: actionPayloads.map(({ actionHookPayload }) => {
						return actionHookPayload;
					}),
					keys: actionPayloads.map(({ primaryKey }) => primaryKey),
					collection: this.collection
				},
				context: actionContext
			}, ...nestedActionEvents], opts);
		}
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const liveKeys = [...new Set(results.filter((key) => key !== null))];
			await this.purgeCreatedScopedCache(liveKeys, takenOverRowKeys, scopedCacheHookDeclarations, declaredPurgesAtStart, opts);
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
	*/
	async updateBatch(data, opts = {}) {
		if (!Array.isArray(data)) throw new InvalidPayloadError({ reason: "Input should be an array of items" });
		if (data.length === 0) return [];
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
	* A uuid names one row whatever the case of its letters (RFC 9562), an integer
	* or a bigInteger whatever zeros lead it.
	*/
	primaryKeyNameOf(key) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const primaryKeyType = this.schema.collections[this.collection].fields[primaryKeyField].type;
		if (primaryKeyType === "uuid") return String(key).toLowerCase();
		if (primaryKeyType === "integer") return String(Number(key));
		return primaryKeyType === "bigInteger" && /^[+-]?\d+$/.test(String(key)) ? String(BigInt(key)) : String(key);
	}
	/**
	* The rows of this collection a hook declared inert through `skipPurgeFor`,
	* named as primaryKeyNameOf names them, so any spelling of a key finds its row.
	*/
	purgeSkippedKeyNames(declarations) {
		const skippedKeys = declarations.purgeSkippedKeys.get(this.collection);
		return new Set([...skippedKeys ?? []].map((skippedKey) => {
			return this.primaryKeyNameOf(skippedKey);
		}));
	}
	/**
	* The rows of this collection whose slices a hook declared through
	* `purgeBy(…, { forKey })`, named as primaryKeyNameOf names them.
	*/
	purgeDeclaredKeyNames(declarations) {
		const declaredKeys = declarations.purgeDeclaredKeys.get(this.collection);
		return new Set([...declaredKeys ?? []].map((declaredKey) => {
			return this.primaryKeyNameOf(declaredKey);
		}));
	}
	/**
	* Whether a group would write nothing: an empty payload, a primary-key-only one,
	* or one whose every field is an alterations object carrying no item. Decided
	* before any write, so a no-op update writes no row, activity or revision.
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
	* The user integrity checks writing these groups calls for. Handed the groups
	* the hooks left, so a field a hook adds counts like the caller's own.
	*/
	requiredIntegrityChecks(_groups) {
		return UserIntegrityCheckFlag.None;
	}
	/**
	* What writing these groups sets off once they are written — a cache clear,
	* a logout. Handed the groups the hooks left.
	*/
	async applyUpdateSideEffects(_groups, _opts) {}
	/**
	* Hand the rows a mutation wrote to its `.created` or `.updated` filters,
	* inside the transaction before it commits: a hook that throws rolls the
	* mutation back, and a hook writing through `context.transaction` commits with
	* it. The rows are already written, so a hook answering anything is refused,
	* and one changing them in place changes only what the action is handed.
	*
	* A row is the payload as written, presets applied and its key set, not the
	* row read back: no database default, relations as the caller sent them. A
	* nested create or update emits its own event, from its own service.
	*
	* Bounds: on a transaction the caller opened, a throw rolls back only when
	* the caller does; a retried transaction runs the hooks again; a hook writing
	* the same collection through `ItemsService` emits again.
	*/
	async emitWrittenEvent(writtenAction, writtenRows, keys, trx, declarations) {
		await emitter_default.emitWrittenFilter(this.eventScope === "items" ? [`items.${writtenAction}`, `${this.collection}.items.${writtenAction}`] : `${this.eventScope}.${writtenAction}`, writtenRows, {
			keys,
			collection: this.collection
		}, {
			transaction: trx,
			database: trx,
			schema: this.schema,
			accountability: this.accountability,
			scopedCache: { purgeBy: declarations.purgeHandleFor(this.collection).purgeBy }
		});
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
		const keyNameOf = (key) => this.primaryKeyNameOf(key);
		if (!opts.bypassLimits) mutationTracker.trackMutations(inputKeys.length);
		validateKeys(this.schema, this.collection, primaryKeyField, inputKeys);
		if (inputKeys.length === 0) return [];
		const updateEvent = this.eventScope === "items" ? ["items.update", `${this.collection}.items.update`] : `${this.eventScope}.update`;
		let scopedCacheHookDeclarations = opts.scopedCacheHookDeclarations ?? createScopedCacheHookDeclarations(this.schema);
		const refusesRepeatedPks = opts.onRepeatedPk !== "lastWins";
		const sentKeyNames = /* @__PURE__ */ new Set();
		const sentGroups = groups.map((group) => {
			if (!refusesRepeatedPks) return group;
			const groupKeyNames = /* @__PURE__ */ new Set();
			const uniqueKeys = [];
			for (const key of group.keys) {
				const keyName = keyNameOf(key);
				if (sentKeyNames.has(keyName)) throw new InvalidPayloadError({ reason: opts.onRepeatedPk === void 0 ? `Row ${keyName} is sent more than once; send each row once` : oneLine`
								Row ${keyName} is sent more than once; send each row once, or
								pass ${opts.lastWinsSpelling ?? "onRepeatedPk=lastWins"}
							` });
				if (!groupKeyNames.has(keyName)) {
					groupKeyNames.add(keyName);
					uniqueKeys.push(key);
				}
			}
			groupKeyNames.forEach((keyName) => sentKeyNames.add(keyName));
			return {
				data: group.data,
				keys: uniqueKeys
			};
		});
		const groupListRefusal = () => {
			return new InvalidPayloadError({ reason: oneLine`
					A "${this.eventScope}.update" filter hook must return the
					{ data, keys }[] it received, a row it wrote itself as { key }, no
					key both; a hook that handles one row maps them with mapUpdateRows
				` });
		};
		const aliasFields = Object.values(this.schema.collections[this.collection].fields).filter((field) => field.alias === true).map((field) => field.field);
		const changedInputKeys = groups.flatMap((group) => {
			return this.groupChangesNothing(group, aliasFields) ? [] : group.keys;
		});
		const readKeyNames = new Set(changedInputKeys.map((key) => keyNameOf(key)));
		const inputKeyNames = new Set(inputKeys.map((key) => keyNameOf(key)));
		const takeoverUndeclaredAmong = (changedKeys) => {
			const declaredKeyNames = this.purgeDeclaredKeyNames(scopedCacheHookDeclarations);
			return changedKeys.some((key) => {
				return !readKeyNames.has(keyNameOf(key)) && !declaredKeyNames.has(keyNameOf(key));
			});
		};
		let refusedAnswer = null;
		let failedWrite = null;
		const { rowKeys, writingGroups, writtenKeys, oldScopedCacheSnapshot, takeoverUndeclared, applied, nestedActionEvents } = await transaction(this.knex, async (trx) => {
			refusedAnswer = null;
			failedWrite = null;
			if (opts.scopedCacheHookDeclarations === void 0) scopedCacheHookDeclarations = createScopedCacheHookDeclarations(this.schema);
			const service = this.fork({ knex: trx });
			const applied$1 = [];
			const nestedActionEvents$1 = [];
			const attemptSentGroups = sentGroups.map((group) => {
				return {
					data: cloneDeep(group.data),
					keys: [...group.keys]
				};
			});
			const guardedPayload = refuseFieldAccess(attemptSentGroups, Object.keys(this.schema.collections[this.collection].fields), groupListRefusal);
			const inputScopedCacheSnapshot = await service.scopedCache.snapshot(changedInputKeys);
			const answeredGroups = opts.emitEvents !== false ? await emitter_default.emitFilter(updateEvent, guardedPayload, { collection: this.collection }, {
				transaction: trx,
				database: trx,
				schema: this.schema,
				accountability: this.accountability,
				scopedCache: scopedCacheHookDeclarations.purgeHandleFor(this.collection)
			}) : attemptSentGroups;
			const groupsAfterHooks = answeredGroups === guardedPayload ? attemptSentGroups : answeredGroups;
			const refuseHookAnswer = (refusal) => {
				refusedAnswer = {
					groupsAfterHooks,
					inputScopedCacheSnapshot
				};
				return refusal;
			};
			if (groupsAfterHooks === null) {
				if (!opts.allowFilterCancel) throw refuseHookAnswer(new InvalidPayloadError({ reason: oneLine`
								A filter hook cancelled the update, but this operation
								requires it
							` }));
				return {
					rowKeys: inputKeys.map(() => null),
					writingGroups: [],
					writtenKeys: [],
					oldScopedCacheSnapshot: inputScopedCacheSnapshot,
					takeoverUndeclared: false,
					applied: applied$1,
					nestedActionEvents: nestedActionEvents$1
				};
			}
			if (!(Array.isArray(groupsAfterHooks) && carriesOnlyIndices(groupsAfterHooks) && groupsAfterHooks.every((entry) => {
				return isUpdateGroup(entry) || isTakenOverRow(entry);
			}))) throw refuseHookAnswer(groupListRefusal());
			const dataGroups = groupsAfterHooks.filter(isUpdateGroup);
			const takenOverKeys = groupsAfterHooks.filter(isTakenOverRow).map((entry) => entry.key);
			const answeredKeys = [...dataGroups.flatMap((group) => group.keys), ...takenOverKeys];
			const hookAddedKeys = answeredKeys.filter((key) => {
				return !inputKeyNames.has(keyNameOf(key));
			});
			try {
				if (!opts.bypassLimits && hookAddedKeys.length > 0) mutationTracker.trackMutations(hookAddedKeys.length);
				validateKeys(this.schema, this.collection, primaryKeyField, answeredKeys);
			} catch (error) {
				throw refuseHookAnswer(error);
			}
			const groupedKeyNames = new Set(dataGroups.flatMap((group) => {
				return group.keys.map((key) => keyNameOf(key));
			}));
			const doublyAnsweredKey = takenOverKeys.find((key) => {
				return groupedKeyNames.has(keyNameOf(key));
			});
			if (doublyAnsweredKey !== void 0) throw refuseHookAnswer(new InvalidPayloadError({ reason: oneLine`
							A "${this.eventScope}.update" filter hook took row
							${keyNameOf(doublyAnsweredKey)} over as { key } but also left it
							in a { data, keys } group; answer each row one way
						` }));
			const answeredKeyCounts = /* @__PURE__ */ new Map();
			for (const key of answeredKeys) {
				const keyName = keyNameOf(key);
				const answeredCount = (answeredKeyCounts.get(keyName) ?? 0) + 1;
				if (refusesRepeatedPks && answeredCount > 1) throw refuseHookAnswer(new InvalidPayloadError({ reason: oneLine`
								A "${this.eventScope}.update" filter hook answered with row
								${keyName} more than once
							` }));
				answeredKeyCounts.set(keyName, answeredCount);
			}
			const rowKeys$1 = inputKeys.map((key) => {
				const keyName = keyNameOf(key);
				const answeredCount = answeredKeyCounts.get(keyName) ?? 0;
				if (!refusesRepeatedPks) answeredKeyCounts.set(keyName, answeredCount - 1);
				return answeredCount > 0 ? key : null;
			});
			if (!opts.allowFilterCancel && rowKeys$1.includes(null)) throw refuseHookAnswer(new InvalidPayloadError({ reason: oneLine`
							A filter hook cancelled a row of the update, but this operation
							requires it
						` }));
			const relationalFields = new Set(this.schema.relations.filter((relation) => relation.collection === this.collection).map((relation) => relation.field));
			const writingGroups$1 = mergeUpdateGroups(dataGroups, (groupData) => {
				return Object.entries(groupData).some(([field, value]) => {
					const nestsAnItem = typeof value === "object" && value !== null;
					return aliasFields.includes(field) || relationalFields.has(field) && nestsAnItem;
				});
			}, keyNameOf).filter((group) => {
				return group.keys.length > 0 && !this.groupChangesNothing(group, aliasFields);
			});
			for (const key of takenOverKeys) scopedCacheHookDeclarations.takenOverKeys.add(takenOverScopedCacheKey(this.collection, key));
			const skippedKeyNames = this.purgeSkippedKeyNames(scopedCacheHookDeclarations);
			const changedTakenOverKeys = takenOverKeys.filter((key) => {
				return !skippedKeyNames.has(keyNameOf(key));
			});
			const takeoverUndeclared$1 = takeoverUndeclaredAmong(changedTakenOverKeys);
			const directusWrittenKeys = writingGroups$1.flatMap((group) => group.keys);
			const writtenKeys$1 = [...directusWrittenKeys, ...changedTakenOverKeys];
			const writtenKeyNames = new Set(writtenKeys$1.map((key) => keyNameOf(key)));
			const hookAddedScopedCacheSnapshot = await service.scopedCache.snapshot(writtenKeys$1.filter((key) => !readKeyNames.has(keyNameOf(key)))).catch(() => {
				return {
					canResolveSlicesFromRows: false,
					rows: []
				};
			});
			const oldScopedCacheSnapshot$1 = {
				canResolveSlicesFromRows: inputScopedCacheSnapshot.canResolveSlicesFromRows && hookAddedScopedCacheSnapshot.canResolveSlicesFromRows,
				rows: [...inputScopedCacheSnapshot.rows.filter((snapshotRow) => {
					return writtenKeyNames.has(keyNameOf(snapshotRow.key));
				}), ...hookAddedScopedCacheSnapshot.rows]
			};
			const hookAddedWrittenKeys = directusWrittenKeys.filter((key) => {
				return !inputKeyNames.has(keyNameOf(key));
			});
			if (opts.onHookAddedRows && hookAddedWrittenKeys.length > 0) opts.onHookAddedRows(hookAddedWrittenKeys, {
				canResolveSlicesFromRows: oldScopedCacheSnapshot$1.canResolveSlicesFromRows,
				rows: oldScopedCacheSnapshot$1.rows.filter((snapshotRow) => {
					return !inputKeyNames.has(keyNameOf(snapshotRow.key));
				})
			});
			const answeredUpdate = {
				rowKeys: rowKeys$1,
				writingGroups: writingGroups$1,
				writtenKeys: writtenKeys$1,
				oldScopedCacheSnapshot: oldScopedCacheSnapshot$1,
				takeoverUndeclared: takeoverUndeclared$1,
				applied: applied$1,
				nestedActionEvents: nestedActionEvents$1
			};
			failedWrite = {
				writtenKeys: writtenKeys$1,
				changedTakenOverKeys,
				oldScopedCacheSnapshot: oldScopedCacheSnapshot$1,
				takeoverUndeclared: takeoverUndeclared$1
			};
			if (writingGroups$1.length === 0) return answeredUpdate;
			let userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | this.requiredIntegrityChecks(writingGroups$1);
			if (this.accountability) for (const group of writingGroups$1) await validateAccess({
				accountability: this.accountability,
				action: "update",
				collection: this.collection,
				primaryKeys: [...group.keys].sort(),
				fields: Object.keys(group.data)
			}, {
				schema: this.schema,
				knex: trx
			});
			const appliedGroups = await service.applyUpdateGroups(writingGroups$1, aliasFields, {
				...opts,
				mutationTracker,
				onRequireUserIntegrityCheck: (flags) => {
					userIntegrityCheckFlags |= flags;
				}
			}, nestedActionEvents$1);
			applied$1.push(...appliedGroups);
			if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: userIntegrityCheckFlags,
				knex: trx
			});
			if (opts.emitEvents !== false) await this.emitWrittenEvent("updated", applied$1, directusWrittenKeys, trx, scopedCacheHookDeclarations);
			return answeredUpdate;
		}, mutationTracker.snapshot()).catch(async (error) => {
			if (failedWrite !== null) {
				const { writtenKeys: writtenKeys$1, changedTakenOverKeys, oldScopedCacheSnapshot: oldScopedCacheSnapshot$1, takeoverUndeclared: takeoverUndeclared$1 } = failedWrite;
				if (this.knex.isTransaction) {
					await this.purgeUpdatedScopedCache(writtenKeys$1, oldScopedCacheSnapshot$1, scopedCacheHookDeclarations, opts, takeoverUndeclared$1);
					await this.purgeHookWrittenScopedCache(changedTakenOverKeys, scopedCacheHookDeclarations, opts);
				} else if (changedTakenOverKeys.length > 0) await this.purgeUpdatedScopedCache(changedTakenOverKeys, oldScopedCacheSnapshot$1, scopedCacheHookDeclarations, opts, takeoverUndeclared$1);
				else await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
			} else if (refusedAnswer !== null) {
				const { groupsAfterHooks, inputScopedCacheSnapshot } = refusedAnswer;
				const skippedKeyNames = this.purgeSkippedKeyNames(scopedCacheHookDeclarations);
				const changedKeys = Array.isArray(groupsAfterHooks) ? groupsAfterHooks.filter(isTakenOverRow).map((entry) => entry.key).filter((key) => !skippedKeyNames.has(keyNameOf(key))) : [];
				if (changedKeys.length > 0) {
					const changedKeyNames = new Set(changedKeys.map((key) => keyNameOf(key)));
					await this.purgeUpdatedScopedCache(changedKeys, {
						canResolveSlicesFromRows: inputScopedCacheSnapshot.canResolveSlicesFromRows,
						rows: inputScopedCacheSnapshot.rows.filter((snapshotRow) => {
							return changedKeyNames.has(keyNameOf(snapshotRow.key));
						})
					}, scopedCacheHookDeclarations, opts, takeoverUndeclaredAmong(changedKeys));
				} else await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
				await this.purgeHookWrittenScopedCache(changedKeys, scopedCacheHookDeclarations, opts);
			} else {
				await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
				await this.purgeHookWrittenScopedCache([], scopedCacheHookDeclarations, opts);
			}
			throw error;
		});
		if (writtenKeys.length === 0) await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
		else await this.purgeUpdatedScopedCache(writtenKeys, oldScopedCacheSnapshot, scopedCacheHookDeclarations, opts, takeoverUndeclared);
		if (writingGroups.length === 0) return rowKeys;
		if (opts.emitEvents !== false) {
			const actionContext = {
				database: database_default(),
				schema: this.schema,
				accountability: this.accountability
			};
			await emitActionEvents([{
				event: updateEvent,
				meta: {
					payload: applied,
					collection: this.collection
				},
				context: actionContext
			}, ...nestedActionEvents], opts);
		}
		await this.applyUpdateSideEffects(writingGroups, opts);
		return rowKeys;
	}
	/**
	* Purge the slices the written rows sat in before the update and the ones they
	* sit in now (old ∪ new), re-read from the stored rows rather than the post-hook
	* payload: a DB trigger or type coercion can rewrite the scope column on write
	* (same rule as createMany). "Now" is committed only when this call owns the
	* transaction; from a hook it shares the caller's and this purge runs pre-commit
	* — https://github.com/jclaveau/directus/issues/363
	*
	* A re-read that fails, as any read does on a Postgres transaction an error
	* aborted, leaves the new slices unknown, so the collection is purged whole.
	*/
	async purgeUpdatedScopedCache(writtenKeys, oldScopedCacheSnapshot, declarations, opts, takeoverUndeclared) {
		if (!shouldClearCache(this.cache, opts, this.collection)) return;
		if (takeoverUndeclared) {
			this.scopedCachePurged = await this.scopedCache.purge(null, declarations, [], { includeBareFingerprint: opts.purgeBareFingerprint !== false });
			return;
		}
		const newScopedCacheSnapshot = await this.scopedCache.snapshot(writtenKeys).catch(() => null);
		this.scopedCachePurged = await this.scopedCache.purge(scopedCacheMutatedFingerprints(oldScopedCacheSnapshot, newScopedCacheSnapshot), declarations, [], {
			includeBareFingerprint: opts.purgeBareFingerprint !== false,
			rows: newScopedCacheSnapshot === null ? void 0 : scopedCacheUpdatedRows(oldScopedCacheSnapshot, newScopedCacheSnapshot)
		});
	}
	/**
	* Purge what a create wrote: the rows it inserted or a hook took over, and
	* whatever its hooks declared.
	*/
	async purgeCreatedScopedCache(writtenKeys, takenOverRowKeys, declarations, declaredPurgesAtStart, opts) {
		const takenOverKeyNames = new Set(takenOverRowKeys.map((key) => {
			return this.primaryKeyNameOf(key);
		}));
		const skippedKeyNames = this.purgeSkippedKeyNames(declarations);
		const declaredKeyNames = this.purgeDeclaredKeyNames(declarations);
		const changedKeys = writtenKeys.filter((key) => {
			const keyName = this.primaryKeyNameOf(key);
			return !takenOverKeyNames.has(keyName) || !skippedKeyNames.has(keyName);
		});
		if (changedKeys.length === 0) {
			if (declarations.purgeFingerprints.length === declaredPurgesAtStart) return;
			await this.purgeDeclaredScopedCache(declarations, opts);
			return;
		}
		const scopedCacheSnapshot = takenOverRowKeys.some((key) => {
			const keyName = this.primaryKeyNameOf(key);
			return !skippedKeyNames.has(keyName) && !declaredKeyNames.has(keyName);
		}) ? null : await this.scopedCache.snapshot(changedKeys).catch(() => null);
		this.scopedCachePurged = await this.scopedCache.purge(scopedCacheMutatedFingerprints(scopedCacheSnapshot), declarations, [], {
			includeBareFingerprint: opts.purgeBareFingerprint !== false,
			rows: scopedCacheWrittenRows(scopedCacheSnapshot)
		});
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
	* Purge, now and through the pool, what a failed mutation's hooks wrote through a
	* connection of their own: the rows they took over, and what they declared. On
	* the caller's transaction, the mutation's own purge waits for that transaction
	* to commit, and its rollback drops the purge while those writes have landed.
	*
	* A takeover purges the collection whole: its old slice is unknown.
	*/
	async purgeHookWrittenScopedCache(takenOverKeys, declarations, opts) {
		if (!this.knex.isTransaction || !shouldClearCache(this.cache, opts, this.collection)) return;
		const skippedKeyNames = this.purgeSkippedKeyNames(declarations);
		const poolScopedCache = new ItemScopedCacheService(this.collection, this.schema, database_default(), this.cache, this.accountability);
		if (takenOverKeys.some((key) => {
			return !skippedKeyNames.has(this.primaryKeyNameOf(key));
		})) await poolScopedCache.purge(null, declarations, [], { includeBareFingerprint: opts.purgeBareFingerprint !== false });
		else if (declarations.purgeFingerprints.length > 0) await poolScopedCache.purge([], declarations, [], { includeBareFingerprint: false });
	}
	/**
	* Apply one group's change to the rows it names, in its own transaction.
	*
	* The `items.update` events belong to the whole update and are emitted by
	* `updateGroups` around the loop, never here. Returns what was written: the
	* payload after presets, and the keys it reached. A group that changes nothing
	* never gets here — `updateGroups` filters those out before the transaction —
	* and `updateGroups` has checked the caller may update every group's rows.
	*/
	async applyUpdateGroup(group, aliases, opts, nestedActionEvents) {
		const keys = [...group.keys].sort();
		const payloadAfterHooks = group.data;
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const fields = Object.keys(this.schema.collections[this.collection].fields);
		const payloadWithPresets = await this.presetUpdatePayload(group.data);
		const preMutationError = opts.preMutationError ?? group.keys.map((key) => opts.preMutationErrorsByKey?.get(String(key))).find((keyError) => keyError !== void 0);
		if (preMutationError) throw preMutationError;
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
			await this.recordUpdatedRows(trx, keys.map((key) => ({
				key,
				payload: payloadWithTypeCasting
			})), childrenRevisions, opts);
		}, opts.mutationTracker.snapshot());
		return {
			data: payloadWithPresets,
			keys: group.keys
		};
	}
	/**
	* Apply the groups in the caller's order.
	*
	* On postgres, groups side by side that set the same scalar columns, on rows
	* none of the others names, are written by one `batchUpdate` statement per
	* chunk; every other group by `applyUpdateGroup` alone.
	*
	* TODO(#610): sqlite / mariadb / cockroachdb keep one statement per group.
	*/
	async applyUpdateGroups(groups, aliases, opts, nestedActionEvents) {
		const appliedGroups = [];
		for (const groupRun of this.splitBatchRuns(groups, aliases, opts)) if (groupRun.length === 1) appliedGroups.push(await this.applyUpdateGroup(groupRun[0], aliases, opts, nestedActionEvents));
		else appliedGroups.push(...await this.applyUpdateBatch(groupRun, aliases, opts, nestedActionEvents));
		return appliedGroups;
	}
	/**
	* Cut the groups, in order, into runs one statement can write: groups side by
	* side setting the same columns, none naming a row another of the run names.
	* A group no batch can carry is a run of its own.
	*/
	splitBatchRuns(groups, aliases, opts) {
		const groupRuns = [];
		let runColumns = null;
		let runKeyNames = /* @__PURE__ */ new Set();
		for (const group of groups) {
			const batchColumns = this.batchColumnsOf(group, aliases, opts);
			const keyNames = group.keys.map((key) => this.primaryKeyNameOf(key));
			if (batchColumns === null || batchColumns !== runColumns || keyNames.some((keyName) => runKeyNames.has(keyName))) {
				groupRuns.push([]);
				runColumns = batchColumns;
				runKeyNames = /* @__PURE__ */ new Set();
			}
			groupRuns.at(-1).push(group);
			for (const keyName of keyNames) runKeyNames.add(keyName);
		}
		return groupRuns;
	}
	/**
	* The columns a group sets, serialized for `splitBatchRuns` to compare, or
	* null where no batch can carry the group: on a dialect without a json batch,
	* behind a stored refusal, or setting an alias, a nested item, an object value
	* or a field whose type is not in `jsonBatchUpdateTypes`.
	*/
	batchColumnsOf(group, aliases, opts) {
		const collectionSchema = this.schema.collections[this.collection];
		const isRefused = opts.preMutationError !== void 0 || group.keys.some((key) => {
			return opts.preMutationErrorsByKey?.get(String(key)) !== void 0;
		});
		const { capabilities } = getHelpers(this.knex);
		if (!capabilities.supportsJsonBatchUpdate() || isRefused) return null;
		const fieldNames = Object.keys(group.data).filter((field) => {
			return field !== collectionSchema.primary;
		});
		if (fieldNames.length === 0) return null;
		return fieldNames.every((field) => {
			const fieldType = collectionSchema.fields[field]?.type;
			const value = group.data[field];
			return !aliases.includes(field) && fieldType !== void 0 && capabilities.jsonBatchUpdateTypes().has(fieldType) && (typeof value !== "object" || value === null || value instanceof Date);
		}) ? JSON.stringify(fieldNames.sort()) : null;
	}
	/**
	* Apply a run `splitBatchRuns` cut: one `batchUpdate` statement per chunk for
	* every row, then their activity and revisions in one pass.
	*
	* The groups are prepared in the caller's order, and one refused there throws
	* once the groups before it are written, as `applyUpdateGroup` would.
	*/
	async applyUpdateBatch(groupRun, aliases, opts, nestedActionEvents) {
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const fields = Object.keys(this.schema.collections[this.collection].fields);
		const payloadService = new PayloadService(this.collection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema,
			nested: this.nested
		});
		const preparedGroups = [];
		let prepareError = null;
		for (const group of groupRun) try {
			const payloadWithPresets = await this.presetUpdatePayload(group.data);
			const payloadWithTypeCasting = await payloadService.processValues("update", pick(payloadWithPresets, without(fields, primaryKeyField, ...aliases)));
			preparedGroups.push({
				group,
				payloadWithPresets,
				payloadWithTypeCasting
			});
		} catch (error) {
			prepareError = error;
			break;
		}
		const fieldSchemas = this.schema.collections[this.collection].fields;
		const groupBatchValues = preparedGroups.map(({ payloadWithTypeCasting }) => {
			return Object.fromEntries(Object.entries(payloadWithTypeCasting).filter(([, value]) => value !== void 0).map(([field, value]) => {
				const fieldType = fieldSchemas[field]?.type;
				return typeof value === "number" && fieldType !== void 0 && BATCH_TEXT_FIELD_TYPES.has(fieldType) ? [field, String(value)] : [field, value];
			}));
		});
		const batchRows = preparedGroups.flatMap(({ group }, index) => {
			return group.keys.map((key) => {
				return {
					...groupBatchValues[index],
					[primaryKeyField]: key
				};
			});
		});
		const columnSets = new Set(groupBatchValues.map((batchValues) => {
			return JSON.stringify(Object.keys(batchValues).sort());
		}));
		let wroteBatch = false;
		if (columnSets.size === 1 && !columnSets.has("[]") && preparedGroups.every(({ group, payloadWithPresets }) => {
			const presetGroup = {
				...group,
				data: payloadWithPresets
			};
			return this.batchColumnsOf(presetGroup, aliases, opts) !== null;
		}) && batchRows.every((batchRow) => {
			return Object.values(batchRow).every((value) => {
				return typeof value !== "object" || value === null || value instanceof Date && !Number.isNaN(value.getTime());
			});
		})) wroteBatch = await this.knex.batchUpdate(this.collection, batchRows, primaryKeyField, { mode: "json" }).then(() => true, async (error) => {
			if (isUniqueViolation(error)) return false;
			throw await translateDatabaseError(error, {}, this.knex, {
				collection: this.collection,
				operation: "update"
			});
		});
		if (!wroteBatch) {
			const appliedGroups = [];
			for (const { group } of preparedGroups) appliedGroups.push(await this.applyUpdateGroup(group, aliases, opts, nestedActionEvents));
			if (prepareError !== null) throw prepareError;
			return appliedGroups;
		}
		await transaction(this.knex, async (trx) => {
			await this.recordUpdatedRows(trx, preparedGroups.flatMap(({ group, payloadWithTypeCasting }) => {
				return [...group.keys].sort().map((key) => {
					return {
						key,
						payload: payloadWithTypeCasting
					};
				});
			}), [], opts);
		}, opts.mutationTracker.snapshot());
		if (prepareError !== null) throw prepareError;
		return preparedGroups.map(({ group, payloadWithPresets }) => {
			return {
				data: payloadWithPresets,
				keys: group.keys
			};
		});
	}
	/**
	* The payload a group writes once the caller's permission presets fill it.
	*/
	async presetUpdatePayload(payload) {
		if (!this.accountability) return payload;
		return processPayload({
			accountability: this.accountability,
			action: "update",
			collection: this.collection,
			payload,
			nested: this.nested
		}, {
			knex: this.knex,
			schema: this.schema
		});
	}
	/**
	* Save the activity of the updated rows, one per row, and, where the
	* collection tracks them, a revision per row its payload changed, the first
	* one parenting `childrenRevisions`.
	*/
	async recordUpdatedRows(trx, updatedRows, childrenRevisions, opts) {
		const { ActivityService } = await import("./activity.js");
		const { RevisionsService } = await import("./revisions.js");
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const collectionAccountability = this.schema.collections[this.collection].accountability;
		if (this.accountability && collectionAccountability !== null) {
			const activity = await new ActivityService({
				knex: trx,
				schema: this.schema
			}).createMany(updatedRows.map(({ key }) => {
				return {
					action: Action.UPDATE,
					user: this.accountability.user,
					collection: this.collection,
					ip: this.accountability.ip,
					user_agent: this.accountability.userAgent,
					origin: this.accountability.origin,
					item: key
				};
			}), { bypassLimits: true });
			if (collectionAccountability === "all") {
				const snapshots = await new ItemsService(this.collection, {
					knex: trx,
					schema: this.schema
				}).readMany(updatedRows.map(({ key }) => key));
				const snapshotJsonByKey = /* @__PURE__ */ new Map();
				if (Array.isArray(snapshots)) for (const snapshot of snapshots) snapshotJsonByKey.set(String(snapshot[primaryKeyField]), JSON.stringify(snapshot));
				const payloadService = new PayloadService(this.collection, {
					accountability: this.accountability,
					knex: trx,
					schema: this.schema,
					nested: this.nested
				});
				const revisionsService = new RevisionsService({
					knex: trx,
					schema: this.schema
				});
				const revisions = (await Promise.all(activity.map(async (activity$1, index) => {
					const updatedRow = updatedRows[index];
					return {
						activity: activity$1,
						collection: this.collection,
						item: updatedRow.key,
						data: snapshots && Array.isArray(snapshots) ? snapshotJsonByKey.get(String(updatedRow.key)) : JSON.stringify(snapshots),
						delta: await payloadService.prepareDelta(updatedRow.payload)
					};
				}))).filter((revision) => revision.delta);
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
		const inputKeyNames = new Set(inputKeys.map((key) => {
			return this.primaryKeyNameOf(key);
		}));
		const takenOverPrefix = takenOverScopedCacheKey(this.collection, "");
		const changedTakenOverKeys = () => {
			const skippedKeyNames = this.purgeSkippedKeyNames(scopedCacheHookDeclarations);
			return [...scopedCacheHookDeclarations.takenOverKeys].filter((takenOverName) => takenOverName.startsWith(takenOverPrefix)).map((takenOverName) => takenOverName.slice(takenOverPrefix.length)).filter((takenOverKey) => {
				return !skippedKeyNames.has(this.primaryKeyNameOf(takenOverKey));
			});
		};
		const takeoverUndeclaredAmong = (takenOverKeys) => {
			const declaredKeyNames = this.purgeDeclaredKeyNames(scopedCacheHookDeclarations);
			return takenOverKeys.some((takenOverKey) => {
				const keyName = this.primaryKeyNameOf(takenOverKey);
				return !inputKeyNames.has(keyName) && !declaredKeyNames.has(keyName);
			});
		};
		const { primaryKeys, hookAddedKeys, hookAddedSnapshots } = await transaction(this.knex, async (knex) => {
			const service = this.fork({ knex });
			const primaryKeys$1 = [];
			const hookAddedKeys$1 = [];
			const hookAddedSnapshots$1 = [];
			const childOpts = {
				...opts || {},
				autoPurgeCache: false,
				scopedCacheHookDeclarations,
				onHookAddedRows: (addedKeys, addedSnapshot) => {
					for (const addedKey of addedKeys) hookAddedKeys$1.push(addedKey);
					hookAddedSnapshots$1.push(addedSnapshot);
				}
			};
			for (const payload of payloads) primaryKeys$1.push(await service.upsertOne(payload, childOpts));
			return {
				primaryKeys: primaryKeys$1,
				hookAddedKeys: hookAddedKeys$1,
				hookAddedSnapshots: hookAddedSnapshots$1
			};
		}, opts.mutationTracker.snapshot()).catch(async (error) => {
			if (!shouldClearCache(this.cache, opts, this.collection)) throw error;
			const takenOverKeys = changedTakenOverKeys();
			if (this.knex.isTransaction) this.scopedCachePurged = await this.scopedCache.purge(null, scopedCacheHookDeclarations, [], { includeBareFingerprint: opts.purgeBareFingerprint !== false });
			else if (takenOverKeys.length > 0) await this.purgeUpdatedScopedCache(takenOverKeys, oldScopedCacheSnapshot, scopedCacheHookDeclarations, opts, takeoverUndeclaredAmong(takenOverKeys));
			else await this.purgeDeclaredScopedCache(scopedCacheHookDeclarations, opts);
			throw error;
		});
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const takenOverKeys = changedTakenOverKeys();
			const newScopedCacheSnapshot = await this.scopedCache.snapshot(primaryKeys.filter((key) => key !== null && key !== void 0).concat(hookAddedKeys, takenOverKeys)).catch(() => null);
			const oldSnapshots = [oldScopedCacheSnapshot, ...hookAddedSnapshots];
			const oldScopedCacheRows = {
				canResolveSlicesFromRows: oldSnapshots.every((oldSnapshot) => {
					return oldSnapshot.canResolveSlicesFromRows;
				}),
				rows: oldSnapshots.flatMap((oldSnapshot) => oldSnapshot.rows)
			};
			const scopedCacheFingerprints = takeoverUndeclaredAmong(takenOverKeys) ? null : scopedCacheMutatedFingerprints(oldScopedCacheRows, newScopedCacheSnapshot);
			this.scopedCachePurged = await this.scopedCache.purge(scopedCacheFingerprints, scopedCacheHookDeclarations, [], {
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: scopedCacheFingerprints === null || newScopedCacheSnapshot === null ? void 0 : scopedCacheUpdatedRows(oldScopedCacheRows, newScopedCacheSnapshot)
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
		const deleteEvent = this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`;
		const deletion = await transaction(this.knex, async (trx) => {
			const service = this.fork({ knex: trx });
			if ((opts.emitEvents !== false ? await emitter_default.emitFilter(deleteEvent, [...keys], { collection: this.collection }, {
				transaction: trx,
				database: trx,
				schema: this.schema,
				accountability: this.accountability,
				scopedCache: scopedCacheHookDeclarations.purgeHandleFor(this.collection)
			}) : keys) === null) {
				if (!opts.allowFilterCancel) throw new InvalidPayloadError({ reason: oneLine`
							A filter hook cancelled the deletion, but this operation
							requires it
						` });
				return null;
			}
			const selfRelationSurvivorKeys$1 = await service.scopedCache.selfRelationSurvivorKeys(keys);
			const oldScopedCacheSnapshot$1 = await service.scopedCache.snapshot([...keys, ...selfRelationSurvivorKeys$1]);
			if (this.accountability) await validateAccess({
				accountability: this.accountability,
				action: "delete",
				collection: this.collection,
				primaryKeys: keys
			}, {
				knex: trx,
				schema: this.schema
			});
			if (opts.preMutationError) throw opts.preMutationError;
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
			return {
				selfRelationSurvivorKeys: selfRelationSurvivorKeys$1,
				oldScopedCacheSnapshot: oldScopedCacheSnapshot$1
			};
		}, opts.mutationTracker.snapshot()).catch(async (error) => {
			if (scopedCacheHookDeclarations.purgeFingerprints.length > 0 && shouldClearCache(this.cache, opts, this.collection)) this.scopedCachePurged = await this.scopedCache.purge([], scopedCacheHookDeclarations, [], { includeBareFingerprint: false });
			throw error;
		});
		if (deletion === null) {
			if (scopedCacheHookDeclarations.purgeFingerprints.length > 0 && shouldClearCache(this.cache, opts, this.collection)) this.scopedCachePurged = await this.scopedCache.purge([], scopedCacheHookDeclarations, [], { includeBareFingerprint: false });
			return keys.map(() => null);
		}
		const { selfRelationSurvivorKeys, oldScopedCacheSnapshot } = deletion;
		if (shouldClearCache(this.cache, opts, this.collection)) {
			const survivorScopedCacheSnapshot = await this.scopedCache.snapshot(selfRelationSurvivorKeys).catch(() => null);
			this.scopedCachePurged = await this.scopedCache.purge(scopedCacheMutatedFingerprints(oldScopedCacheSnapshot, survivorScopedCacheSnapshot), scopedCacheHookDeclarations, scopedCacheCollectionsChangedByOnDelete(this.schema, this.collection), {
				includeBareFingerprint: opts.purgeBareFingerprint !== false,
				rows: scopedCacheWrittenRows(oldScopedCacheSnapshot, survivorScopedCacheSnapshot)
			});
		}
		if (opts.emitEvents !== false) await emitActionEvents([{
			event: deleteEvent,
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