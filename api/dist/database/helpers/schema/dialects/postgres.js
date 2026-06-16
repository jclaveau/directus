import { getDefaultIndexName } from "../../../../utils/get-default-index-name.js";
import { SchemaHelper } from "../types.js";
import { useEnv } from "@directus/env";

//#region src/database/helpers/schema/dialects/postgres.ts
const env = useEnv();
var SchemaHelperPostgres = class extends SchemaHelper {
	generateIndexName(type, collection, fields) {
		return getDefaultIndexName(type, collection, fields, { maxLength: 63 });
	}
	async getDatabaseSize() {
		try {
			const result = await this.knex.select(this.knex.raw(`pg_database_size(?) as size;`, [env["DB_DATABASE"]]));
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
		if (options.attemptConcurrentIndex) return this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX CONCURRENTLY ?? ON ?? (??)`, [
			constraintName,
			collection,
			field
		]);
		return this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX ?? ON ?? (??)`, [
			constraintName,
			collection,
			field
		]);
	}
};

//#endregion
export { SchemaHelperPostgres };