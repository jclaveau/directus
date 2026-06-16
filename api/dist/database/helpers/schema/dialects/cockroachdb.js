import { SchemaHelper } from "../types.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";
import "knex";
import assert from "node:assert";

//#region src/database/helpers/schema/dialects/cockroachdb.ts
const env = useEnv();
var SchemaHelperCockroachDb = class extends SchemaHelper {
	async changeToType(table, column, type, options = {}) {
		await this.changeToTypeByCopy(table, column, type, options);
	}
	constraintName(existingName) {
		const suffix = "_replaced";
		if (existingName.endsWith(suffix)) return existingName.substring(0, existingName.length - 9);
		else return existingName + suffix;
	}
	async changePrimaryKey(table, to) {
		const primaryColumns = toArray(to);
		const placeholders = primaryColumns.map(() => "??").join(", ");
		assert(primaryColumns.length > 0, "At least 1 \"to\" column is required");
		assert(primaryColumns[0] && primaryColumns[0].length > 0, "\"to\" column cannot be empty");
		await this.knex.raw(`ALTER TABLE ?? DROP CONSTRAINT ?? , ADD CONSTRAINT ?? PRIMARY KEY (${placeholders})`, [
			table,
			`${table}_pkey`,
			`${table}_pkey`,
			...primaryColumns
		]);
	}
	async getDatabaseSize() {
		try {
			const result = await this.knex.select(this.knex.raw("round(SUM(range_size_mb) * 1024 * 1024, 0) AS size")).from(this.knex.raw("[SHOW RANGES FROM database ??]", [env["DB_DATABASE"]]));
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
export { SchemaHelperCockroachDb };