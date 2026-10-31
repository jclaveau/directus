//#region src/database/migrations/20231009B-update-panel-options.ts
async function up(knex) {
	const panels = await knex("directus_panels").where("type", "=", "metric").select();
	const updates = [];
	for (const panel of panels) {
		let options = panel.options;
		const wasStringified = typeof options === "string";
		if (wasStringified) options = JSON.parse(options);
		if (!options) continue;
		let needsUpdate = false;
		if (options.abbreviate === true) {
			options.notation = "compact";
			delete options.abbreviate;
			needsUpdate = true;
		}
		if (typeof options.decimals === "number") {
			options.minimumFractionDigits = options.decimals;
			options.maximumFractionDigits = options.decimals;
			delete options.decimals;
			needsUpdate = true;
		}
		if (needsUpdate) {
			if (wasStringified) options = JSON.stringify(options);
			updates.push(knex("directus_panels").update({ options }).where("id", panel.id));
		}
	}
	return Promise.all(updates);
}
async function down(knex) {
	const panels = await knex("directus_panels").where("type", "=", "metric").select();
	const updates = [];
	for (const panel of panels) {
		let options = panel.options;
		const wasStringified = typeof options === "string";
		if (wasStringified) options = JSON.parse(options);
		if (!options) continue;
		let needsUpdate = false;
		if (options.notation === "compact") {
			options.abbreviate = true;
			delete options.notation;
			needsUpdate = true;
		}
		if (typeof options.minimumFractionDigits === "number" && options.minimumFractionDigits === options.maximumFractionDigits) {
			options.decimals = options.minimumFractionDigits;
			delete options.minimumFractionDigits;
			delete options.maximumFractionDigits;
			needsUpdate = true;
		}
		if (needsUpdate) {
			if (wasStringified) options = JSON.stringify(options);
			updates.push(knex("directus_panels").update({ options }).where("id", panel.id));
		}
	}
	return Promise.all(updates);
}

//#endregion
export { down, up };