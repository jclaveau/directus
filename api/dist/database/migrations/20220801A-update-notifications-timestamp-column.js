import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20220801A-update-notifications-timestamp-column.ts
async function up(knex) {
	await getHelpers(knex).schema.changeToType("directus_notifications", "timestamp", "timestamp", {
		nullable: true,
		default: knex.fn.now()
	});
}
async function down(knex) {
	await getHelpers(knex).schema.changeToType("directus_notifications", "timestamp", "timestamp", { nullable: false });
}

//#endregion
export { down, up };