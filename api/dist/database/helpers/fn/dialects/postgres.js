import { buildPostgresJsonPath } from "../json/postgres-json-path.js";
import { FnHelper } from "../types.js";
import { InvalidQueryError } from "@directus/errors";

//#region src/database/helpers/fn/dialects/postgres.ts
const parseLocaltime = (columnType) => {
	if (columnType === "timestamp") return ` AT TIME ZONE 'UTC'`;
	return "";
};
var FnHelperPostgres = class extends FnHelper {
	year(table, column, options) {
		return this.knex.raw(`EXTRACT(YEAR FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	month(table, column, options) {
		return this.knex.raw(`EXTRACT(MONTH FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	week(table, column, options) {
		return this.knex.raw(`EXTRACT(WEEK FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	day(table, column, options) {
		return this.knex.raw(`EXTRACT(DAY FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	weekday(table, column, options) {
		return this.knex.raw(`EXTRACT(DOW FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	hour(table, column, options) {
		return this.knex.raw(`EXTRACT(HOUR FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	minute(table, column, options) {
		return this.knex.raw(`EXTRACT(MINUTE FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	second(table, column, options) {
		return this.knex.raw(`EXTRACT(SECOND FROM ??.??${parseLocaltime(options?.type)})`, [table, column]);
	}
	count(table, column, options) {
		const collectionName = options?.originalCollectionName || table;
		const type = this.schema.collections?.[collectionName]?.fields?.[column]?.type ?? "unknown";
		if (type === "json") {
			const { dbType } = this.schema.collections[table].fields[column];
			return this.knex.raw(dbType === "jsonb" ? "jsonb_array_length(??.??)" : "json_array_length(??.??)", [table, column]);
		}
		if (type === "alias") return this._relationalCount(table, column, options);
		throw new Error(`Couldn't extract type from ${table}.${column}`);
	}
	parseJsonResult(value) {
		return value;
	}
	json(table, column, options) {
		const collectionName = options?.originalCollectionName || table;
		const fieldSchema = this.schema.collections?.[collectionName]?.fields?.[column];
		if (!fieldSchema || fieldSchema.type !== "json" || !options?.jsonPath) throw new InvalidQueryError({ reason: `${collectionName}.${column} is not a JSON field` });
		const { template, bindings } = buildPostgresJsonPath(options.jsonPath, { asText: options.jsonReturnType !== void 0 });
		const cast = fieldSchema.dbType === "jsonb" ? "jsonb" : "json";
		if (options.jsonReturnType === "numeric") return this.knex.raw(`(??::${cast}${template})::numeric`, [table + "." + column, ...bindings]);
		return this.knex.raw(`??::${cast}${template}`, [table + "." + column, ...bindings]);
	}
};

//#endregion
export { FnHelperPostgres };