import { getCache } from "../cache.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { processAst } from "../permissions/modules/process-ast/process-ast.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { UserIntegrityCheckFlag, validateUserCountIntegrity } from "../utils/validate-user-count-integrity.js";
import { throwDatabaseError } from "../database/errors/translate.js";
import { getAstFromQuery } from "../database/get-ast-from-query/get-ast-from-query.js";
import { PayloadService } from "./payload.js";
import { runAst } from "../database/run-ast/run-ast.js";
import { processPayload } from "../permissions/modules/process-payload/process-payload.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { isNotPrimaryKey, isPrimaryKey } from "../utils/is-primary-key.js";
import { transaction } from "../utils/transaction.js";
import { validateKeys } from "../utils/validate-keys.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { assign, clone, cloneDeep, omit, pick, without } from "lodash-es";
import { toBoolean } from "@directus/utils";
import { Action } from "@directus/constants";
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
		}).readByQuery(readQuery, { emitEvents: false })).map((item) => item[primaryKeyField]).filter((pk) => pk);
	}
	/**
	* Create a single new item. Delegates to {@link createMany}.
	*/
	async createOne(data, opts = {}) {
		const [primaryKey] = await this.createMany([data], opts);
		return primaryKey;
	}
	async createMany(data, opts = {}) {
		if (data.length === 0) return [];
		if (!opts.mutationTracker) opts.mutationTracker = this.createMutationTracker();
		if (!opts.bypassLimits) opts.mutationTracker.trackMutations(data.length);
		const primaryKeyField = this.schema.collections[this.collection].primary;
		const fields = Object.keys(this.schema.collections[this.collection].fields);
		const aliases = Object.values(this.schema.collections[this.collection].fields).filter((field) => field.alias === true).map((field) => field.field);
		let autoIncrementSequenceNeedsToBeReset = false;
		const itemsValues = await this.knex.transaction(async (trx) => {
			const payloadService = new PayloadService(this.collection, {
				accountability: this.accountability,
				knex: trx,
				schema: this.schema
			});
			const preparedItems = [];
			for (const payloadToClone of data) {
				const payload = cloneDeep(payloadToClone);
				const payloadAfterHooks = opts.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === `items` ? [`items.create`, `${this.collection}.items.create`] : `${this.eventScope}.create`, payload, { collection: this.collection }, {
					database: trx,
					schema: this.schema,
					accountability: this.accountability
				}) : payload;
				if (payloadAfterHooks === null) continue;
				if (typeof payloadAfterHooks === "string" || typeof payloadAfterHooks === "number") {
					preparedItems.push(payloadAfterHooks);
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
				const payloadService$1 = new PayloadService(this.collection, {
					accountability: this.accountability,
					knex: trx,
					schema: this.schema,
					nested: this.nested
				});
				const { payload: payloadWithM2O, revisions: revisionsM2O, nestedActionEvents: nestedActionEventsM2O, userIntegrityCheckFlags: userIntegrityCheckFlagsM2O } = await payloadService$1.processM2O(payloadWithPresets, opts);
				const { payload: payloadWithA2O, revisions: revisionsA2O, nestedActionEvents: nestedActionEventsA2O, userIntegrityCheckFlags: userIntegrityCheckFlagsA2O } = await payloadService$1.processA2O(payloadWithM2O, opts);
				const payloadWithoutAliases = pick(payloadWithA2O, without(fields, ...aliases));
				const primaryKey = (await payloadService$1.processValues(`create`, payloadWithoutAliases))[primaryKeyField];
				if (primaryKey) validateKeys(this.schema, this.collection, primaryKeyField, primaryKey);
				const pkField = this.schema.collections[this.collection].fields[primaryKeyField];
				if (primaryKey && pkField && !opts.bypassAutoIncrementSequenceReset && ["integer", "bigInteger"].includes(pkField.type) && pkField.defaultValue === "AUTO_INCREMENT") autoIncrementSequenceNeedsToBeReset = true;
				preparedItems.push({
					primaryKey,
					actionHookPayload,
					payloadAfterHooks,
					payloadWithPresets,
					payloadWithoutAliases,
					revisionsM2O,
					revisionsA2O,
					nestedActionEventsM2O,
					nestedActionEventsA2O,
					userIntegrityCheckFlagsM2O,
					userIntegrityCheckFlagsA2O
				});
			}
			const itemsToInsert = preparedItems.filter(isNotPrimaryKey);
			const collectionSchema = this.schema.collections[this.collection];
			if (!collectionSchema) throw new Error(`Can't find collection schema of ${this.collection}`);
			const collectionFieldsSchema = collectionSchema.fields;
			if (!collectionFieldsSchema) throw new Error(`Can't find collection's fields schema of ${this.collection}`);
			const sqliteFieldsRequiringValue = this.knex.client.config.client === "sqlite3" ? Object.fromEntries(Object.entries(collectionFieldsSchema).filter(([fieldName, field]) => {
				return fieldName !== primaryKeyField && field.nullable === false;
			}).map(([fieldName, field]) => {
				return [fieldName, field.defaultValue];
			})) : {};
			try {
				const rowsToInsert = itemsToInsert.map((v) => {
					return {
						...sqliteFieldsRequiringValue,
						...v.payloadWithoutAliases
					};
				});
				let insertedRows;
				if (await getHelpers(trx).capabilities.preservesInsertOrderInReturning()) {
					const chunkSizeEnv = env["DB_BATCH_INSERT_CHUNK_SIZE"];
					const chunkSize = chunkSizeEnv !== void 0 ? Number(chunkSizeEnv) : void 0;
					let dbQuery = trx.batchInsert(this.collection, rowsToInsert, chunkSize).returning(primaryKeyField);
					dbQuery = await emitter_default.emitFilter(["items.db.insert", `${this.collection}.db.insert`], dbQuery, {
						collection: this.collection,
						payload: data
					}, {
						database: trx,
						schema: this.schema,
						accountability: this.accountability
					});
					insertedRows = await dbQuery;
				} else {
					insertedRows = [];
					for (const row of rowsToInsert) {
						const result = await trx.insert(row).into(this.collection).returning(primaryKeyField);
						insertedRows.push(result[0]);
					}
				}
				if (insertedRows.length !== itemsToInsert.length) throw new Error(`Insert returned ${insertedRows.length} rows but expected ${itemsToInsert.length}`);
				(await emitter_default.emitFilter(["items.db.inserted", `${this.collection}.db.inserted`], insertedRows, {
					collection: this.collection,
					payload: data
				}, {
					database: trx,
					schema: this.schema,
					accountability: this.accountability
				})).forEach((result, index) => {
					const preparedValues = itemsToInsert[index];
					if (!preparedValues) throw new Error(`No insert itemInput found for index ${index}`);
					const returnedKey = typeof result === `object` && result !== null ? result[primaryKeyField] : result;
					if (this.schema.collections[this.collection].fields[primaryKeyField].type === `uuid`) preparedValues.primaryKey = getHelpers(trx).schema.formatUUID(preparedValues.primaryKey ?? returnedKey);
					else preparedValues.primaryKey = preparedValues.primaryKey ?? returnedKey;
				});
			} catch (err) {
				await throwDatabaseError(err, data);
			}
			const preparedForPostInsertProcessResponses = await Promise.allSettled(itemsToInsert.map(async (preparedItem) => {
				const { primaryKey, payloadAfterHooks, payloadWithPresets, revisionsM2O, revisionsA2O, userIntegrityCheckFlagsM2O, userIntegrityCheckFlagsA2O } = preparedItem;
				const { revisions: revisionsO2M, nestedActionEvents: nestedActionEventsO2M, userIntegrityCheckFlags: userIntegrityCheckFlagsO2M } = await payloadService.processO2M(payloadWithPresets, primaryKey, opts);
				const userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | userIntegrityCheckFlagsM2O | userIntegrityCheckFlagsA2O | userIntegrityCheckFlagsO2M;
				if (userIntegrityCheckFlags) if (opts.onRequireUserIntegrityCheck) opts.onRequireUserIntegrityCheck(userIntegrityCheckFlags);
				else await validateUserCountIntegrity({
					flags: userIntegrityCheckFlags,
					knex: trx
				});
				const activityInput = this.accountability && this.schema.collections[this.collection].accountability !== null ? {
					action: Action.CREATE,
					user: this.accountability.user,
					collection: this.collection,
					ip: this.accountability.ip,
					user_agent: this.accountability.userAgent,
					origin: this.accountability.origin,
					item: primaryKey
				} : void 0;
				const revisionInput = activityInput !== void 0 && this.schema.collections[this.collection].accountability === `all` ? await (async () => {
					const revisionDelta = await payloadService.prepareDelta(payloadAfterHooks);
					return {
						collection: this.collection,
						item: primaryKey,
						data: revisionDelta,
						delta: revisionDelta
					};
				})() : void 0;
				let activity;
				let revision;
				return {
					...preparedItem,
					nestedActionEventsO2M,
					activityInput,
					activity,
					revisionInput,
					revision,
					childrenRevisions: [
						...revisionsM2O,
						...revisionsA2O,
						...revisionsO2M
					]
				};
			}));
			const isRejected = (input) => {
				return input.status === "rejected";
			};
			const isFulfilled = (input) => {
				return input.status === "fulfilled";
			};
			const errorReasons = preparedForPostInsertProcessResponses.filter(isRejected)?.map((i) => i.reason);
			if (errorReasons.length) throw errorReasons[0];
			const preparedForPostInsert = preparedForPostInsertProcessResponses.filter(isFulfilled)?.map((item) => item.value);
			const itemsWithActivityInput = preparedForPostInsert.filter(isNotPrimaryKey).filter((item) => {
				return item.activityInput !== void 0;
			});
			const { ActivityService } = await import("./activity.js");
			const itemsWithRevisionInput = (await new ActivityService({
				knex: trx,
				schema: this.schema
			}).createMany(itemsWithActivityInput.map((item) => {
				return item.activityInput;
			}))).map((activityPk, index) => {
				if (!(index in itemsWithActivityInput) || itemsWithActivityInput[index] === void 0) throw new Error(`Unable to find '${index}' in activitiesItems`);
				return {
					...itemsWithActivityInput[index],
					activity: activityPk
				};
			}).filter((item) => {
				return item.revisionInput !== void 0;
			});
			const { RevisionsService } = await import("./revisions.js");
			const revisionsService = new RevisionsService({
				knex: trx,
				schema: this.schema
			});
			const itemsWithActivityAndRevision = (await revisionsService.createMany(itemsWithRevisionInput.map((item) => {
				return {
					...item.revisionInput,
					activity: item.activity
				};
			}))).map((revisionPk, index) => {
				if (!(index in itemsWithRevisionInput) || itemsWithRevisionInput[index] === void 0) throw new Error(`Unable to find '${index}' in itemsWithRevisionInput`);
				return {
					...itemsWithRevisionInput[index],
					revision: revisionPk
				};
			});
			const revisionErrorReasons = (await Promise.allSettled(itemsWithActivityAndRevision.map(async (item) => {
				if (item.childrenRevisions.length > 0) await revisionsService.updateMany(item.childrenRevisions, { parent: item.revision });
				if (opts.onRevisionCreate) opts.onRevisionCreate(item.revision);
			}))).filter(isRejected)?.map((i) => i.reason);
			if (revisionErrorReasons.length) throw revisionErrorReasons[0];
			if (autoIncrementSequenceNeedsToBeReset) await getHelpers(trx).sequence.resetAutoIncrementSequence(this.collection, primaryKeyField);
			return preparedForPostInsert;
		});
		for (const itemValues of itemsValues.filter(isNotPrimaryKey)) {
			if (opts.emitEvents === false) continue;
			const { primaryKey, actionHookPayload, nestedActionEventsM2O, nestedActionEventsA2O, nestedActionEventsO2M } = itemValues;
			const actionEvent = {
				event: this.eventScope === `items` ? [`items.create`, `${this.collection}.items.create`] : `${this.eventScope}.create`,
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
			if (opts.bypassEmitAction) await opts.bypassEmitAction(actionEvent);
			else await emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context);
			const nestedActionEvents = [
				...nestedActionEventsO2M || [],
				...nestedActionEventsA2O,
				...nestedActionEventsM2O
			];
			for (const nestedActionEvent of nestedActionEvents) if (opts.bypassEmitAction) await opts.bypassEmitAction(nestedActionEvent);
			else await emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
		}
		if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
		return itemsValues.map((itemValues) => {
			if (isPrimaryKey(itemValues)) return itemValues;
			return itemValues.primaryKey;
		});
	}
	/**
	* Get items by query.
	*/
	async readByQuery(query, opts) {
		let updatedQuery = opts?.emitEvents !== false ? await emitter_default.emitFilter(this.eventScope === "items" ? ["items.query", `${this.collection}.items.query`] : `${this.eventScope}.query`, query, { collection: this.collection }, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		}) : query;
		if (toBoolean(env["DB_DEFAULT_ORDER_READS_BY_PK"] ?? true) && !updatedQuery.sort?.length && !updatedQuery.group?.length && !updatedQuery.aggregate) {
			const primaryKeyField = this.schema.collections[this.collection].primary;
			const pkFieldType = this.schema.collections[this.collection].fields[primaryKeyField]?.type;
			if (pkFieldType === "integer" || pkFieldType === "bigInteger") updatedQuery = {
				...updatedQuery,
				sort: [primaryKeyField]
			};
		}
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
		if (opts?.emitEvents !== false) await emitter_default.emitAction(this.eventScope === "items" ? ["items.read", `${this.collection}.items.read`] : `${this.eventScope}.read`, {
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
		const results = await this.readByQuery(queryWithKey, opts);
		if (results.length === 0) throw new ForbiddenError({
			reason: `No result found for key ${key} in ${this.collection} during items.readOne()`,
			values: {
				accountability: this.accountability,
				key
			}
		});
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
		const { ActivityService } = await import("./activity.js");
		const { RevisionsService } = await import("./revisions.js");
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
		const payloadKeys = Object.keys(payloadAfterHooks ?? {});
		if (payloadKeys.length === 0 || payloadKeys.length === 1 && payloadKeys[0] === primaryKeyField) return [];
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
				if (keys.length > 1) await trx(this.collection).update(payloadWithTypeCasting).whereIn(primaryKeyField, keys);
				else await trx(this.collection).update(payloadWithTypeCasting).where(primaryKeyField, keys[0]);
			} catch (err) {
				await throwDatabaseError(err, data);
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
			if (opts.bypassEmitAction) await opts.bypassEmitAction(actionEvent);
			else await emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context);
			for (const nestedActionEvent of nestedActionEvents) if (opts.bypassEmitAction) await opts.bypassEmitAction(nestedActionEvent);
			else await emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
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
			for (const payload of payloads) {
				const primaryKey = await service.upsertOne(payload, {
					...opts || {},
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
		const { ActivityService } = await import("./activity.js");
		const primaryKeyField = this.schema.collections[this.collection].primary;
		validateKeys(this.schema, this.collection, primaryKeyField, keys);
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
		if (shouldClearCache(this.cache, opts, this.collection)) await this.cache.clear();
		if (opts.emitEvents !== false) {
			const actionEvent = {
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
			};
			if (opts.bypassEmitAction) await opts.bypassEmitAction(actionEvent);
			else await emitter_default.emitAction(actionEvent.event, actionEvent.meta, actionEvent.context);
		}
		return keys;
	}
	/**
	* Read/treat collection as singleton.
	*/
	async readSingleton(query, opts) {
		query = clone(query);
		query.limit = 1;
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