import { SchemaHelper } from "../types.js";

//#region src/database/helpers/schema/dialects/default.ts
var SchemaHelperDefault = class extends SchemaHelper {
	async dropUniqueIfExists(knex, collection, field) {
		const constraintName = this.generateIndexName("unique", collection, field);
		await knex.schema.alterTable(collection, (table) => {
			table.dropUnique([field], constraintName);
		});
	}
	async dropIndexIfExists(knex, collection, field) {
		const indexName = this.generateIndexName("index", collection, field);
		await knex.schema.alterTable(collection, (table) => {
			table.dropIndex([field], indexName);
		});
	}
};

//#endregion
export { SchemaHelperDefault };