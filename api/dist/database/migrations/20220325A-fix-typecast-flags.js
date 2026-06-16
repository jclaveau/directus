import { toArray } from "@directus/utils";
import { isArray } from "lodash-es";

//#region src/database/migrations/20220325A-fix-typecast-flags.ts
async function up(knex) {
	const fields = await knex.select("id", "special").from("directus_fields").whereNotNull("special").orWhere("special", "<>", "");
	for (const { id, special } of fields) {
		let parsedSpecial;
		try {
			if (special.includes("{")) parsedSpecial = toArray(special.replace(/{/g, "").replace(/}/g, "").replace(/"/g, ""));
			else parsedSpecial = toArray(special);
		} catch {
			continue;
		}
		if (parsedSpecial && isArray(parsedSpecial)) {
			parsedSpecial = parsedSpecial.map((special$1) => {
				switch (special$1) {
					case "boolean":
					case "csv":
					case "json": return "cast-" + special$1;
					default: return special$1;
				}
			});
			const parsedSpecialString = parsedSpecial.join(",");
			if (parsedSpecialString !== special) await knex("directus_fields").update({ special: parsedSpecialString }).where({ id });
		}
	}
}
async function down(_knex) {}

//#endregion
export { down, up };