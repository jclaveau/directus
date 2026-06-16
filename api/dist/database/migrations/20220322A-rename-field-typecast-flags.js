import { toArray } from "@directus/utils";
import { isArray } from "lodash-es";

//#region src/database/migrations/20220322A-rename-field-typecast-flags.ts
async function up(knex) {
	const fields = await knex.select("id", "special").from("directus_fields").whereNotNull("special").orWhere("special", "<>", "");
	for (const { id, special } of fields) {
		let parsedSpecial;
		try {
			parsedSpecial = toArray(special);
		} catch {
			continue;
		}
		if (parsedSpecial && isArray(parsedSpecial)) {
			let updateRequired = false;
			parsedSpecial = parsedSpecial.map((special$1) => {
				switch (special$1) {
					case "boolean":
					case "csv":
					case "json":
						updateRequired = true;
						return "cast-" + special$1;
					default: return special$1;
				}
			});
			if (updateRequired) await knex("directus_fields").update({ special: parsedSpecial.join(",") }).where({ id });
		}
	}
}
async function down(knex) {
	const fields = await knex.select("id", "special").from("directus_fields").whereNotNull("special").orWhere("special", "<>", "");
	for (const { id, special } of fields) {
		let parsedSpecial;
		try {
			parsedSpecial = toArray(special);
		} catch {
			continue;
		}
		if (parsedSpecial && isArray(parsedSpecial)) {
			let updateRequired = false;
			parsedSpecial = parsedSpecial.map((special$1) => {
				switch (special$1) {
					case "cast-boolean":
					case "cast-csv":
					case "cast-json":
						updateRequired = true;
						return special$1.replace("cast-", "");
					default: return special$1;
				}
			});
			if (updateRequired) await knex("directus_fields").update({ special: parsedSpecial.join(",") }).where({ id });
		}
	}
}

//#endregion
export { down, up };