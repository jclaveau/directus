import { ALIAS_TYPES, ALLOWED_DB_DEFAULT_FUNCTIONS } from "../constants.js";
import { clearSystemCache, getCache, getCacheValue, setCacheValue } from "../cache.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default, { getSchemaInspector } from "../database/index.js";
import emitter_default from "../emitter.js";
import { fetchPolicies } from "../permissions/lib/fetch-policies.js";
import { fetchPermissions } from "../permissions/lib/fetch-permissions.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { throwDatabaseError } from "../database/errors/translate.js";
import { PayloadService } from "./payload.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { transaction } from "../utils/transaction.js";
import { ItemsService } from "./items.js";
import { RelationsService } from "./relations.js";
import getLocalType from "../utils/get-local-type.js";
import getDefaultValue from "../utils/get-default-value.js";
import { getSystemFieldRowsWithAuthProviders } from "../utils/get-field-system-rows.js";
import { getSchema } from "../utils/get-schema.js";
import { sanitizeColumn } from "../utils/sanitize-schema.js";
import { buildCollectionAndFieldRelations } from "./fields/build-collection-and-field-relations.js";
import { getCollectionMetaUpdates } from "./fields/get-collection-meta-updates.js";
import { getCollectionRelationList } from "./fields/get-collection-relation-list.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { isEqual, isNil, merge } from "lodash-es";
import { addFieldFlag, getRelations, toArray as toArray$1 } from "@directus/utils";
import { createInspector } from "@directus/schema";
import { DEFAULT_NUMERIC_PRECISION, DEFAULT_NUMERIC_SCALE, KNEX_TYPES, REGEX_BETWEEN_PARENS } from "@directus/constants";

//#region src/services/fields.ts
const systemFieldRows = getSystemFieldRowsWithAuthProviders();
const env = useEnv();
var FieldsService = class FieldsService {
	knex;
	helpers;
	accountability;
	itemsService;
	payloadService;
	schemaInspector;
	schema;
	cache;
	systemCache;
	schemaCache;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.helpers = getHelpers(this.knex);
		this.schemaInspector = options.knex ? createInspector(options.knex) : getSchemaInspector();
		this.accountability = options.accountability || null;
		this.itemsService = new ItemsService("directus_fields", options);
		this.payloadService = new PayloadService("directus_fields", options);
		this.schema = options.schema;
		const { cache, systemCache, localSchemaCache } = getCache();
		this.cache = cache;
		this.systemCache = systemCache;
		this.schemaCache = localSchemaCache;
	}
	async columnInfo(collection, field) {
		const schemaCacheIsEnabled = Boolean(env["CACHE_SCHEMA"]);
		let columnInfo = null;
		if (schemaCacheIsEnabled) columnInfo = await getCacheValue(this.schemaCache, "columnInfo");
		if (!columnInfo) {
			columnInfo = await this.schemaInspector.columnInfo();
			if (schemaCacheIsEnabled) await setCacheValue(this.schemaCache, "columnInfo", columnInfo);
		}
		if (collection) columnInfo = columnInfo.filter((column) => column.table === collection);
		if (field) return columnInfo.find((column) => column.name === field);
		return columnInfo;
	}
	async readAll(collection) {
		let fields;
		if (this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "read",
			collection: "directus_fields"
		}, {
			schema: this.schema,
			knex: this.knex
		});
		const nonAuthorizedItemsService = new ItemsService("directus_fields", {
			knex: this.knex,
			schema: this.schema
		});
		if (collection) {
			fields = await nonAuthorizedItemsService.readByQuery({
				filter: { collection: { _eq: collection } },
				limit: -1
			});
			fields.push(...systemFieldRows.filter((fieldMeta) => fieldMeta.collection === collection));
		} else {
			fields = await nonAuthorizedItemsService.readByQuery({ limit: -1 });
			fields.push(...systemFieldRows);
		}
		const columnsWithSystem = (await this.columnInfo(collection)).map((column) => ({
			...column,
			default_value: getDefaultValue(column, fields.find((field) => field.collection === column.table && field.field === column.name))
		})).map((column) => {
			const field = fields.find((field$1) => {
				return field$1.field === column.name && field$1.collection === column.table;
			});
			const type = getLocalType(column, field);
			return {
				collection: column.table,
				field: column.name,
				type,
				schema: column,
				meta: field || null
			};
		});
		const aliasQuery = this.knex.select("*").from("directus_fields");
		if (collection) aliasQuery.andWhere("collection", collection);
		let aliasFields = [...await this.payloadService.processValues("read", await aliasQuery)];
		if (collection) aliasFields.push(...systemFieldRows.filter((fieldMeta) => fieldMeta.collection === collection));
		else aliasFields.push(...systemFieldRows);
		aliasFields = aliasFields.filter((field) => {
			const specials = toArray$1(field.special);
			for (const type of ALIAS_TYPES) if (specials.includes(type)) return true;
			return false;
		});
		const aliasFieldsAsField = aliasFields.map((field) => {
			const type = getLocalType(void 0, field);
			return {
				collection: field.collection,
				field: field.field,
				type,
				schema: null,
				meta: field
			};
		});
		const knownCollections = Object.keys(this.schema.collections);
		const result = [...columnsWithSystem, ...aliasFieldsAsField].filter((field) => knownCollections.includes(field.collection));
		if (this.accountability && this.accountability.admin !== true) {
			const policies = await fetchPolicies(this.accountability, {
				knex: this.knex,
				schema: this.schema
			});
			const permissions = await fetchPermissions(collection ? {
				action: "read",
				policies,
				collections: [collection],
				accountability: this.accountability
			} : {
				action: "read",
				policies,
				accountability: this.accountability
			}, {
				knex: this.knex,
				schema: this.schema
			});
			const allowedFieldsInCollection = {};
			permissions.forEach((permission) => {
				if (!allowedFieldsInCollection[permission.collection]) allowedFieldsInCollection[permission.collection] = /* @__PURE__ */ new Set();
				for (const field of permission.fields ?? []) allowedFieldsInCollection[permission.collection].add(field);
			});
			if (collection && collection in allowedFieldsInCollection === false) throw new ForbiddenError({
				reason: `'${this.accountability.user}' does not have permission to read fields from '${collection}'.`,
				values: {
					accountability: this.accountability,
					collection
				}
			});
			return result.filter((field) => {
				if (field.collection in allowedFieldsInCollection === false) return false;
				const allowedFields = allowedFieldsInCollection[field.collection];
				if (allowedFields.has("*")) return true;
				return allowedFields.has(field.field);
			});
		}
		for (const field of result) {
			if (field.meta?.special?.includes("cast-timestamp")) field.type = "timestamp";
			else if (field.meta?.special?.includes("cast-datetime")) field.type = "dateTime";
			field.type = this.helpers.schema.processFieldType(field);
		}
		return result;
	}
	async readOne(collection, field) {
		if (this.accountability && this.accountability.admin !== true) {
			await validateAccess({
				accountability: this.accountability,
				action: "read",
				collection
			}, {
				schema: this.schema,
				knex: this.knex
			});
			const permissions = await fetchPermissions({
				action: "read",
				policies: await fetchPolicies(this.accountability, {
					knex: this.knex,
					schema: this.schema
				}),
				collections: [collection],
				accountability: this.accountability
			}, {
				knex: this.knex,
				schema: this.schema
			});
			let hasAccess = false;
			for (const permission of permissions) if (permission.fields) {
				if (permission.fields.includes("*") || permission.fields.includes(field)) {
					hasAccess = true;
					break;
				}
			}
			if (!hasAccess) throw new ForbiddenError({
				reason: `'${this.accountability.user}' does not have permission to read '${collection}.${field}'`,
				values: {
					accountability: this.accountability,
					collection,
					field
				}
			});
		}
		let column = void 0;
		let fieldInfo = await this.knex.select("*").from("directus_fields").where({
			collection,
			field
		}).first();
		if (fieldInfo) fieldInfo = await this.payloadService.processValues("read", fieldInfo);
		fieldInfo = fieldInfo || systemFieldRows.find((fieldMeta) => fieldMeta.collection === collection && fieldMeta.field === field);
		try {
			column = await this.columnInfo(collection, field);
		} catch {}
		if (!column && !fieldInfo) throw new ForbiddenError({
			reason: `Can't retrieve the schema info for the column '${field}' of '${collection}'`,
			values: {
				accountability: this.accountability,
				collection,
				field
			}
		});
		const type = getLocalType(column, fieldInfo);
		const columnWithCastDefaultValue = column ? {
			...column,
			default_value: getDefaultValue(column, fieldInfo)
		} : null;
		return {
			collection,
			field,
			type,
			meta: fieldInfo || null,
			schema: type === "alias" ? null : columnWithCastDefaultValue
		};
	}
	async createField(collection, field, table, opts) {
		if (this.accountability && this.accountability.admin !== true) throw new ForbiddenError({
			reason: `'${this.accountability.user}' does not have the permission to create the field '${field}' in '${collection}'`,
			values: {
				accountability: this.accountability,
				collection,
				field
			}
		});
		const runPostColumnChange = await this.helpers.schema.preColumnChange();
		const nestedActionEvents = [];
		try {
			if (field.field in this.schema.collections[collection].fields || isNil(await this.knex.select("id").from("directus_fields").where({
				collection,
				field: field.field
			}).first()) === false) throw new InvalidPayloadError({ reason: `Field "${field.field}" already exists in collection "${collection}"` });
			const flagToAdd = this.helpers.date.fieldFlagForField(field.type);
			if (flagToAdd) addFieldFlag(field, flagToAdd);
			await transaction(this.knex, async (trx) => {
				const itemsService = new ItemsService("directus_fields", {
					knex: trx,
					accountability: this.accountability,
					schema: this.schema
				});
				const hookAdjustedField = opts?.emitEvents !== false ? await emitter_default.emitFilter(`fields.create`, field, { collection }, {
					database: trx,
					schema: this.schema,
					accountability: this.accountability
				}) : field;
				if (hookAdjustedField.type && ALIAS_TYPES.includes(hookAdjustedField.type) === false) try {
					const existingIndexes = await this.listExistingIndexes(trx);
					if (table) this.addColumnToTable(table, collection, hookAdjustedField, null, existingIndexes);
					else await trx.schema.alterTable(collection, async (table$1) => {
						this.addColumnToTable(table$1, collection, hookAdjustedField, null, existingIndexes);
					});
				} catch (err) {
					await throwDatabaseError(err, {
						collection,
						field
					});
				}
				if (hookAdjustedField.meta) {
					const existingSortRecord = await trx.from("directus_fields").where(hookAdjustedField.meta?.group ? {
						collection,
						group: hookAdjustedField.meta.group
					} : { collection }).max("sort", { as: "max" }).first();
					const newSortValue = existingSortRecord?.max ? existingSortRecord.max + 1 : 1;
					await itemsService.createOne({
						...merge({ sort: newSortValue }, hookAdjustedField.meta),
						collection,
						field: hookAdjustedField.field
					}, { emitEvents: false });
				}
				const actionEvent = {
					event: "fields.create",
					meta: {
						payload: hookAdjustedField,
						key: hookAdjustedField.field,
						collection
					},
					context: {
						database: database_default(),
						schema: this.schema,
						accountability: this.accountability
					}
				};
				if (opts?.bypassEmitAction) opts.bypassEmitAction(actionEvent);
				else nestedActionEvents.push(actionEvent);
			});
		} finally {
			if (runPostColumnChange) await this.helpers.schema.postColumnChange();
			if (shouldClearCache(this.cache, opts)) await this.cache.clear();
			if (opts?.autoPurgeSystemCache !== false) await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema();
				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}
	async updateField(collection, field, opts) {
		if (this.accountability && this.accountability.admin !== true) throw new ForbiddenError({
			reason: `'${this.accountability.user}' does not have the permission to update the field '${field}' in '${collection}'`,
			values: {
				accountability: this.accountability,
				collection,
				field
			}
		});
		const runPostColumnChange = await this.helpers.schema.preColumnChange();
		const nestedActionEvents = [];
		if (field.schema && !field.type) {
			const existingType = this.schema.collections[collection]?.fields[field.field]?.type;
			if (existingType) field.type = existingType;
		}
		try {
			const hookAdjustedField = opts?.emitEvents !== false ? await emitter_default.emitFilter(`fields.update`, field, {
				keys: [field.field],
				collection
			}, {
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability
			}) : field;
			const record = field.meta ? await this.knex.select("id").from("directus_fields").where({
				collection,
				field: field.field
			}).first() : null;
			if (hookAdjustedField.type && (hookAdjustedField.type === "alias" || this.schema.collections[collection].fields[field.field]?.type === "alias") && hookAdjustedField.type !== (this.schema.collections[collection].fields[field.field]?.type ?? "alias")) throw new InvalidPayloadError({ reason: "Alias type cannot be changed" });
			if (hookAdjustedField.schema) {
				const existingColumn = await this.columnInfo(collection, hookAdjustedField.field);
				if (existingColumn.is_primary_key) {
					if (hookAdjustedField.schema?.is_nullable === true) throw new InvalidPayloadError({ reason: "Primary key cannot be null" });
				}
				if (!isEqual(opts?.bypassLimits && opts.autoPurgeSystemCache === false ? sanitizeColumn(existingColumn) : existingColumn, hookAdjustedField.schema)) try {
					await transaction(this.knex, async (trx) => {
						const existingIndexes = await this.listExistingIndexes(trx);
						await trx.schema.alterTable(collection, async (table) => {
							if (!hookAdjustedField.schema) return;
							this.addColumnToTable(table, collection, field, existingColumn, existingIndexes);
						});
					});
				} catch (err) {
					await throwDatabaseError(err, {
						collection,
						field,
						existingColumn
					});
				}
			}
			if (hookAdjustedField.meta) if (record) await this.itemsService.updateOne(record.id, {
				...hookAdjustedField.meta,
				collection,
				field: hookAdjustedField.field
			}, { emitEvents: false });
			else await this.itemsService.createOne({
				...hookAdjustedField.meta,
				collection,
				field: hookAdjustedField.field
			}, { emitEvents: false });
			const actionEvent = {
				event: "fields.update",
				meta: {
					payload: hookAdjustedField,
					keys: [hookAdjustedField.field],
					collection
				},
				context: {
					database: database_default(),
					schema: this.schema,
					accountability: this.accountability
				}
			};
			if (opts?.bypassEmitAction) opts.bypassEmitAction(actionEvent);
			else nestedActionEvents.push(actionEvent);
			return field.field;
		} finally {
			if (runPostColumnChange) await this.helpers.schema.postColumnChange();
			if (shouldClearCache(this.cache, opts)) await this.cache.clear();
			if (opts?.autoPurgeSystemCache !== false) await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema();
				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}
	async updateFields(collection, fields, opts) {
		const nestedActionEvents = [];
		try {
			const fieldNames = [];
			for (const field of fields) fieldNames.push(await this.updateField(collection, field, {
				autoPurgeCache: false,
				autoPurgeSystemCache: false,
				bypassEmitAction: (params) => nestedActionEvents.push(params)
			}));
			return fieldNames;
		} finally {
			if (shouldClearCache(this.cache, opts)) await this.cache.clear();
			if (opts?.autoPurgeSystemCache !== false) await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema();
				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}
	async deleteField(collection, field, opts) {
		if (this.accountability && this.accountability.admin !== true) throw new ForbiddenError({
			reason: `'${this.accountability.user}' does not have the permission to delete the field '${field}' in '${collection}'`,
			values: {
				accountability: this.accountability,
				collection,
				field
			}
		});
		const runPostColumnChange = await this.helpers.schema.preColumnChange();
		const nestedActionEvents = [];
		try {
			if (opts?.emitEvents !== false) await emitter_default.emitFilter("fields.delete", [field], { collection }, {
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability
			});
			await transaction(this.knex, async (trx) => {
				const relations = getRelations(this.schema.relations, collection, field);
				const relationsService = new RelationsService({
					knex: trx,
					accountability: this.accountability,
					schema: this.schema
				});
				const fieldsService = new FieldsService({
					knex: trx,
					accountability: this.accountability,
					schema: this.schema
				});
				for (const relation of relations) {
					const isM2O = relation.collection === collection && relation.field === field;
					if (isM2O) {
						await relationsService.deleteOne(collection, field, {
							autoPurgeSystemCache: false,
							bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params)
						});
						if (relation.related_collection && relation.meta?.one_field && relation.related_collection !== collection && relation.meta.one_field !== field) await fieldsService.deleteField(relation.related_collection, relation.meta.one_field, {
							autoPurgeCache: false,
							autoPurgeSystemCache: false,
							bypassEmitAction: (params) => opts?.bypassEmitAction ? opts.bypassEmitAction(params) : nestedActionEvents.push(params)
						});
					}
					if (!isM2O && relation.meta?.one_field) await trx("directus_relations").update({ one_field: null }).where({
						many_collection: relation.collection,
						many_field: relation.field
					});
				}
				if (this.schema.collections[collection] && field in this.schema.collections[collection].fields && this.schema.collections[collection].fields[field].alias === false) await trx.schema.table(collection, (table) => {
					table.dropColumn(field);
				});
				const { collectionRelationTree, fieldToCollectionList } = await buildCollectionAndFieldRelations(this.schema.relations);
				const collectionRelationList = getCollectionRelationList(collection, collectionRelationTree);
				const collectionMetaQuery = trx.queryBuilder().select("collection", "archive_field", "sort_field", "item_duplication_fields").from("directus_collections").where({ collection });
				if (collectionRelationList.size !== 0) collectionMetaQuery.orWhere(function() {
					this.whereIn("collection", Array.from(collectionRelationList)).whereNotNull("item_duplication_fields");
				});
				const collectionMetaUpdates = getCollectionMetaUpdates(collection, field, await collectionMetaQuery, this.schema.collections, fieldToCollectionList);
				for (const meta of collectionMetaUpdates) await trx("directus_collections").update(meta.updates).where({ collection: meta.collection });
				const metaRow = await trx.select("collection", "field").from("directus_fields").where({
					collection,
					field
				}).first();
				if (metaRow) await trx("directus_fields").update({ group: null }).where({
					group: metaRow.field,
					collection: metaRow.collection
				});
				await new ItemsService("directus_fields", {
					knex: trx,
					accountability: this.accountability,
					schema: this.schema
				}).deleteByQuery({ filter: {
					collection: { _eq: collection },
					field: { _eq: field }
				} }, { emitEvents: false });
			});
			const actionEvent = {
				event: "fields.delete",
				meta: {
					payload: [field],
					collection
				},
				context: {
					database: this.knex,
					schema: this.schema,
					accountability: this.accountability
				}
			};
			if (opts?.bypassEmitAction) opts.bypassEmitAction(actionEvent);
			else nestedActionEvents.push(actionEvent);
		} finally {
			if (runPostColumnChange) await this.helpers.schema.postColumnChange();
			if (shouldClearCache(this.cache, opts)) await this.cache.clear();
			if (opts?.autoPurgeSystemCache !== false) await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
			if (opts?.emitEvents !== false && nestedActionEvents.length > 0) {
				const updatedSchema = await getSchema();
				for (const nestedActionEvent of nestedActionEvents) {
					nestedActionEvent.context.schema = updatedSchema;
					emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
				}
			}
		}
	}
	async listExistingIndexes(trx) {
		return (this.knex.client.config.client === "postgres" ? await trx.raw(`
			select
					t.relname as table,
					a.attname as column
					i.relname as index,
			from
					pg_class t,
					pg_class i,
					pg_index ix,
					pg_attribute a
			where
					t.oid = ix.indrelid
					and i.oid = ix.indexrelid
					and a.attrelid = t.oid
					and a.attnum = ANY(ix.indkey)
					and t.relkind = 'r'
				-- and t.relname like 'mytable'
			order by
					t.relname,
					i.relname;
		`) : []).rows;
	}
	addColumnToTable(table, collection, field, existing = null, existingIndexes = []) {
		let column;
		if (field.type === "alias" || field.type === "unknown") return;
		if (field.schema?.has_auto_increment) if (field.type === "bigInteger") column = table.bigIncrements(field.field);
		else column = table.increments(field.field);
		else if (field.type === "string") column = table.string(field.field, field.schema?.max_length ?? existing?.max_length ?? void 0);
		else if (["float", "decimal"].includes(field.type)) column = table[field.type](field.field, field.schema?.numeric_precision ?? existing?.numeric_precision ?? DEFAULT_NUMERIC_PRECISION, field.schema?.numeric_scale ?? existing?.numeric_scale ?? DEFAULT_NUMERIC_SCALE);
		else if (field.type === "csv") column = table.text(field.field);
		else if (field.type === "hash") column = table.string(field.field, 255);
		else if (field.type === "dateTime") column = table.dateTime(field.field, { useTz: false });
		else if (field.type === "timestamp") column = table.timestamp(field.field, { useTz: true });
		else if (field.type.startsWith("geometry")) column = this.helpers.st.createColumn(table, field);
		else if (KNEX_TYPES.includes(field.type)) column = table[field.type](field.field);
		else throw new InvalidPayloadError({ reason: `Illegal type passed: "${field.type}"` });
		/**
		* The column nullability must be set on every alter or it will be dropped
		* This is due to column.alter() not being incremental per https://knexjs.org/guide/schema-builder.html#alter
		*/
		this.helpers.schema.setNullable(column, field, existing);
		/**
		* The default value must be set on every alter or it will be dropped
		* This is due to column.alter() not being incremental per https://knexjs.org/guide/schema-builder.html#alter
		*/
		const defaultValue = field.schema?.default_value !== void 0 ? field.schema?.default_value : existing?.default_value;
		if (defaultValue !== void 0) {
			const newDefaultValueIsString = typeof defaultValue === "string";
			const newDefaultIsSetToCurrentTime = newDefaultValueIsString && defaultValue.toLowerCase() === "now()" || newDefaultValueIsString && defaultValue === "CURRENT_TIMESTAMP";
			const newDefaultIsAFunction = newDefaultValueIsString && ALLOWED_DB_DEFAULT_FUNCTIONS.includes(defaultValue);
			const newDefaultIsTimestampWithPrecision = newDefaultValueIsString && defaultValue.includes("CURRENT_TIMESTAMP(") && defaultValue.includes(")");
			if (newDefaultIsSetToCurrentTime) column.defaultTo(this.knex.fn.now());
			else if (newDefaultIsTimestampWithPrecision) {
				const precision = defaultValue.match(REGEX_BETWEEN_PARENS)[1];
				column.defaultTo(this.knex.fn.now(Number(precision)));
			} else if (newDefaultIsAFunction) column.defaultTo(this.knex.raw(defaultValue));
			else column.defaultTo(defaultValue);
		}
		if (field.schema?.is_primary_key) column.primary().notNullable();
		else if (!existing?.is_primary_key) {
			if (field.schema?.is_unique === true) {
				if (!existing || existing.is_unique === false) column.unique({ indexName: this.helpers.schema.generateIndexName("unique", collection, field.field) });
			} else if (field.schema?.is_unique === false) {
				if (existing?.is_unique === true) table.dropUnique([field.field], this.helpers.schema.generateIndexName("unique", collection, field.field));
			}
			if (field.schema?.is_indexed === true) {
				if (!existing || existing.is_indexed === false) column.index(this.helpers.schema.generateIndexName("index", collection, field.field));
			} else if (field.schema?.is_indexed === false) {
				if (existing?.is_indexed === true) {
					const indexName = this.helpers.schema.generateIndexName("index", collection, field.field);
					if (existingIndexes.find((row) => {
						return row["index"] === indexName;
					})) table.dropIndex([field.field], indexName);
					else console.log(`Index '${indexName}' not found so not dropped`);
				}
			}
		}
		if (existing) column.alter();
	}
};

//#endregion
export { FieldsService };