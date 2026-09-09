import { getDefaultIndexName } from "../../../../utils/get-default-index-name.js";
import { SchemaHelper } from "../types.js";
import { useEnv } from "@directus/env";

//#region src/database/helpers/schema/dialects/mysql.ts
const env = useEnv();
var SchemaHelperMySQL = class extends SchemaHelper {
	generateIndexName(type, collection, fields) {
		return getDefaultIndexName(type, collection, fields, { maxLength: 64 });
	}
	async hasIndex(knex, collection, indexName) {
		const result = await knex.select("index_name").from("information_schema.statistics").whereRaw("table_schema = database()").andWhere({
			table_name: collection,
			index_name: indexName
		}).first();
		return Boolean(result);
	}
	async dropUniqueIfExists(knex, collection, field) {
		const constraintName = this.generateIndexName("unique", collection, field);
		if (await this.hasIndex(knex, collection, constraintName)) await knex.schema.alterTable(collection, (table) => {
			table.dropUnique([field], constraintName);
		});
	}
	async dropIndexIfExists(knex, collection, field) {
		const indexName = this.generateIndexName("index", collection, field);
		if (await this.hasIndex(knex, collection, indexName)) await knex.schema.alterTable(collection, (table) => {
			table.dropIndex([field], indexName);
		});
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
	async getColumnsWithInvalidCollation(schema, collation) {
		const { version } = await this.knex.select(this.knex.raw("VERSION() as version")).first();
		const isMariaDB = String(version).split("-").includes("MariaDB");
		return this.knex("information_schema.columns").select({
			table_name: "TABLE_NAME",
			name: "COLUMN_NAME",
			collation: "COLLATION_NAME"
		}).where({ TABLE_SCHEMA: schema }).whereNot({ COLLATION_NAME: collation }).modify((queryBuilder) => {
			if (isMariaDB) queryBuilder.andWhereNot((qb) => {
				qb.where({ COLUMN_TYPE: "longtext" }).andWhere({ COLLATION_NAME: "utf8mb4_bin" });
			});
		});
	}
};

//#endregion
export { SchemaHelperMySQL };