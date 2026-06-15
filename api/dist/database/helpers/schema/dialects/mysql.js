import { getDefaultIndexName } from "../../../../utils/get-default-index-name.js";
import { SchemaHelper } from "../types.js";
import { useEnv } from "@directus/env";

//#region src/database/helpers/schema/dialects/mysql.ts
const env = useEnv();
var SchemaHelperMySQL = class extends SchemaHelper {
	generateIndexName(type, collection, fields) {
		return getDefaultIndexName(type, collection, fields, { maxLength: 64 });
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
};

//#endregion
export { SchemaHelperMySQL };