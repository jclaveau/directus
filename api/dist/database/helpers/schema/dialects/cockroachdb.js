import { SchemaHelper } from "../types.js";
import { useEnv } from "@directus/env";

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
};

//#endregion
export { SchemaHelperCockroachDb };