import { getHelpers } from "../helpers/index.js";
import { getDatabaseClient } from "../index.js";
import { transaction } from "../../utils/transaction.js";
import { getSchema } from "../../utils/get-schema.js";
import { FieldsService } from "../../services/fields.js";

//#region src/database/migrations/20251028A-add-retention-indexes.ts
const RETENTION_INDEXES = [{
	collection: "directus_activity",
	field: "timestamp",
	ignore: []
}, {
	collection: "directus_revisions",
	field: "parent",
	ignore: ["mysql"]
}];
async function up(knex) {
	const client = getDatabaseClient(knex);
	const helpers = getHelpers(knex);
	const service = new FieldsService({
		knex,
		schema: await getSchema()
	});
	for (const { collection, field, ignore } of RETENTION_INDEXES) {
		if (ignore.includes(client)) continue;
		if (!(await service.columnInfo(collection, field)).is_indexed) await helpers.schema.createIndex(collection, field, { attemptConcurrentIndex: true });
	}
}
async function down(knex) {
	const client = getDatabaseClient(knex);
	const helpers = getHelpers(knex);
	const service = new FieldsService({
		knex,
		schema: await getSchema()
	});
	for (const { collection, field, ignore } of RETENTION_INDEXES) {
		if (ignore.includes(client)) continue;
		if ((await service.columnInfo(collection, field)).is_indexed) await transaction(knex, async (trx) => {
			await trx.schema.alterTable(collection, async (table) => {
				table.dropIndex([field], helpers.schema.generateIndexName("index", collection, field));
			});
		});
	}
}

//#endregion
export { down, up };