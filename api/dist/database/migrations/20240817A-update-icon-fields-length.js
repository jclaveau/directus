import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20240817A-update-icon-fields-length.ts
async function up(knex) {
	const helper = getHelpers(knex).schema;
	await helper.changeToType("directus_collections", "icon", "string", { length: 64 });
	await helper.changeToType("directus_dashboards", "icon", "string", {
		nullable: false,
		default: "dashboard",
		length: 64
	});
	await helper.changeToType("directus_flows", "icon", "string", { length: 64 });
	await helper.changeToType("directus_panels", "icon", "string", {
		default: null,
		length: 64
	});
	await helper.changeToType("directus_presets", "icon", "string", {
		default: "bookmark",
		length: 64
	});
	await helper.changeToType("directus_roles", "icon", "string", {
		nullable: false,
		default: "supervised_user_circle",
		length: 64
	});
}
async function down(knex) {
	const helper = getHelpers(knex).schema;
	await helper.changeToType("directus_collections", "icon", "string", { length: 30 });
	await helper.changeToType("directus_dashboards", "icon", "string", {
		nullable: false,
		default: "dashboard",
		length: 30
	});
	await helper.changeToType("directus_flows", "icon", "string", { length: 30 });
	await helper.changeToType("directus_panels", "icon", "string", {
		default: null,
		length: 30
	});
	await helper.changeToType("directus_presets", "icon", "string", {
		default: "bookmark",
		length: 30
	});
	await helper.changeToType("directus_roles", "icon", "string", {
		nullable: false,
		default: "supervised_user_circle",
		length: 30
	});
}

//#endregion
export { down, up };