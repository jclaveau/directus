import { getHelpers } from "../helpers/index.js";
import { getDatabaseClient } from "../index.js";
import { transaction } from "../../utils/transaction.js";
import { getSchema } from "../../utils/get-schema.js";
import { FieldsService } from "../../services/fields.js";

//#region src/database/migrations/20260113A-add-revisions-index.ts
const RETENTION_INDEXES = [{
	collection: "directus_revisions",
	field: "activity",
	ignore: ["mysql", "mariadb"]
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