//#region src/database/migrations/20250224A-visual-editor.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.json("visual_editor_urls").nullable();
	});
	await updateModuleBar(knex, (moduleBar) => {
		if (moduleBar.find(({ id }) => id === "visual")) return;
		const visualEditorModule = {
			type: "module",
			id: "visual",
			enabled: false
		};
		const contentModuleIndex = moduleBar.findIndex(({ id }) => id === "content");
		moduleBar.splice(contentModuleIndex + 1, 0, visualEditorModule);
		return moduleBar;
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumns("visual_editor_urls");
	});
	await updateModuleBar(knex, (moduleBar) => moduleBar.filter(({ id }) => id !== "visual"));
}
async function updateModuleBar(knex, modify) {
	const result = await knex("directus_settings").select("module_bar", "id").first();
	if (result && result.module_bar) {
		const updatedModuleBar = modify(typeof result.module_bar === "string" ? JSON.parse(result.module_bar) : result.module_bar);
		if (!updatedModuleBar) return;
		await knex("directus_settings").update({ module_bar: JSON.stringify(updatedModuleBar) }).where("id", result.id);
	}
}

//#endregion
export { down, up };