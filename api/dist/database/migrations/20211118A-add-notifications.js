import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20211118A-add-notifications.ts
async function up(knex) {
	const helpers = getHelpers(knex);
	await knex.schema.createTable("directus_notifications", (table) => {
		table.increments();
		table.timestamp("timestamp").notNullable();
		table.string("status").defaultTo("inbox");
		table.uuid("recipient").notNullable().references("id").inTable("directus_users").onDelete("CASCADE");
		table.uuid("sender").notNullable().references("id").inTable("directus_users");
		table.string("subject").notNullable();
		table.text("message");
		table.string("collection", helpers.schema.getTableNameMaxLength());
		table.string("item");
	});
	await knex.schema.alterTable("directus_users", (table) => {
		table.boolean("email_notifications").defaultTo(true);
	});
	await knex("directus_users").update({ email_notifications: true });
}
async function down(knex) {
	await knex.schema.dropTable("directus_notifications");
	await knex.schema.alterTable("directus_users", (table) => {
		table.dropColumn("email_notifications");
	});
}

//#endregion
export { down, up };