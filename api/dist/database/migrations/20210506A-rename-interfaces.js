import { parseJSON } from "@directus/utils";

//#region src/database/migrations/20210506A-rename-interfaces.ts
const changes = [
	["button-links", "presentation-links"],
	["checkboxes", "select-multiple-checkbox"],
	["code", "input-code"],
	["color", "select-color"],
	["datetime", "datetime"],
	["divider", "presentation-divider"],
	["dropdown", "select-dropdown"],
	["dropdown-multiselect", "select-multiple-dropdown"],
	["file", "file"],
	["hash", "input-hash"],
	["icon", "select-icon"],
	["image", "file-image"],
	["m2a-builder", "list-m2a"],
	["many-to-many", "list-m2m"],
	["many-to-one", "select-dropdown-m2o"],
	["markdown", "input-rich-text-md"],
	["notice", "presentation-notice"],
	["numeric", "input"],
	["one-to-many", "list-o2m"],
	["radio-buttons", "select-radio"],
	["repeater", "list"],
	["slider", "slider"],
	[
		"slug",
		"input",
		{ slug: true }
	],
	["tags", "tags"],
	["text-input", "input"],
	["textarea", "input-multiline"],
	["toggle", "boolean"],
	["translations", "translations"],
	["tree-view", "list-o2m-tree-view"],
	[
		"user",
		"select-dropdown-m2o",
		{ template: "{{avatar.$thumbnail}} {{first_name}} {{last_name}}" }
	],
	["wysiwyg", "input-rich-text-html"],
	["collection", "system-collection"],
	["collections", "system-collection-multiple"],
	["display-template", "system-display-template"],
	["field", "system-field"],
	["interface", "system-interface"],
	["interface-options", "system-interface-options"],
	["scope", "system-scope"],
	["system-language", "system-language"],
	["tfa-setup", "system-mfa-setup"]
];
async function up(knex) {
	for (const [before, after, options] of changes) if (options) {
		const fields = await knex.select("id", "options").from("directus_fields").where({ interface: before });
		for (const { id, options: existingOptionsRaw } of fields) {
			const newOptions = {
				...(typeof existingOptionsRaw === "string" ? parseJSON(existingOptionsRaw) : existingOptionsRaw) || {},
				...options
			};
			await knex("directus_fields").update({
				interface: after,
				options: JSON.stringify(newOptions)
			}).where({ id });
		}
	} else await knex("directus_fields").update({ interface: after }).where({ interface: before });
}
async function down(knex) {
	for (const [before, after] of changes) await knex("directus_fields").update({ interface: before }).where({ interface: after });
}

//#endregion
export { down, up };