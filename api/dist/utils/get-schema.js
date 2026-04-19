import { ALIAS_TYPES } from "../constants.js";
import { useBus } from "../bus/lib/use-bus.js";
import "../bus/index.js";
import { useLogger } from "../logger/index.js";
import { getMemorySchemaCache, setMemorySchemaCache } from "../cache.js";
import database_default from "../database/index.js";
import { useLock } from "../lock/lib/use-lock.js";
import "../lock/index.js";
import { RelationsService } from "../services/relations.js";
import getLocalType from "./get-local-type.js";
import getDefaultValue from "./get-default-value.js";
import { getSystemFieldRowsWithAuthProviders } from "./get-field-system-rows.js";
import { useEnv } from "@directus/env";
import { mapValues } from "lodash-es";
import { parseJSON, toArray as toArray$1 } from "@directus/utils";
import { createInspector } from "@directus/schema";
import { systemCollectionRows } from "@directus/system-data";

//#region src/utils/get-schema.ts
const logger = useLogger();
async function getSchema(options, attempt = 0) {
	const MAX_ATTEMPTS = 3;
	const env = useEnv();
	if (options?.bypassCache || env["CACHE_SCHEMA"] === false) {
		const database = options?.database || database_default();
		return await getDatabaseSchema(database, createInspector(database));
	}
	const cached = getMemorySchemaCache();
	if (cached) return cached;
	if (attempt >= MAX_ATTEMPTS) throw new Error(`Failed to get Schema information: hit infinite loop`);
	const lock = useLock();
	const bus = useBus();
	const lockKey = "schemaCache--preparing";
	const messageKey = "schemaCache--done";
	const processId = await lock.increment(lockKey);
	if (processId >= env["CACHE_SCHEMA_MAX_ITERATIONS"]) await lock.delete(lockKey);
	if (processId === 1 === false) {
		logger.trace("Schema cache is prepared in another process, waiting for result.");
		const timeout = new Promise((_, reject) => setTimeout(reject, env["CACHE_SCHEMA_SYNC_TIMEOUT"]));
		const subscription = new Promise((resolve, reject) => {
			bus.subscribe(messageKey, busListener).catch(reject);
			function busListener(options$1) {
				cleanup();
				if (options$1.schema === null) return reject();
				try {
					setMemorySchemaCache(options$1.schema);
					resolve(options$1.schema);
				} catch (e) {
					reject(e);
				}
			}
			function cleanup() {
				bus.unsubscribe(messageKey, busListener).catch(reject);
			}
		});
		return Promise.race([timeout, subscription]).catch(() => getSchema(options, attempt + 1));
	}
	let schema = null;
	try {
		const database = options?.database || database_default();
		schema = await getDatabaseSchema(database, createInspector(database));
		setMemorySchemaCache(schema);
		return schema;
	} finally {
		await bus.publish(messageKey, { schema });
		await lock.delete(lockKey);
	}
}
async function getDatabaseSchema(database, schemaInspector) {
	const env = useEnv();
	const result = {
		collections: {},
		relations: []
	};
	const systemFieldRows$1 = getSystemFieldRowsWithAuthProviders();
	const schemaOverview = await schemaInspector.overview();
	const collections = [...await database.select("collection", "singleton", "note", "sort_field", "accountability").from("directus_collections"), ...systemCollectionRows];
	for (const [collection, info] of Object.entries(schemaOverview)) {
		if (toArray$1(env["DB_EXCLUDE_TABLES"]).includes(collection)) {
			logger.trace(`Collection "${collection}" is configured to be excluded and will be ignored`);
			continue;
		}
		if (!info.primary) {
			logger.warn(`Collection "${collection}" doesn't have a primary key column and will be ignored`);
			continue;
		}
		if (collection.includes(" ")) {
			logger.warn(`Collection "${collection}" has a space in the name and will be ignored`);
			continue;
		}
		const collectionMeta = collections.find((collectionMeta$1) => collectionMeta$1.collection === collection);
		result.collections[collection] = {
			collection,
			primary: info.primary,
			singleton: collectionMeta?.singleton === true || collectionMeta?.singleton === "true" || collectionMeta?.singleton === 1,
			note: collectionMeta?.note || null,
			sortField: collectionMeta?.sort_field || null,
			accountability: collectionMeta ? collectionMeta.accountability : "all",
			fields: mapValues(schemaOverview[collection]?.columns, (column) => {
				return {
					field: column.column_name,
					defaultValue: getDefaultValue(column) ?? null,
					nullable: column.is_nullable ?? true,
					generated: column.is_generated ?? false,
					type: getLocalType(column),
					dbType: column.data_type,
					precision: column.numeric_precision || null,
					scale: column.numeric_scale || null,
					special: [],
					note: null,
					validation: null,
					alias: false
				};
			})
		};
	}
	const fields = [...await database.select("id", "collection", "field", "special", "note", "validation").from("directus_fields"), ...systemFieldRows$1].filter((field) => (field.special ? toArray$1(field.special) : []).includes("no-data") === false);
	for (const field of fields) {
		if (!result.collections[field.collection]) continue;
		const existing = result.collections[field.collection]?.fields[field.field];
		const column = schemaOverview[field.collection]?.columns[field.field];
		const special = field.special ? toArray$1(field.special) : [];
		if (ALIAS_TYPES.some((type$1) => special.includes(type$1)) === false && !existing) continue;
		const type = existing && getLocalType(column, { special }) || "alias";
		let validation = field.validation ?? null;
		if (validation && typeof validation === "string") validation = parseJSON(validation);
		result.collections[field.collection].fields[field.field] = {
			field: field.field,
			defaultValue: existing?.defaultValue ?? null,
			nullable: existing?.nullable ?? true,
			generated: existing?.generated ?? false,
			type,
			dbType: existing?.dbType || null,
			precision: existing?.precision || null,
			scale: existing?.scale || null,
			special,
			note: field.note,
			alias: existing?.alias ?? true,
			validation: validation ?? null
		};
	}
	result.relations = await new RelationsService({
		knex: database,
		schema: result
	}).readAll(void 0, void 0, true);
	return result;
}

//#endregion
export { getSchema };