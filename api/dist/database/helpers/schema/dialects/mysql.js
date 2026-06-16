import { getDefaultIndexName } from "../../../../utils/get-default-index-name.js";
import { SchemaHelper } from "../types.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";
import assert from "node:assert";

//#region src/database/helpers/schema/dialects/mysql.ts
const env = useEnv();
let lowerCaseTableNames;
var SchemaHelperMySQL = class extends SchemaHelper {
	generateIndexName(type, collection, fields) {
		return getDefaultIndexName(type, collection, fields, { maxLength: 64 });
	}
	async changePrimaryKey(table, to) {
		const primaryColumns = toArray(to);
		const placeholders = primaryColumns.map(() => "??").join(", ");
		assert(primaryColumns.length > 0, "At least 1 \"to\" column is required");
		assert(primaryColumns[0] && primaryColumns[0].length > 0, "\"to\" column cannot be empty");
		await this.knex.raw(`ALTER TABLE ?? DROP PRIMARY KEY, ADD PRIMARY KEY (${placeholders})`, [table, ...primaryColumns]);
	}
	async getDatabaseSize() {
		try {
			const result = await this.knex.sum("size AS size").from(this.knex.select(this.knex.raw("data_length + index_length AS size")).from("information_schema.TABLES").where("table_schema", "=", String(env["DB_DATABASE"])).as("size"));
			return result[0]?.["size"] ? Number(result[0]?.["size"]) : null;
		} catch {
			return null;
		}
	}
	addInnerSortFieldsToGroupBy(groupByFields, sortRecords, hasRelationalSort) {
		if (hasRelationalSort) groupByFields.push(...sortRecords.map(({ alias }) => alias));
	}
	async createIndex(collection, field, options = {}) {
		const isUnique = Boolean(options.unique);
		const constraintName = this.generateIndexName(isUnique ? "unique" : "index", collection, field);
		const blockingQuery = this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX ?? ON ?? (??)`, [
			constraintName,
			collection,
			field
		]);
		if (options.attemptConcurrentIndex) return this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX ?? ON ?? (??) ALGORITHM=INPLACE LOCK=NONE`, [
			constraintName,
			collection,
			field
		]).catch(() => blockingQuery);
		return blockingQuery;
	}
	async parseCollectionName(collection) {
		if (lowerCaseTableNames === void 0) {
			const result = await this.knex.raw("SELECT @@lower_case_table_names AS lctn");
			lowerCaseTableNames = Number(result[0]?.[0]?.lctn ?? 0);
		}
		if (lowerCaseTableNames === 1) return collection.toLowerCase();
		return collection;
	}
};

//#endregion
export { SchemaHelperMySQL };