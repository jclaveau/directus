//#region src/database/migrations/20260204A-add-deployment.ts
async function up(knex) {
	await knex.schema.createTable("directus_deployments", (table) => {
		table.uuid("id").primary().notNullable();
		table.string("provider").notNullable().unique();
		table.text("credentials");
		table.text("options");
		table.timestamp("date_created").defaultTo(knex.fn.now());
		table.uuid("user_created").references("id").inTable("directus_users").onDelete("SET NULL");
	});
	await knex.schema.createTable("directus_deployment_projects", (table) => {
		table.uuid("id").primary().notNullable();
		table.uuid("deployment").notNullable().references("id").inTable("directus_deployments").onDelete("CASCADE");
		table.string("external_id").notNullable();
		table.string("name").notNullable();
		table.timestamp("date_created").defaultTo(knex.fn.now());
		table.uuid("user_created").references("id").inTable("directus_users").onDelete("SET NULL");
		table.unique(["deployment", "external_id"]);
	});
	await knex.schema.createTable("directus_deployment_runs", (table) => {
		table.uuid("id").primary().notNullable();
		table.uuid("project").notNullable().references("id").inTable("directus_deployment_projects").onDelete("CASCADE");
		table.string("external_id").notNullable();
		table.string("target").notNullable();
		table.timestamp("date_created").defaultTo(knex.fn.now());
		table.uuid("user_created").references("id").inTable("directus_users").onDelete("SET NULL");
	});
}
async function down(knex) {
	await knex.schema.dropTable("directus_deployment_runs");
	await knex.schema.dropTable("directus_deployment_projects");
	await knex.schema.dropTable("directus_deployments");
}

//#endregion
export { down, up };