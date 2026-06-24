import { getDefaultIndexName } from "../../../../utils/get-default-index-name.js";
import { SchemaHelper } from "../types.js";
import { prepQueryParams } from "../utils/prep-query-params.js";

//#region src/database/helpers/schema/dialects/mssql.ts
var SchemaHelperMSSQL = class extends SchemaHelper {
	generateIndexName(type, collection, fields) {
		return getDefaultIndexName(type, collection, fields, { maxLength: 128 });
	}
	applyLimit(rootQuery, limit) {
		if (limit === -1) rootQuery.limit(Number.MAX_SAFE_INTEGER);
		else rootQuery.limit(limit);
	}
	applyOffset(rootQuery, offset) {
		rootQuery.offset(offset);
		rootQuery.orderBy(1);
	}
	formatUUID(uuid) {
		return uuid.toUpperCase();
	}
	async getDatabaseSize() {
		try {
			const result = await this.knex.raw("SELECT SUM(size) * 8192 AS size FROM sys.database_files;");
			return result[0]?.["size"] ? Number(result[0]?.["size"]) : null;
		} catch {
			return null;
		}
	}
	prepQueryParams(queryParams) {
		return prepQueryParams(queryParams, { format: (index) => `@p${index}` });
	}
	addInnerSortFieldsToGroupBy(groupByFields, sortRecords, _hasRelationalSort) {
		if (sortRecords.length > 0) groupByFields.push(...sortRecords.map(({ column }) => column));
	}
	getColumnNameMaxLength() {
		return 128;
	}
	getTableNameMaxLength() {
		return 128;
	}
	async createIndex(collection, field, options = {}) {
		const isUnique = Boolean(options.unique);
		const constraintName = this.generateIndexName(isUnique ? "unique" : "index", collection, field);
		const edition = await this.knex.raw(`SELECT SERVERPROPERTY('edition') AS edition`).then((data) => data?.[0]?.["edition"]);
		if (options.attemptConcurrentIndex && typeof edition === "string" && edition.startsWith("Enterprise")) return this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX ?? ON ?? (??) WITH (ONLINE = ON)`, [
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
export { SchemaHelperMSSQL };