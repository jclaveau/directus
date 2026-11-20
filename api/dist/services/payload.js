import { chunk, clone, cloneDeep, isNil, isObject as isObject$1, isPlainObject, pick } from "../utils/lodash-es-used.js";
import { format, isValid, parseISO } from "../utils/date-fns-used.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import { generateHash } from "../utils/generate-hash.js";
import { isMissingPrimaryKey, isPrimaryKey } from "../utils/is-primary-key.js";
import { primaryKeyNameOf } from "../utils/primary-key-name.js";
import { resolveMutationBatching } from "../utils/resolve-mutation-batching.js";
import { validateKeys } from "../utils/validate-keys.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { UserIntegrityCheckFlag } from "@directus/types";
import { parseJSON, toArray } from "@directus/utils";
import Joi from "joi";
import { randomUUID } from "node:crypto";
import { parse } from "wellknown";
import { unflatten } from "flat";

//#region src/services/payload.ts
const RELATED_READ_CHUNK_SIZE = 1e4;
function nestedUpdateRefusal(key, collection) {
	return new InvalidPayloadError({ reason: `Record ${JSON.stringify(key)} of ${JSON.stringify(collection)} is nested with fields besides its key, refused by nestedUpdates=refuse` });
}
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
	constructor(collection, options) {
		this.accountability = options.accountability || null;
		this.knex = options.knex || database_default();
		this.helpers = getHelpers(this.knex);
		this.collection = collection;
		this.schema = options.schema;
		this.nested = options.nested ?? [];
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
		async "user-created"({ action, value, accountability }) {
			if (action === "create") return accountability?.user || null;
			return value;
		},
		async "user-updated"({ action, value, accountability }) {
			if (action === "update") return accountability?.user || null;
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
		async "date-created"({ action, value, helpers }) {
			if (action === "create") return new Date(helpers.date.writeTimestamp((/* @__PURE__ */ new Date()).toISOString()));
			return value;
		},
		async "date-updated"({ action, value, helpers }) {
			if (action === "update") return new Date(helpers.date.writeTimestamp((/* @__PURE__ */ new Date()).toISOString()));
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
		if (["create", "update"].includes(action)) processedPayload.forEach((record) => {
			for (const [key, value] of Object.entries(record)) if (Array.isArray(value) || typeof value === "object" && !(value instanceof Date) && value !== null) {
				if (!value.isRawInstance) record[key] = JSON.stringify(value);
			}
		});
		if (action === "read") this.processAggregates(processedPayload, aggregate);
		if (Array.isArray(payload)) return processedPayload;
		return processedPayload[0];
	}
	processAggregates(payload, aggregate = {}) {
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
		/**
		* Expand -> delimited keys in the payload to the equivalent expanded object
		*
		* before: { "min->date": "2025-04-09", "min->datetime": "2025-04-08T12:00:00", "min->timestamp": "2025-04-17T23:18:00.000Z" }
		* after: { "min": { "date": "2025-04-09", "datetime": "2025-04-08T12:00:00", "timestamp": "2025-04-17T23:18:00.000Z" } }
		*/
		if (aggregateKeys.length) for (const item of payload) {
			Object.assign(item, unflatten(pick(item, aggregateKeys), { delimiter: "->" }));
			aggregateKeys.forEach((key) => delete item[key]);
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
			helpers: this.helpers
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
	* Save/update the nested M2O and A2O items of several rows.
	*
	* Per related collection, the records the rows nest in any of its fields,
	* M2O or A2O, go through one upsertMany in payload order, and each payload
	* comes back with its record replaced by the record's key. A collection
	* another one references is written first. The collections of a foreign
	* key cycle are written one record at a time in payload order, as before
	* batching: no single collection order fits every batch inside a cycle.
	*/
	async processM2OAndA2O(rows, opts) {
		if (!Array.isArray(rows)) throw new Error(`processM2OAndA2O takes the rows as an array, got ${JSON.stringify(rows)}`);
		const rowsResult = {
			payloads: rows.map((row) => cloneDeep(row)),
			revisionsByParent: rows.map(() => []),
			nestedActionEvents: [],
			userIntegrityCheckFlags: UserIntegrityCheckFlag.None
		};
		const relations = this.schema.relations.filter((relation) => {
			return relation.collection === this.collection;
		});
		const fieldsOfCollections = /* @__PURE__ */ new Map();
		for (const relation of relations) {
			if (!relation.related_collection) continue;
			const collectionFields = fieldsOfCollections.get(relation.related_collection) ?? [];
			if (!collectionFields.includes(relation.field)) collectionFields.push(relation.field);
			fieldsOfCollections.set(relation.related_collection, collectionFields);
		}
		const referencesOfCollections = /* @__PURE__ */ new Map();
		for (const [collectionName, collectionFields] of fieldsOfCollections) {
			const references = [...rowsResult.payloads.entries()].flatMap(([rowIndex, payload]) => {
				return collectionFields.filter((field) => field in payload && isObject$1(payload[field])).map((field) => ({
					rowIndex,
					field
				}));
			});
			if (references.length > 0) referencesOfCollections.set(collectionName, references);
		}
		const a2oFields = /* @__PURE__ */ new Set();
		for (const relation of relations) {
			if (!relation.meta?.one_collection_field || !relation.meta?.one_allowed_collections || a2oFields.has(relation.field)) continue;
			a2oFields.add(relation.field);
			const collectionField = relation.meta.one_collection_field;
			const allowedCollections = relation.meta.one_allowed_collections;
			for (const [rowIndex, payload] of rowsResult.payloads.entries()) {
				if (!(relation.field in payload) || !isPlainObject(payload[relation.field])) continue;
				const relatedCollection = payload[collectionField];
				if (!relatedCollection) throw new InvalidPayloadError({ reason: `Can't update nested record ${JSON.stringify(`${relation.collection}.${relation.field}`)} without field ${JSON.stringify(`${relation.collection}.${collectionField}`)} being set` });
				if (allowedCollections.includes(relatedCollection) === false) throw new InvalidPayloadError({ reason: `${JSON.stringify(`${relation.collection}.${relation.field}`)} can't be linked to collection ${JSON.stringify(relatedCollection)}` });
				const collectionReferences = referencesOfCollections.get(relatedCollection) ?? [];
				collectionReferences.push({
					rowIndex,
					field: relation.field
				});
				referencesOfCollections.set(relatedCollection, collectionReferences);
			}
		}
		const orderedCollections = [];
		const visitedCollections = /* @__PURE__ */ new Set();
		const visitCollection = (collectionName) => {
			if (visitedCollections.has(collectionName)) return;
			visitedCollections.add(collectionName);
			for (const relation of this.schema.relations) if (relation.collection === collectionName && relation.related_collection) visitCollection(relation.related_collection);
			if (referencesOfCollections.has(collectionName)) orderedCollections.push(collectionName);
		};
		for (const collectionName of referencesOfCollections.keys()) visitCollection(collectionName);
		const reachableCollectionsOf = (collectionName) => {
			const reachedCollections = /* @__PURE__ */ new Set();
			const pendingCollections = [collectionName];
			while (pendingCollections.length > 0) {
				const currentCollection = pendingCollections.pop();
				for (const relation of this.schema.relations) if (relation.collection === currentCollection && relation.related_collection && !reachedCollections.has(relation.related_collection)) {
					reachedCollections.add(relation.related_collection);
					pendingCollections.push(relation.related_collection);
				}
			}
			return reachedCollections;
		};
		const reachableCollections = new Map(orderedCollections.map((name) => {
			return [name, reachableCollectionsOf(name)];
		}));
		const relationRankOf = (field) => {
			const relationIndex = relations.findIndex((relation) => relation.field === field);
			return a2oFields.has(field) ? relations.length + relationIndex : relationIndex;
		};
		const referencedCountOf = (collectionName) => {
			return orderedCollections.filter((otherName) => {
				return reachableCollections.get(collectionName).has(otherName) && !reachableCollections.get(otherName).has(collectionName);
			}).length;
		};
		const writtenCollections = [...orderedCollections].sort((left, right) => {
			return referencedCountOf(left) - referencedCountOf(right);
		});
		const upsertedKeyNamesOfCollections = /* @__PURE__ */ new Map();
		for (const collectionName of writtenCollections) {
			const cycleCollections = writtenCollections.filter((otherName) => {
				return otherName === collectionName || reachableCollections.get(collectionName).has(otherName) && reachableCollections.get(otherName).has(collectionName);
			});
			if (cycleCollections.length === 1) {
				await this.saveNestedReferences(collectionName, referencesOfCollections.get(collectionName).sort((left, right) => left.rowIndex - right.rowIndex), rowsResult, opts);
				continue;
			}
			if (cycleCollections.at(-1) !== collectionName) continue;
			const cycleReferences = cycleCollections.flatMap((cycleCollection) => {
				return referencesOfCollections.get(cycleCollection).map((reference) => ({
					cycleCollection,
					reference
				}));
			}).sort((left, right) => {
				return left.reference.rowIndex - right.reference.rowIndex || relationRankOf(left.reference.field) - relationRankOf(right.reference.field);
			});
			for (const { cycleCollection, reference } of cycleReferences) {
				const upsertedKeyNames = upsertedKeyNamesOfCollections.get(cycleCollection) ?? /* @__PURE__ */ new Set();
				upsertedKeyNamesOfCollections.set(cycleCollection, upsertedKeyNames);
				await this.saveNestedReferences(cycleCollection, [reference], rowsResult, opts, upsertedKeyNames);
			}
		}
		return rowsResult;
	}
	/**
	* Under preserveMutationOrder, cut the records into one upsert each time a
	* record holding only its key follows one holding fields, or the reverse:
	* a key alone is then read after the records sent before it are written.
	*/
	async saveNestedReferences(relatedCollection, references, rowsResult, opts, upsertedKeyNames = /* @__PURE__ */ new Set()) {
		if (resolveMutationBatching(opts ?? {}) !== "preserveMutationOrder") return this.saveNestedRecords(relatedCollection, references, rowsResult, opts, upsertedKeyNames);
		const relatedPrimaryKeyField = this.schema.collections[relatedCollection].primary;
		const holdsKeyOnly = ({ rowIndex, field }) => {
			const record = rowsResult.payloads[rowIndex][field];
			const recordFields = Object.keys(record);
			return recordFields.length === 1 && recordFields[0] === relatedPrimaryKeyField && !isMissingPrimaryKey(record[relatedPrimaryKeyField]);
		};
		let segmentReferences = [];
		for (const reference of references) {
			if (segmentReferences.length > 0 && holdsKeyOnly(segmentReferences[0]) !== holdsKeyOnly(reference)) {
				await this.saveNestedRecords(relatedCollection, segmentReferences, rowsResult, opts, upsertedKeyNames);
				segmentReferences = [];
			}
			segmentReferences.push(reference);
		}
		await this.saveNestedRecords(relatedCollection, segmentReferences, rowsResult, opts, upsertedKeyNames);
	}
	/**
	* Upsert the records several rows nest, all of one collection, and replace
	* each by its key in its row's payload. A record naming only the key of a
	* row that exists writes nothing. That key is compared by its spelling, as
	* in `upsertRun`: under a column storing another one (char(n) padding,
	* citext) it reads as no row, and creating it is refused as not unique.
	*
	* TODO(#610): the same under a MariaDB `_ci` collation.
	*/
	async saveNestedRecords(relatedCollection, references, rowsResult, opts, upsertedKeyNames = /* @__PURE__ */ new Set()) {
		const { getService } = await import("../utils/get-service.js");
		const service = getService(relatedCollection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema,
			nested: [...this.nested, references[0].field]
		});
		const relatedPrimaryKeyField = this.schema.collections[relatedCollection].primary;
		const keyOnlyOf = ({ rowIndex, field }) => {
			const record = rowsResult.payloads[rowIndex][field];
			const recordFields = Object.keys(record);
			const relatedPrimaryKey = record[relatedPrimaryKeyField];
			return recordFields.length === 1 && recordFields[0] === relatedPrimaryKeyField && !isMissingPrimaryKey(relatedPrimaryKey) ? relatedPrimaryKey : null;
		};
		const nestedUpdates = opts?.nestedUpdates ?? "apply";
		const checkedKeys = references.flatMap((reference) => {
			const relatedPrimaryKey = rowsResult.payloads[reference.rowIndex][reference.field][relatedPrimaryKeyField];
			if (nestedUpdates === "apply") return keyOnlyOf(reference) === null ? [] : [relatedPrimaryKey];
			return isMissingPrimaryKey(relatedPrimaryKey) ? [] : [relatedPrimaryKey];
		});
		validateKeys(this.schema, relatedCollection, relatedPrimaryKeyField, checkedKeys);
		const existingKeyNames = /* @__PURE__ */ new Set();
		for (const keyChunk of chunk(checkedKeys, RELATED_READ_CHUNK_SIZE)) {
			const existingRows = await this.knex.select(relatedPrimaryKeyField).from(relatedCollection).whereIn(relatedPrimaryKeyField, keyChunk);
			for (const existingRow of existingRows) existingKeyNames.add(primaryKeyNameOf(existingRow[relatedPrimaryKeyField], relatedCollection, this.schema));
		}
		const upsertReferences = references.filter(({ rowIndex, field }) => {
			const relatedPrimaryKey = rowsResult.payloads[rowIndex][field][relatedPrimaryKeyField];
			if (isMissingPrimaryKey(relatedPrimaryKey)) return true;
			const keyName = primaryKeyNameOf(relatedPrimaryKey, relatedCollection, this.schema);
			const namesExistingRow = existingKeyNames.has(keyName) || upsertedKeyNames.has(keyName);
			if (namesExistingRow && keyOnlyOf({
				rowIndex,
				field
			}) !== null) return false;
			if (namesExistingRow && nestedUpdates === "refuse") throw nestedUpdateRefusal(relatedPrimaryKey, relatedCollection);
			if (namesExistingRow && nestedUpdates === "skip") return false;
			upsertedKeyNames.add(keyName);
			return true;
		});
		const upsertReferenceSet = new Set(upsertReferences);
		for (const reference of references) {
			const payload = rowsResult.payloads[reference.rowIndex];
			if (!upsertReferenceSet.has(reference)) payload[reference.field] = payload[reference.field][relatedPrimaryKeyField];
		}
		if (upsertReferences.length === 0) return;
		const upsertedKeys = await service.upsertMany(upsertReferences.map(({ rowIndex, field }) => {
			return rowsResult.payloads[rowIndex][field];
		}), {
			refuseHookAddedRows: true,
			nestedOfPayloads: upsertReferences.map(({ field }) => {
				return [...this.nested, field];
			}),
			onRevisionCreate: (revision, item, recordIndex) => {
				if (recordIndex === void 0) throw new Error(`Revision ${JSON.stringify(revision)} of ${JSON.stringify(item)} in ${JSON.stringify(relatedCollection)} came from no nested record`);
				const { rowIndex } = upsertReferences[recordIndex];
				rowsResult.revisionsByParent[rowIndex].push(revision);
			},
			onRequireUserIntegrityCheck: (flags) => {
				rowsResult.userIntegrityCheckFlags |= flags;
			},
			bypassEmitAction: (params) => {
				return opts?.bypassEmitAction ? opts.bypassEmitAction(params) : rowsResult.nestedActionEvents.push(params);
			},
			emitEvents: opts?.emitEvents,
			mutationTracker: opts?.mutationTracker,
			mutationBatching: opts?.mutationBatching,
			nestedUpdates: opts?.nestedUpdates
		});
		for (const [recordIndex, upsertedKey] of upsertedKeys.entries()) {
			const { rowIndex, field } = upsertReferences[recordIndex];
			rowsResult.payloads[rowIndex][field] = upsertedKey;
		}
	}
	/**
	* Recursively save/update all nested related o2m items of several parent rows.
	*
	* Per relation, the lists of parents next to each other go through one
	* read of the existing children they name and one upsertMany; a deselect
	* runs only for the parents still holding a child their list leaves out,
	* once those lists are saved. A child two lists name ends on the last parent
	* naming it, and a child moving from one parent of the call to another is
	* not nullified on the way. An alterations object ({ create, update,
	* delete }) is applied for its parent in its place between the lists.
	*/
	async processO2M(parentRows, opts) {
		if (!Array.isArray(parentRows)) throw new Error(`processO2M takes the parent rows as [{ data, key }], got ${JSON.stringify(parentRows)}`);
		const revisionsByParent = parentRows.map(() => []);
		let userIntegrityCheckFlags = UserIntegrityCheckFlag.None;
		const nestedActionEvents = [];
		const nestedMutationOptions = {
			onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
			bypassEmitAction: (params) => {
				return opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params);
			},
			emitEvents: opts?.emitEvents,
			mutationTracker: opts?.mutationTracker,
			mutationBatching: opts?.mutationBatching,
			nestedUpdates: opts?.nestedUpdates
		};
		const relations = this.schema.relations.filter((relation) => {
			return relation.related_collection === this.collection;
		});
		const nestedUpdateSchema = Joi.object({
			create: Joi.array().items(Joi.object().unknown()),
			update: Joi.array().items(Joi.object().unknown()),
			delete: Joi.array().items(Joi.string(), Joi.number())
		});
		for (const relation of relations) {
			if (!relation.meta?.one_field) continue;
			const oneField = relation.meta.one_field;
			const parentRuns = [];
			for (const [parentIndex, parentRow] of parentRows.entries()) {
				if (!(oneField in parentRow.data)) continue;
				const field = parentRow.data[oneField];
				const listsChildren = !field || Array.isArray(field);
				const lastRun = parentRuns.at(-1);
				if (listsChildren && lastRun?.listsChildren) lastRun.parentIndexes.push(parentIndex);
				else parentRuns.push({
					listsChildren,
					parentIndexes: [parentIndex]
				});
			}
			if (parentRuns.length === 0) continue;
			const relatedPrimaryKeyField = this.schema.collections[relation.collection].primary;
			const { getService } = await import("../utils/get-service.js");
			const service = getService(relation.collection, {
				accountability: this.accountability,
				knex: this.knex,
				schema: this.schema,
				nested: [...this.nested, oneField]
			});
			for (const parentRun of parentRuns) {
				if (parentRun.listsChildren) {
					await this.saveO2MLists(relation, service, parentRun.parentIndexes.map((parentIndex$1) => parentRows[parentIndex$1]), parentRun.parentIndexes.map((parentIndex$1) => {
						return revisionsByParent[parentIndex$1];
					}), nestedMutationOptions);
					continue;
				}
				const parentIndex = parentRun.parentIndexes[0];
				const parent = parentRows[parentIndex].key;
				const field = parentRows[parentIndex].data[oneField];
				const revisions = revisionsByParent[parentIndex];
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
							if (record[sortField] === void 0) record[sortField] = highestOrderNumber?.max ? highestOrderNumber.max + index + 1 : index + 1;
							return {
								...record,
								[relation.field]: parent
							};
						});
					} else createPayload = alterations.create.map((item) => ({
						...item,
						[relation.field]: parent
					}));
					await service.createMany(createPayload, {
						onRevisionCreate: (pk) => revisions.push(pk),
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
						bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						emitEvents: opts?.emitEvents,
						mutationTracker: opts?.mutationTracker,
						mutationBatching: opts?.mutationBatching,
						nestedUpdates: opts?.nestedUpdates
					});
				}
				if (alterations.update) {
					const parentKeyName = primaryKeyNameOf(parent, this.collection, this.schema);
					const namesParent = (value) => {
						return value !== null && value !== void 0 && primaryKeyNameOf(value, this.collection, this.schema) === parentKeyName;
					};
					for (const item of alterations.update) {
						const { [relatedPrimaryKeyField]: key,...fields } = item;
						const existingRecord = await this.knex.select(relatedPrimaryKeyField, relation.field).from(relation.collection).where({ [relatedPrimaryKeyField]: key }).first();
						const updatesChild = Object.entries(fields).some(([field$1, value]) => {
							return field$1 !== relation.field || !namesParent(value);
						});
						if (existingRecord && updatesChild && opts?.nestedUpdates === "refuse") throw nestedUpdateRefusal(key, relation.collection);
						const record = opts?.nestedUpdates === "skip" || !updatesChild ? {} : fields;
						if (!existingRecord || !namesParent(existingRecord[relation.field])) record[relation.field] = parent;
						if (Object.keys(record).length === 0) continue;
						await service.updateOne(key, record, {
							onRevisionCreate: (pk) => revisions.push(pk),
							onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
							bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
							emitEvents: opts?.emitEvents,
							mutationTracker: opts?.mutationTracker,
							mutationBatching: opts?.mutationBatching,
							nestedUpdates: opts?.nestedUpdates
						});
					}
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
						mutationTracker: opts?.mutationTracker,
						mutationBatching: opts?.mutationBatching
					});
					else await service.updateByQuery(query, { [relation.field]: null }, {
						onRevisionCreate: (pk) => revisions.push(pk),
						onRequireUserIntegrityCheck: (flags) => userIntegrityCheckFlags |= flags,
						bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params),
						emitEvents: opts?.emitEvents,
						mutationTracker: opts?.mutationTracker,
						mutationBatching: opts?.mutationBatching
					});
				}
			}
		}
		return {
			revisionsByParent,
			nestedActionEvents,
			userIntegrityCheckFlags
		};
	}
	/**
	* Saves the O2M lists of several parents for one relation: what processO2M
	* does to a list, with one read and one upsertMany for every parent.
	*
	* The children a list names by their key are read once, then the parent
	* each holds is followed in JS through the lists in order, so a bare key
	* already on its parent is still skipped as the per-parent read skipped it.
	* Each revision goes to the parent whose list wrote its child; a child
	* two lists name gets its revisions in their order, and a revision of a row
	* no list names (a hook's) goes to the first parent.
	*/
	async saveO2MLists(relation, service, listedParents, revisionsOfParents, nestedMutationOptions) {
		const oneField = relation.meta.one_field;
		const relatedPrimaryKeyField = this.schema.collections[relation.collection].primary;
		const childKeyNameOf = (childKey) => {
			return primaryKeyNameOf(childKey, relation.collection, this.schema);
		};
		const parentKeyNameOf = (parentKey) => {
			return primaryKeyNameOf(parentKey, this.collection, this.schema);
		};
		const namesParent = (value, parent) => {
			return !isNil(value) && parentKeyNameOf(value) === parentKeyNameOf(parent);
		};
		const listsOfParents = listedParents.map((parentRow) => parentRow.data[oneField] || []);
		const namedChildKeys = listsOfParents.flat().flatMap((relatedRecord) => {
			const relatedId = isPrimaryKey(relatedRecord) ? relatedRecord : relatedRecord[relatedPrimaryKeyField];
			return isMissingPrimaryKey(relatedId) ? [] : [relatedId];
		});
		validateKeys(this.schema, relation.collection, relatedPrimaryKeyField, namedChildKeys);
		const existingChildren = /* @__PURE__ */ new Map();
		for (const keyChunk of chunk(namedChildKeys, RELATED_READ_CHUNK_SIZE)) {
			const existingRecords = await this.knex.select(relatedPrimaryKeyField, relation.field).from(relation.collection).whereIn(relatedPrimaryKeyField, keyChunk);
			for (const existingRecord of existingRecords) {
				const childKey = existingRecord[relatedPrimaryKeyField];
				existingChildren.set(childKeyNameOf(childKey), {
					childKey,
					heldParent: existingRecord[relation.field]
				});
			}
		}
		const recordsToUpsert = [];
		const parentOfRecord = [];
		const savedKeysOfParents = listedParents.map(() => []);
		for (const [parentIndex, updates] of listsOfParents.entries()) {
			const parent = listedParents[parentIndex].key;
			for (const relatedRecord of updates) {
				const relatedId = isPrimaryKey(relatedRecord) ? relatedRecord : relatedRecord[relatedPrimaryKeyField];
				let record = cloneDeep(relatedRecord);
				const relatedKeyName = isMissingPrimaryKey(relatedId) ? null : childKeyNameOf(relatedId);
				const existingRecord = relatedKeyName === null ? void 0 : existingChildren.get(relatedKeyName);
				const updatesChild = existingRecord !== void 0 && !isPrimaryKey(relatedRecord) && Object.entries(relatedRecord).some(([recordField, value]) => {
					return recordField !== relatedPrimaryKeyField && (recordField !== relation.field || !namesParent(value, parent));
				});
				if (updatesChild && nestedMutationOptions.nestedUpdates === "refuse") throw nestedUpdateRefusal(relatedId, relation.collection);
				if (isPrimaryKey(relatedRecord) || existingRecord !== void 0 && (!updatesChild || nestedMutationOptions.nestedUpdates === "skip")) {
					if (!existingRecord) throw new ForbiddenError({ reason: `Could not find a '${relation.collection}' record having the primary key ${relatedRecord} while processing O2M relation` });
					if (namesParent(existingRecord.heldParent, parent)) {
						savedKeysOfParents[parentIndex].push(existingRecord.childKey);
						continue;
					}
					record = { [relatedPrimaryKeyField]: relatedId };
				}
				if (!existingRecord || !namesParent(existingRecord.heldParent, parent)) record[relation.field] = parent;
				if (relatedKeyName !== null) existingChildren.set(relatedKeyName, {
					childKey: existingRecord?.childKey ?? relatedId,
					heldParent: relation.field in record ? record[relation.field] : existingRecord?.heldParent
				});
				recordsToUpsert.push(record);
				parentOfRecord.push(parentIndex);
			}
		}
		const writtenRevisions = [];
		const upsertedKeys = await service.upsertMany(recordsToUpsert, {
			...nestedMutationOptions,
			onRevisionCreate: (revision, item, recordIndex) => {
				if (isMissingPrimaryKey(item)) throw new Error(`Revision ${JSON.stringify(revision)} of ${JSON.stringify(relation.collection)} came without the key of its item: ${JSON.stringify(item)}`);
				writtenRevisions.push({
					revision,
					recordIndex
				});
			}
		});
		for (const [recordIndex, upsertedKey] of upsertedKeys.entries()) savedKeysOfParents[parentOfRecord[recordIndex]].push(upsertedKey);
		for (const { revision, recordIndex } of writtenRevisions) revisionsOfParents[recordIndex === void 0 ? 0 : parentOfRecord[recordIndex]].push(revision);
		const probesHeldChildren = listedParents.length > 1;
		const savedKeyNamesOfParents = /* @__PURE__ */ new Map();
		for (const [parentIndex, parentRow] of listedParents.entries()) savedKeyNamesOfParents.set(parentKeyNameOf(parentRow.key), new Set(savedKeysOfParents[parentIndex].flatMap((savedKey) => {
			return isPrimaryKey(savedKey) ? [childKeyNameOf(savedKey)] : [];
		})));
		const parentKeyNamesLeavingChildren = /* @__PURE__ */ new Set();
		const listedParentKeys = listedParents.map((parentRow) => parentRow.key);
		const probedKeyChunks = probesHeldChildren ? chunk(listedParentKeys, RELATED_READ_CHUNK_SIZE) : [];
		for (const keyChunk of probedKeyChunks) {
			const heldRecords = await this.knex.select(relatedPrimaryKeyField, relation.field).from(relation.collection).whereIn(relation.field, keyChunk);
			for (const heldRecord of heldRecords) {
				const parentKeyName = parentKeyNameOf(heldRecord[relation.field]);
				const heldKeyName = childKeyNameOf(heldRecord[relatedPrimaryKeyField]);
				if (!savedKeyNamesOfParents.get(parentKeyName)?.has(heldKeyName)) parentKeyNamesLeavingChildren.add(parentKeyName);
			}
		}
		for (const [parentIndex, parentRow] of listedParents.entries()) {
			const parentKeyName = parentKeyNameOf(parentRow.key);
			if (probesHeldChildren && !parentKeyNamesLeavingChildren.has(parentKeyName)) continue;
			const query = {
				filter: { _and: [{ [relation.field]: { _eq: parentRow.key } }, { [relatedPrimaryKeyField]: { _nin: savedKeysOfParents[parentIndex] } }] },
				limit: -1
			};
			if (relation.meta.one_deselect_action === "delete") await service.deleteByQuery(query, nestedMutationOptions);
			else await service.updateByQuery(query, { [relation.field]: null }, {
				...nestedMutationOptions,
				onRevisionCreate: (pk) => revisionsOfParents[parentIndex].push(pk)
			});
		}
	}
	/**
	* Transforms the input partial payload to match the output structure, to have consistency
	* between delta and data
	*/
	async prepareDelta(data) {
		let payload = cloneDeep(data);
		for (const key in payload) if (payload[key]?.isRawInstance) payload[key] = payload[key].bindings[0];
		payload = await this.processValues("read", payload);
		if (Object.keys(payload).length === 0) return null;
		return JSON.stringify(payload, (_key, fieldValue) => {
			return typeof fieldValue === "bigint" ? fieldValue.toString() : fieldValue;
		});
	}
};

//#endregion
export { PayloadService };