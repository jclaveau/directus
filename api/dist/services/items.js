import { UserIntegrityCheckFlag } from "../packages/types/dist/index.js";
import { getCache } from "../cache.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default, { getDatabaseClient } from "../database/index.js";
import { processAst } from "../permissions/modules/process-ast/process-ast.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { transaction } from "../utils/transaction.js";
import { translateDatabaseError } from "../database/errors/translate.js";
import { getAstFromQuery } from "../database/get-ast-from-query/get-ast-from-query.js";
import { PayloadService } from "./payload.js";
import { runAst } from "../database/run-ast/run-ast.js";
import { processPayload } from "../permissions/modules/process-payload/process-payload.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { validateKeys } from "../utils/validate-keys.js";
import { captureSeatCount, validateUserCountIntegrity } from "../utils/validate-user-count-integrity.js";
import { handleVersion } from "../utils/versioning/handle-version.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { getRelationsForCollection } from "@directus/utils";
import { assign, clone, cloneDeep, difference, omit, pick, without } from "lodash-es";
import { Action, isPublishedVersionKey } from "@directus/constants";
import { isSystemCollection } from "@directus/system-data";

//#region src/services/items.ts
const env = useEnv();
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
	/**
	* Create a single new item.
	*/
	async createOne(data, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (!opts.bypassLimits) opts.mutationTracker.trackMutations(1);
		if (this.collection === "directus_users") opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const fields = Object.keys(this.schema.collections[this.collection].fields);
		const aliases = Object.values(this.schema.collections[this.collection].fields).filter((field) => field.alias === true).map((field) => field.field);
		const payload = cloneDeep(data);
		let actionHookPayload = payload;
		const nestedActionEvents = [];
		/**
		* By wrapping the logic in a transaction, we make sure we automatically roll back all the
		* changes in the DB if any of the parts contained within throws an error. This also means
		* that any errors thrown in any nested relational changes will bubble up and cancel the whole
		* update tree
		*/
		const primaryKey = await transaction(this.knex, async (trx) => {
			const previousSeatCount = await captureSeatCount(trx, opts.userIntegrityCheckFlags);
			const payloadAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.create", `${this.collection}.items.create`] : `${this.eventScope}.create`, payload, { collection: this.collection }, {
				database: trx,
				schema: this.schema,
				accountability: this.accountability
			}) : payload;
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
			actionHookPayload = payloadWithPresets;
			const payloadService = new PayloadService(this.collection, {
				accountability: this.accountability,
				knex: trx,
				schema: this.schema,
				nested: this.nested,
				overwriteDefaults: opts.overwriteDefaults
			});
			const { payload: payloadWithM2O, revisions: revisionsM2O, nestedActionEvents: nestedActionEventsM2O, userIntegrityCheckFlags: userIntegrityCheckFlagsM2O } = await payloadService.processM2O(payloadWithPresets, opts);
			const { payload: payloadWithA2O, revisions: revisionsA2O, nestedActionEvents: nestedActionEventsA2O, userIntegrityCheckFlags: userIntegrityCheckFlagsA2O } = await payloadService.processA2O(payloadWithM2O, opts);
			const payloadWithoutAliases = pick(payloadWithA2O, without(fields, ...aliases));
			let primaryKey$1 = (await payloadService.processValues("create", payloadWithoutAliases))[primaryKeyField];
			if (primaryKey$1) validateKeys(this.schema, this.collection, primaryKeyField, primaryKey$1);
			let autoIncrementSequenceNeedsToBeReset = false;
			const pkField = this.schema.collections[this.collection].fields[primaryKeyField];
			if (primaryKey$1 && pkField && !opts.bypassAutoIncrementSequenceReset && ["integer", "bigInteger"].includes(pkField.type) && pkField.defaultValue === "AUTO_INCREMENT") autoIncrementSequenceNeedsToBeReset = true;
			try {
				let returningOptions = void 0;
				if (getDatabaseClient(trx) === "mssql") returningOptions = { includeTriggerModifications: true };
				const result = await trx.insert(payloadWithoutAliases).into(this.collection).returning(primaryKeyField, returningOptions).then((result$1) => result$1[0]);
				const returnedKey = typeof result === "object" ? result[primaryKeyField] : result;
				if (pkField.type === "uuid") primaryKey$1 = getHelpers(trx).schema.formatUUID(primaryKey$1 ?? returnedKey);
				else primaryKey$1 = primaryKey$1 ?? returnedKey;
			} catch (err) {
				const dbError = await translateDatabaseError(err, data);
				if (isDirectusError(dbError, ErrorCode.RecordNotUnique) && dbError.extensions.primaryKey) {
					dbError.extensions.field = pkField?.field ?? null;
					delete dbError.extensions.primaryKey;
				}
				throw dbError;
			}
			if (!primaryKey$1) {
				primaryKey$1 = (await trx.max(primaryKeyField, { as: "id" }).from(this.collection).first()).id;
				actionHookPayload[primaryKeyField] = primaryKey$1;
			}
			primaryKey$1 = primaryKey$1;
			const { revisions: revisionsO2M, nestedActionEvents: nestedActionEventsO2M, userIntegrityCheckFlags: userIntegrityCheckFlagsO2M } = await payloadService.processO2M(payloadWithPresets, primaryKey$1, opts);
			nestedActionEvents.push(...nestedActionEventsM2O);
			nestedActionEvents.push(...nestedActionEventsA2O);
			nestedActionEvents.push(...nestedActionEventsO2M);
			const userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | userIntegrityCheckFlagsM2O | userIntegrityCheckFlagsA2O | userIntegrityCheckFlagsO2M;
			if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: userIntegrityCheckFlags,
				knex: trx,
				previousSeatCount
			});
			if (opts.skipTracking !== true && this.accountability && this.schema.collections[this.collection].accountability !== null) {
				const { ActivityService } = await import("./activity.js");
				const { RevisionsService } = await import("./revisions.js");
				const activity = await new ActivityService({
					knex: trx,
					schema: this.schema
				}).createOne({
					action: Action.CREATE,
					user: this.accountability.user,
					collection: this.collection,
					ip: this.accountability.ip,
					user_agent: this.accountability.userAgent,
					origin: this.accountability.origin,
					item: primaryKey$1
				});
				if (this.schema.collections[this.collection].accountability === "all") {
					const revisionsService = new RevisionsService({
						knex: trx,
						schema: this.schema
					});
					const relationalFields = getRelationsForCollection(this.schema, this.collection);
					const revisionPayload = await payloadService.prepareDelta(omit(payloadWithPresets, relationalFields));
					const revision = await revisionsService.createOne({
						activity,
						collection: this.collection,
						item: primaryKey$1,
						data: revisionPayload,
						delta: revisionPayload
					});
					const childrenRevisions = [
						...revisionsM2O,
						...revisionsA2O,
						...revisionsO2M
					];
					if (childrenRevisions.length > 0) await revisionsService.updateMany(childrenRevisions, { parent: revision });
					if (opts.onRevisionCreate) opts.onRevisionCreate(revision);
				}
			}
			if (autoIncrementSequenceNeedsToBeReset) await getHelpers(trx).sequence.resetAutoIncrementSequence(this.collection, primaryKeyField);
			if (opts.onItemCreate) opts.onItemCreate(this.collection, primaryKey$1);
			return primaryKey$1;
		});
		if (opts.emitEvents !== false) {
			const actionEvent = {
				event: this.eventScope === "items" ? ["items.create", `${this.collection}.items.create`] : `${this.eventScope}.create`,
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
			};
			if (opts.bypassEmitAction) opts.bypassEmitAction(actionEvent);
			else emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context);
			for (const nestedActionEvent of nestedActionEvents) if (opts.bypassEmitAction) opts.bypassEmitAction(nestedActionEvent);
			else emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
		}
		if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
		return primaryKey;
	}
	/**
	* Create multiple new items at once. Inserts all provided records sequentially wrapped in a transaction.
	*
	* Uses `this.createOne` under the hood.
	*/
	async createMany(data, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (this.collection === "directus_users") opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;
		const { primaryKeys, nestedActionEvents } = await transaction(this.knex, async (knex) => {
			const previousSeatCount = await captureSeatCount(knex, opts.userIntegrityCheckFlags);
			const service = this.fork({ knex });
			let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
			const primaryKeys$1 = [];
			const nestedActionEvents$1 = [];
			const pkField = this.schema.collections[this.collection].primary;
			for (const [index, payload] of data.entries()) {
				let bypassAutoIncrementSequenceReset = true;
				if (payload[pkField] && (index === data.length - 1 || !data[index + 1]?.[pkField])) bypassAutoIncrementSequenceReset = false;
				const primaryKey = await service.createOne(payload, {
					...opts || {},
					autoPurgeCache: false,
					onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
					bypassEmitAction: (params) => nestedActionEvents$1.push(params),
					mutationTracker: opts.mutationTracker,
					overwriteDefaults: opts.overwriteDefaults?.[index],
					bypassAutoIncrementSequenceReset
				});
				primaryKeys$1.push(primaryKey);
			}
			if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: userIntegrityCheckFlags,
				knex,
				previousSeatCount
			});
			return {
				primaryKeys: primaryKeys$1,
				nestedActionEvents: nestedActionEvents$1
			};
		});
		if (opts.emitEvents !== false) for (const nestedActionEvent of nestedActionEvents) if (opts.bypassEmitAction) opts.bypassEmitAction(nestedActionEvent);
		else emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
		if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
		return primaryKeys;
	}
	/**
	* Get items by query.
	*/
	async readByQuery(query, opts) {
		if (query.version && !isPublishedVersionKey(query.version)) return await handleVersion(this, opts?.key ?? null, query, opts);
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
		if (opts?.emitEvents !== false) emitter_default.emitAction(this.eventScope === "items" ? ["items.read", `${this.collection}.items.read`] : `${this.eventScope}.read`, {
			payload: filteredRecords,
			query: updatedQuery,
			collection: this.collection
		}, {
			database: this.knex || database_default(),
			schema: this.schema,
			accountability: this.accountability
		});
		return filteredRecords;
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
		const results = await this.readByQuery(queryWithKey, {
			...opts,
			key
		});
		if (results.length === 0) throw new ForbiddenError();
		return results[0];
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
		try {
			await transaction(this.knex, async (knex) => {
				const previousSeatCount = await captureSeatCount(knex, opts.userIntegrityCheckFlags);
				const service = this.fork({ knex });
				let userIntegrityCheckFlags = opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None;
				for (const index in data) {
					const item = data[index];
					const primaryKey = item[primaryKeyField];
					if (!primaryKey) throw new InvalidPayloadError({ reason: `Item in update misses primary key` });
					const combinedOpts = {
						autoPurgeCache: false,
						...opts,
						overwriteDefaults: opts.overwriteDefaults?.[index],
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags
					};
					keys.push(await service.updateOne(primaryKey, omit(item, primaryKeyField), combinedOpts));
				}
				if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
				else await validateUserCountIntegrity({
					flags: userIntegrityCheckFlags,
					knex,
					previousSeatCount
				});
			});
		} finally {
			if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
		}
		return keys;
	}
	/**
	* Update many items by primary key, setting all items to the same change.
	*/
	async updateMany(keys, data, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (!opts.bypassLimits) opts.mutationTracker.trackMutations(keys.length);
		if (this.collection === "directus_users" && data["status"] === "active") opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
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
			const previousSeatCount = await captureSeatCount(trx, opts.userIntegrityCheckFlags);
			const payloadService = new PayloadService(this.collection, {
				accountability: this.accountability,
				knex: trx,
				schema: this.schema,
				nested: this.nested,
				overwriteDefaults: opts.overwriteDefaults
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
				knex: trx,
				previousSeatCount
			});
			if (opts.skipTracking !== true && this.accountability && this.schema.collections[this.collection].accountability !== null) {
				const { ActivityService } = await import("./activity.js");
				const { RevisionsService } = await import("./revisions.js");
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
					const itemsService = new ItemsService(this.collection, {
						knex: trx,
						schema: this.schema
					});
					const snapshotFields = difference(fields, getRelationsForCollection(this.schema, this.collection));
					const snapshots = await itemsService.readMany(keys, { fields: snapshotFields.length > 0 ? snapshotFields : ["*"] });
					const revisionsService = new RevisionsService({
						knex: trx,
						schema: this.schema
					});
					const revisions = (await Promise.all(activity.map(async (activity$1, index) => ({
						activity: activity$1,
						collection: this.collection,
						item: keys[index],
						data: Array.isArray(snapshots) && snapshots[index] ? await payloadService.prepareDelta(snapshots[index]) : null,
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
		if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
		if (opts.emitEvents !== false) {
			const actionEvent = {
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
			};
			if (opts.bypassEmitAction) opts.bypassEmitAction(actionEvent);
			else emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context);
			for (const nestedActionEvent of nestedActionEvents) if (opts.bypassEmitAction) opts.bypassEmitAction(nestedActionEvent);
			else emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
		}
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
		const primaryKeys = await transaction(this.knex, async (knex) => {
			const service = this.fork({ knex });
			const primaryKeys$1 = [];
			for (const index in payloads) {
				const payload = payloads[index];
				const primaryKey = await service.upsertOne(payload, {
					...opts || {},
					overwriteDefaults: opts.overwriteDefaults?.[index],
					autoPurgeCache: false
				});
				primaryKeys$1.push(primaryKey);
			}
			return primaryKeys$1;
		});
		if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
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
	/**
	* Delete multiple items by primary key.
	*/
	async deleteMany(keys, opts = {}) {
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (!opts.bypassLimits) opts.mutationTracker.trackMutations(keys.length);
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
		const keysAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`, keys, { collection: this.collection }, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		}) : keys;
		if (this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "delete",
			collection: this.collection,
			primaryKeys: keysAfterHooks
		}, {
			knex: this.knex,
			schema: this.schema
		});
		if (opts.preMutationError) throw opts.preMutationError;
		await transaction(this.knex, async (trx) => {
			const previousSeatCount = await captureSeatCount(trx, opts.userIntegrityCheckFlags);
			await trx(this.collection).whereIn(primaryKeyField, keysAfterHooks).delete();
			if (opts.userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(opts.userIntegrityCheckFlags);
			else await validateUserCountIntegrity({
				flags: opts.userIntegrityCheckFlags,
				knex: trx,
				previousSeatCount
			});
			if (opts.skipTracking !== true && this.accountability && this.schema.collections[this.collection].accountability !== null) {
				const { ActivityService } = await import("./activity.js");
				await new ActivityService({
					knex: trx,
					schema: this.schema
				}).createMany(keysAfterHooks.map((key) => ({
					action: Action.DELETE,
					user: this.accountability.user,
					collection: this.collection,
					ip: this.accountability.ip,
					user_agent: this.accountability.userAgent,
					origin: this.accountability.origin,
					item: key
				})), { bypassLimits: true });
			}
		});
		if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
		if (opts.emitEvents !== false) {
			const actionEvent = {
				event: this.eventScope === "items" ? ["items.delete", `${this.collection}.items.delete`] : `${this.eventScope}.delete`,
				meta: {
					payload: keysAfterHooks,
					keys: keysAfterHooks,
					collection: this.collection
				},
				context: {
					database: database_default(),
					schema: this.schema,
					accountability: this.accountability
				}
			};
			if (opts.bypassEmitAction) opts.bypassEmitAction(actionEvent);
			else emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context);
		}
		return keysAfterHooks;
	}
	/**
	* Read/treat collection as singleton.
	*/
	async readSingleton(query, opts) {
		query = clone(query);
		query.limit = 1;
		if (query.version && !isPublishedVersionKey(query.version)) {
			const primaryKeyField = this.schema.collections[this.collection].primary;
			const key = (await this.knex.select(primaryKeyField).from(this.collection).first())?.[primaryKeyField];
			opts = {
				...opts,
				key
			};
		}
		const record = (await this.readByQuery(query, opts))[0];
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
			return defaults;
		}
		return record;
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