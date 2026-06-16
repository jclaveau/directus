import { useLogger } from "../logger/index.js";
import { UserIntegrityCheckFlag } from "../packages/types/dist/index.js";
import { extractFunctionName } from "../utils/extract-function-name.js";
import { getFunctions, getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import { decrypt, encrypt } from "../utils/encrypt.js";
import { generateHash } from "../utils/generate-hash.js";
import { getSecret } from "../utils/get-secret.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { parseJSON, toArray } from "@directus/utils";
import { clone, cloneDeep, isNil, isObject as isObject$1, isPlainObject } from "lodash-es";
import { randomUUID } from "node:crypto";
import { format, isValid, parseISO } from "date-fns";
import { parse } from "wellknown";
import Joi from "joi";

//#region src/services/payload.ts
/**
* Process a given payload for a collection to ensure the special fields (hash, uuid, date etc) are
* handled correctly.
*/
var PayloadService = class {
	accountability;
	knex;
	helpers;
	collection;
	schema;
	nested;
	overwriteDefaults;
	constructor(collection, options) {
		this.accountability = options.accountability || null;
		this.knex = options.knex || database_default();
		this.helpers = getHelpers(this.knex);
		this.collection = collection;
		this.schema = options.schema;
		this.nested = options.nested ?? [];
		this.overwriteDefaults = options.overwriteDefaults;
		return this;
	}
	transformers = {
		async hash({ action, value }) {
			if (!value) return;
			if (action === "create" || action === "update") return await generateHash(String(value));
			return value;
		},
		async uuid({ action, value }) {
			if (action === "create" && !value) return randomUUID();
			return value;
		},
		async "cast-boolean"({ action, value }) {
			if (action === "read") {
				if (value === true || value === 1 || value === "1") return true;
				else if (value === false || value === 0 || value === "0") return false;
				else if (value === null || value === "") return null;
			}
			return value;
		},
		async "cast-json"({ action, value }) {
			if (action === "read") {
				if (typeof value === "string") try {
					return parseJSON(value);
				} catch {
					return value;
				}
			}
			return value;
		},
		async conceal({ action, value }) {
			if (action === "read") return value ? "**********" : null;
			return value;
		},
		async "user-created"({ action, value, accountability, overwriteDefaults }) {
			if (action === "create") return (overwriteDefaults ? overwriteDefaults._user : accountability?.user) ?? null;
			return value;
		},
		async "user-updated"({ action, value, accountability, overwriteDefaults }) {
			if (action === "update") return (overwriteDefaults ? overwriteDefaults._user : accountability?.user) ?? null;
			return value;
		},
		async "role-created"({ action, value, accountability }) {
			if (action === "create") return accountability?.role || null;
			return value;
		},
		async "role-updated"({ action, value, accountability }) {
			if (action === "update") return accountability?.role || null;
			return value;
		},
		async "date-created"({ action, value, helpers, overwriteDefaults }) {
			if (action === "create") return new Date(overwriteDefaults ? overwriteDefaults._date : helpers.date.writeTimestamp((/* @__PURE__ */ new Date()).toISOString()));
			return value;
		},
		async "date-updated"({ action, value, helpers, overwriteDefaults }) {
			if (action === "update") return new Date(overwriteDefaults ? overwriteDefaults._date : helpers.date.writeTimestamp((/* @__PURE__ */ new Date()).toISOString()));
			return value;
		},
		async "cast-csv"({ action, value }) {
			if (Array.isArray(value) === false && typeof value !== "string") return;
			if (action === "read") {
				if (Array.isArray(value)) return value;
				if (value === "") return [];
				return value.split(",");
			}
			if (Array.isArray(value)) return value.join(",");
			return value;
		},
		async encrypt({ action, value, accountability }) {
			if (!value) return value;
			if (action === "read") {
				if (accountability === null) {
					const key = getSecret();
					try {
						return await decrypt(value, key);
					} catch (err) {
						useLogger().warn(`Failed to decrypt field value: ${err.message}`);
						return null;
					}
				}
				return "**********";
			}
			if (typeof value === "string") return await encrypt(value, getSecret());
			return value;
		}
	};
	async processValues(action, payload, aliasMap = {}, aggregate = {}) {
		const processedPayload = toArray(payload);
		if (processedPayload.length === 0) return [];
		const fieldsInPayload = Object.keys(processedPayload[0]);
		const fieldEntries = Object.entries(this.schema.collections[this.collection].fields);
		const aliasEntries = Object.entries(aliasMap);
		let specialFields = [];
		for (const [name, field] of fieldEntries) if (field.special && field.special.length > 0) {
			specialFields.push([name, field]);
			for (const [aliasName, fieldName] of aliasEntries) if (fieldName === name) specialFields.push([aliasName, {
				...field,
				field: aliasName
			}]);
		}
		if (action === "read") specialFields = specialFields.filter(([name]) => {
			return fieldsInPayload.includes(name);
		});
		for (const record of processedPayload) for (const [name, field] of specialFields) {
			const newValue = await this.processField(field, record, action, this.accountability);
			if (newValue !== void 0) record[name] = newValue;
		}
		this.processGeometries(fieldEntries, processedPayload, action);
		this.processDates(fieldEntries, processedPayload, action, aliasMap, aggregate);
		if (action === "read") this.processJsonFunctionResults(processedPayload, aliasMap);
		if (["create", "update"].includes(action)) processedPayload.forEach((record) => {
			for (const [key, value] of Object.entries(record)) if (Array.isArray(value) || typeof value === "object" && !(value instanceof Date) && value !== null) {
				if (!value.isRawInstance) record[key] = JSON.stringify(value);
			}
		});
		if (action === "read") await this.processAggregates(processedPayload, aggregate);
		if (Array.isArray(payload)) return processedPayload;
		return processedPayload[0];
	}
	async processAggregates(payload, aggregate = {}) {
		/**
		* Build access path with -> delimiter
		*
		* input: { min: [ 'date', 'datetime', 'timestamp' ] }
		* output: [ 'min->date', 'min->datetime', 'min->timestamp' ]
		*/
		const aggregateKeys = Object.entries(aggregate).reduce((acc, [key, values]) => {
			acc.push(...values.map((value) => `${key}->${value}`));
			return acc;
		}, []);
		const fieldEntries = this.schema.collections[this.collection].fields;
		/**
		* Expand -> delimited keys in the payload to the equivalent expanded object
		*
		* before: { "min->date": "2025-04-09", "min->datetime": "2025-04-08T12:00:00", "min->timestamp": "2025-04-17T23:18:00.000Z" }
		* after: { "min": { "date": "2025-04-09", "datetime": "2025-04-08T12:00:00", "timestamp": "2025-04-17T23:18:00.000Z" } }
		*/
		if (aggregateKeys.length) for (const item of payload) for (const key of aggregateKeys) {
			if (key in item === false) continue;
			const [operation, fieldName] = key.split("->");
			const aggregateResult = { [fieldName]: item[key] };
			if (fieldEntries[fieldName]?.special?.length > 0) {
				const newValue = await this.processField(fieldEntries[fieldName], aggregateResult, "read", this.accountability);
				if (newValue !== void 0) aggregateResult[fieldName] = newValue;
			}
			if (!isPlainObject(item[operation])) item[operation] = {};
			item[operation][fieldName] = aggregateResult[fieldName];
			delete item[key];
		}
	}
	async processField(field, payload, action, accountability) {
		if (!field.special) return payload[field.field];
		const fieldSpecials = field.special ? toArray(field.special) : [];
		let value = clone(payload[field.field]);
		for (const special of fieldSpecials) if (special in this.transformers) value = await this.transformers[special]({
			action,
			value,
			payload,
			accountability,
			specials: fieldSpecials,
			helpers: this.helpers,
			overwriteDefaults: this.overwriteDefaults
		});
		return value;
	}
	/**
	* Native geometries are stored in custom binary format. We need to insert them with
	* the function st_geomfromtext. For this to work, that function call must not be
	* escaped. It's therefore placed as a Knex.Raw object in the payload. Thus the need
	* to check if the value is a raw instance before stringifying it in the next step.
	*/
	processGeometries(fieldEntries, payloads, action) {
		const process = action == "read" ? (value) => typeof value === "string" ? parse(value) : value : (value) => this.helpers.st.fromGeoJSON(typeof value == "string" ? parseJSON(value) : value);
		const geometryColumns = fieldEntries.filter(([_, field]) => field.type.startsWith("geometry"));
		for (const [name] of geometryColumns) for (const payload of payloads) if (payload[name]) payload[name] = process(payload[name]);
		return payloads;
	}
	/**
	* When accessing JSON paths that contain objects or arrays, certain databases return stringified
	* JSON (MySQL, SQLite, MSSQL, Oracle). The fn helper's parseJsonResult handles this per-dialect —
	* vendors whose drivers already deserialize the result (e.g. pg for PostgreSQL) use a no-op.
	*/
	processJsonFunctionResults(payloads, aliasMap = {}) {
		const fn = getFunctions(this.knex, this.schema);
		for (const [aliasField, originalField] of Object.entries(aliasMap)) {
			if (extractFunctionName(originalField) !== "json") continue;
			for (const payload of payloads) payload[aliasField] = fn.parseJsonResult(payload[aliasField]);
		}
	}
	/**
	* Knex returns `datetime` and `date` columns as Date.. This is wrong for date / datetime, as those
	* shouldn't return with time / timezone info respectively
	*/
	processDates(fieldEntries, payloads, action, aliasMap = {}, aggregate = {}) {
		const aggregateMapped = Object.fromEntries(Object.entries(aggregate).reduce((acc, [key, values]) => {
			acc.push(...values.map((value) => [`${key}->${value}`, value]));
			return acc;
		}, []));
		const aliasFields = {
			...aliasMap,
			...aggregateMapped
		};
		for (const aliasField in aliasFields) {
			const schemaField = aliasFields[aliasField];
			const field = this.schema.collections[this.collection].fields[schemaField];
			if (field) fieldEntries.push([aliasField, {
				...field,
				field: aliasField
			}]);
		}
		const dateColumns = fieldEntries.filter(([_name, field]) => [
			"dateTime",
			"date",
			"timestamp"
		].includes(field.type));
		const timeColumns = fieldEntries.filter(([_name, field]) => {
			return field.type === "time";
		});
		if (dateColumns.length === 0 && timeColumns.length === 0) return payloads;
		for (const [name, dateColumn] of dateColumns) for (const payload of payloads) {
			let value = payload[name];
			if (value === null || typeof value === "string" && /^[.0 :-]{10,}$/.test(value)) {
				payload[name] = null;
				continue;
			}
			if (!value) continue;
			if (action === "read") {
				if (typeof value === "number" || typeof value === "string") value = new Date(value);
				if (dateColumn.type === "timestamp") payload[name] = this.helpers.date.readTimestampString(value.toISOString());
				if (dateColumn.type === "dateTime") payload[name] = `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`;
				if (dateColumn.type === "date") payload[name] = `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
			} else if (value instanceof Date === false && typeof value === "string") {
				if (dateColumn.type === "date") {
					const parsedDate = parseISO(value);
					if (!isValid(parsedDate)) throw new InvalidPayloadError({ reason: `Invalid Date format in field "${dateColumn.field}"` });
					payload[name] = parsedDate;
				}
				if (dateColumn.type === "dateTime") {
					const parsedDate = parseISO(value);
					if (!isValid(parsedDate)) throw new InvalidPayloadError({ reason: `Invalid DateTime format in field "${dateColumn.field}"` });
					payload[name] = parsedDate;
				}
				if (dateColumn.type === "timestamp") payload[name] = this.helpers.date.writeTimestamp(value);
			}
		}
		/**
		* Some DB drivers (MS SQL f.e.) return time values as Date objects. For consistencies sake,
		* we'll abstract those back to hh:mm:ss
		*/
		for (const [name] of timeColumns) for (const payload of payloads) {
			const value = payload[name];
			if (!value) continue;
			if (action === "read") {
				if (value instanceof Date) payload[name] = format(value, "HH:mm:ss");
			}
		}
		return payloads;
	}
	/**
	* Recursively save/update all nested related Any-to-One items
	*/
	async processA2O(data, opts) {
		const relations = this.schema.relations.filter((relation) => {
			return relation.collection === this.collection;
		});
		const revisions = [];
		let userIntegrityCheckFlags = UserIntegrityCheckFlag.None;
		const nestedActionEvents = [];
		const payload = cloneDeep(data);
		const relationsToProcess = relations.filter((relation) => {
			return relation.field in payload && isPlainObject(payload[relation.field]);
		});
		for (const relation of relationsToProcess) {
			if (!relation.meta?.one_collection_field || !relation.meta?.one_allowed_collections) continue;
			const relatedCollection = payload[relation.meta.one_collection_field];
			if (!relatedCollection) throw new InvalidPayloadError({ reason: `Can't update nested record "${relation.collection}.${relation.field}" without field "${relation.collection}.${relation.meta.one_collection_field}" being set` });
			if (relation.meta.one_allowed_collections.includes(relatedCollection) === false) throw new InvalidPayloadError({ reason: `"${relation.collection}.${relation.field}" can't be linked to collection "${relatedCollection}"` });
			const { getService } = await import("../utils/get-service.js");
			const service = getService(relatedCollection, {
				accountability: this.accountability,
				knex: this.knex,
				schema: this.schema,
				nested: [...this.nested, relation.field]
			});
			const relatedPrimaryKeyField = this.schema.collections[relatedCollection].primary;
			const relatedRecord = payload[relation.field];
			if (["string", "number"].includes(typeof relatedRecord)) continue;
			const hasPrimaryKey = relatedPrimaryKeyField in relatedRecord;
			let relatedPrimaryKey = relatedRecord[relatedPrimaryKeyField];
			if (hasPrimaryKey && !!await this.knex.select(relatedPrimaryKeyField).from(relatedCollection).where({ [relatedPrimaryKeyField]: relatedPrimaryKey }).first()) {
				const { [relatedPrimaryKeyField]: _,...record } = relatedRecord;
				if (Object.keys(record).length > 0) await service.updateOne(relatedPrimaryKey, record, {
					onRevisionCreate: (pk) => revisions.push(pk),
					onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
					bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					emitEvents: opts?.emitEvents,
					autoPurgeCache: opts?.autoPurgeCache,
					autoPurgeSystemCache: opts?.autoPurgeSystemCache,
					skipTracking: opts?.skipTracking,
					overwriteDefaults: opts?.overwriteDefaults?.[relation.field],
					onItemCreate: opts?.onItemCreate,
					mutationTracker: opts?.mutationTracker
				});
			} else relatedPrimaryKey = await service.createOne(relatedRecord, {
				onRevisionCreate: (pk) => revisions.push(pk),
				onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
				bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
				emitEvents: opts?.emitEvents,
				autoPurgeCache: opts?.autoPurgeCache,
				autoPurgeSystemCache: opts?.autoPurgeSystemCache,
				skipTracking: opts?.skipTracking,
				overwriteDefaults: opts?.overwriteDefaults?.[relation.field],
				onItemCreate: opts?.onItemCreate,
				mutationTracker: opts?.mutationTracker
			});
			payload[relation.field] = relatedPrimaryKey;
		}
		return {
			payload,
			revisions,
			nestedActionEvents,
			userIntegrityCheckFlags
		};
	}
	/**
	* Save/update all nested related m2o items inside the payload
	*/
	async processM2O(data, opts) {
		const payload = cloneDeep(data);
		const revisions = [];
		let userIntegrityCheckFlags = UserIntegrityCheckFlag.None;
		const nestedActionEvents = [];
		const relationsToProcess = this.schema.relations.filter((relation) => {
			return relation.collection === this.collection;
		}).filter((relation) => {
			return relation.field in payload && isObject$1(payload[relation.field]);
		});
		for (const relation of relationsToProcess) {
			if (!relation.related_collection) continue;
			const relatedPrimaryKeyField = this.schema.collections[relation.related_collection].primary;
			const { getService } = await import("../utils/get-service.js");
			const service = getService(relation.related_collection, {
				accountability: this.accountability,
				knex: this.knex,
				schema: this.schema,
				nested: [...this.nested, relation.field]
			});
			const relatedRecord = payload[relation.field];
			if (["string", "number"].includes(typeof relatedRecord)) continue;
			const hasPrimaryKey = relatedPrimaryKeyField in relatedRecord;
			let relatedPrimaryKey = relatedRecord[relatedPrimaryKeyField];
			if (hasPrimaryKey && !!await this.knex.select(relatedPrimaryKeyField).from(relation.related_collection).where({ [relatedPrimaryKeyField]: relatedPrimaryKey }).first()) {
				const { [relatedPrimaryKeyField]: _,...record } = relatedRecord;
				if (Object.keys(record).length > 0) await service.updateOne(relatedPrimaryKey, record, {
					onRevisionCreate: (pk) => revisions.push(pk),
					onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
					bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					emitEvents: opts?.emitEvents,
					autoPurgeCache: opts?.autoPurgeCache,
					autoPurgeSystemCache: opts?.autoPurgeSystemCache,
					skipTracking: opts?.skipTracking,
					overwriteDefaults: opts?.overwriteDefaults?.[relation.field],
					onItemCreate: opts?.onItemCreate,
					mutationTracker: opts?.mutationTracker
				});
			} else relatedPrimaryKey = await service.createOne(relatedRecord, {
				onRevisionCreate: (pk) => revisions.push(pk),
				onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
				bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
				emitEvents: opts?.emitEvents,
				autoPurgeCache: opts?.autoPurgeCache,
				autoPurgeSystemCache: opts?.autoPurgeSystemCache,
				skipTracking: opts?.skipTracking,
				overwriteDefaults: opts?.overwriteDefaults?.[relation.field],
				onItemCreate: opts?.onItemCreate,
				mutationTracker: opts?.mutationTracker
			});
			payload[relation.field] = relatedPrimaryKey;
		}
		return {
			payload,
			revisions,
			nestedActionEvents,
			userIntegrityCheckFlags
		};
	}
	/**
	* Recursively save/update all nested related o2m items
	*/
	async processO2M(data, parent, opts) {
		const revisions = [];
		let userIntegrityCheckFlags = UserIntegrityCheckFlag.None;
		const nestedActionEvents = [];
		const relations = this.schema.relations.filter((relation) => {
			return relation.related_collection === this.collection;
		});
		const payload = cloneDeep(data);
		const relationsToProcess = relations.filter((relation) => {
			if (!relation.meta?.one_field) return false;
			return relation.meta.one_field in payload;
		});
		const nestedUpdateSchema = Joi.object({
			create: Joi.array().items(Joi.object().unknown()),
			update: Joi.array().items(Joi.object().unknown()),
			delete: Joi.array().items(Joi.string(), Joi.number())
		});
		for (const relation of relationsToProcess) {
			if (!relation.meta) continue;
			const currentPrimaryKeyField = this.schema.collections[relation.related_collection].primary;
			const relatedPrimaryKeyField = this.schema.collections[relation.collection].primary;
			const { getService } = await import("../utils/get-service.js");
			const service = getService(relation.collection, {
				accountability: this.accountability,
				knex: this.knex,
				schema: this.schema,
				nested: [...this.nested, relation.meta.one_field]
			});
			const recordsToUpsert = [];
			const savedPrimaryKeys = [];
			const field = payload[relation.meta.one_field];
			if (!field || Array.isArray(field)) {
				const updates = field || [];
				for (let i = 0; i < updates.length; i++) {
					const currentId = parent || payload[currentPrimaryKeyField];
					const relatedRecord = updates[i];
					const relatedId = typeof relatedRecord === "string" || typeof relatedRecord === "number" ? relatedRecord : relatedRecord[relatedPrimaryKeyField];
					let record = cloneDeep(relatedRecord);
					let existingRecord;
					if (relatedId) existingRecord = await this.knex.select(relatedPrimaryKeyField, relation.field).from(relation.collection).where({ [relatedPrimaryKeyField]: relatedId }).first();
					if (typeof relatedRecord === "string" || typeof relatedRecord === "number") {
						if (!existingRecord) throw new ForbiddenError();
						if (isNil(existingRecord[relation.field]) === false && existingRecord[relation.field] == currentId) {
							savedPrimaryKeys.push(existingRecord[relatedPrimaryKeyField]);
							continue;
						}
						record = { [relatedPrimaryKeyField]: relatedRecord };
					}
					if (!existingRecord || existingRecord[relation.field] != parent) record[relation.field] = currentId;
					recordsToUpsert.push(record);
				}
				savedPrimaryKeys.push(...await service.upsertMany(recordsToUpsert, {
					onRevisionCreate: (pk) => revisions.push(pk),
					onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
					bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					emitEvents: opts?.emitEvents,
					autoPurgeCache: opts?.autoPurgeCache,
					autoPurgeSystemCache: opts?.autoPurgeSystemCache,
					skipTracking: opts?.skipTracking,
					overwriteDefaults: opts?.overwriteDefaults?.[relation.meta.one_field],
					onItemCreate: opts?.onItemCreate,
					mutationTracker: opts?.mutationTracker
				}));
				const query = {
					filter: { _and: [{ [relation.field]: { _eq: parent } }, { [relatedPrimaryKeyField]: { _nin: savedPrimaryKeys } }] },
					limit: -1
				};
				if (relation.meta.one_deselect_action === "delete") await service.deleteByQuery(query, {
					onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
					bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					emitEvents: opts?.emitEvents,
					autoPurgeCache: opts?.autoPurgeCache,
					autoPurgeSystemCache: opts?.autoPurgeSystemCache,
					skipTracking: opts?.skipTracking,
					overwriteDefaults: opts?.overwriteDefaults?.[relation.meta.one_field],
					onItemCreate: opts?.onItemCreate,
					mutationTracker: opts?.mutationTracker
				});
				else await service.updateByQuery(query, { [relation.field]: null }, {
					onRevisionCreate: (pk) => revisions.push(pk),
					onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
					bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
					emitEvents: opts?.emitEvents,
					autoPurgeCache: opts?.autoPurgeCache,
					autoPurgeSystemCache: opts?.autoPurgeSystemCache,
					skipTracking: opts?.skipTracking,
					overwriteDefaults: opts?.overwriteDefaults?.[relation.meta.one_field],
					onItemCreate: opts?.onItemCreate,
					mutationTracker: opts?.mutationTracker
				});
			} else {
				const alterations = field;
				const { error } = nestedUpdateSchema.validate(alterations);
				if (error) throw new InvalidPayloadError({ reason: `Invalid one-to-many update structure: ${error.message}` });
				if (alterations.create) {
					const sortField = relation.meta.sort_field;
					let createPayload;
					if (sortField !== null) {
						const highestOrderNumber = await this.knex.from(relation.collection).where({ [relation.field]: parent }).whereNotNull(sortField).max(sortField, { as: "max" }).first();
						createPayload = alterations.create.map((item, index) => {
							const record = cloneDeep(item);
							if (parent !== null && record[sortField] === void 0) record[sortField] = highestOrderNumber?.max ? highestOrderNumber.max + index + 1 : index + 1;
							return {
								...record,
								[relation.field]: parent || payload[currentPrimaryKeyField]
							};
						});
					} else createPayload = alterations.create.map((item) => ({
						...item,
						[relation.field]: parent || payload[currentPrimaryKeyField]
					}));
					await service.createMany(createPayload, {
						onRevisionCreate: (pk) => revisions.push(pk),
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
						bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						emitEvents: opts?.emitEvents,
						autoPurgeCache: opts?.autoPurgeCache,
						autoPurgeSystemCache: opts?.autoPurgeSystemCache,
						skipTracking: opts?.skipTracking,
						overwriteDefaults: opts?.overwriteDefaults?.[relation.meta.one_field]?.["create"],
						onItemCreate: opts?.onItemCreate,
						mutationTracker: opts?.mutationTracker
					});
				}
				if (alterations.update) for (const index in alterations.update) {
					const { [relatedPrimaryKeyField]: key,...record } = alterations.update[index];
					const existingRecord = await this.knex.select(relatedPrimaryKeyField, relation.field).from(relation.collection).where({ [relatedPrimaryKeyField]: key }).first();
					if (!existingRecord || existingRecord[relation.field] != parent) record[relation.field] = parent || payload[currentPrimaryKeyField];
					await service.updateOne(key, record, {
						onRevisionCreate: (pk) => revisions.push(pk),
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
						bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						emitEvents: opts?.emitEvents,
						autoPurgeCache: opts?.autoPurgeCache,
						autoPurgeSystemCache: opts?.autoPurgeSystemCache,
						skipTracking: opts?.skipTracking,
						overwriteDefaults: opts?.overwriteDefaults?.[relation.meta.one_field]?.["update"][index],
						onItemCreate: opts?.onItemCreate,
						mutationTracker: opts?.mutationTracker
					});
				}
				if (alterations.delete) {
					const query = {
						filter: { _and: [{ [relation.field]: { _eq: parent } }, { [relatedPrimaryKeyField]: { _in: alterations.delete } }] },
						limit: -1
					};
					if (relation.meta.one_deselect_action === "delete") await service.deleteByQuery(query, {
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
						bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						emitEvents: opts?.emitEvents,
						autoPurgeCache: opts?.autoPurgeCache,
						autoPurgeSystemCache: opts?.autoPurgeSystemCache,
						skipTracking: opts?.skipTracking,
						overwriteDefaults: opts?.overwriteDefaults?.[relation.meta.one_field]?.["delete"],
						onItemCreate: opts?.onItemCreate,
						mutationTracker: opts?.mutationTracker
					});
					else await service.updateByQuery(query, { [relation.field]: null }, {
						onRevisionCreate: (pk) => revisions.push(pk),
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
						bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						emitEvents: opts?.emitEvents,
						autoPurgeCache: opts?.autoPurgeCache,
						autoPurgeSystemCache: opts?.autoPurgeSystemCache,
						skipTracking: opts?.skipTracking,
						overwriteDefaults: opts?.overwriteDefaults?.[relation.meta.one_field]?.["delete"],
						onItemCreate: opts?.onItemCreate,
						mutationTracker: opts?.mutationTracker
					});
				}
			}
		}
		return {
			revisions,
			nestedActionEvents,
			userIntegrityCheckFlags
		};
	}
	/**
	* Transforms the input partial payload to match the output structure, to have consistency
	* between delta and data
	*/
	async prepareDelta(delta) {
		let payload = cloneDeep(delta);
		for (const key in payload) if (payload[key]?.isRawInstance) payload[key] = payload[key].bindings[0];
		payload = await this.processValues("read", payload);
		if (Object.keys(payload).length === 0) return null;
		return payload;
	}
};

//#endregion
export { PayloadService };