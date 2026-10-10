import database_default from "../database/index.js";
import { ItemsService } from "./items.js";
import { InvalidPayloadError } from "@directus/errors";

//#region src/services/translations.ts
var TranslationsService = class extends ItemsService {
	constructor(options) {
		super("directus_translations", options);
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}
	async translationKeyExists(key, language, excludeKeys = []) {
		return (await this.knex.select("id").from(this.collection).where({
			key,
			language
		}).whereNotIn("id", excludeKeys)).length > 0;
	}
	async createOne(data, opts) {
		if (await this.translationKeyExists(data["key"], data["language"])) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
		return await super.createOne(data, opts);
	}
	async updateGroups(groups, opts) {
		const claimedCombos = /* @__PURE__ */ new Set();
		const movedKeys = groups.filter(({ data }) => {
			return "key" in data || "language" in data;
		}).flatMap(({ keys }) => {
			return keys;
		});
		for (const { data, keys } of groups) if (keys.length > 0 && "key" in data && "language" in data) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
		else if ("key" in data || "language" in data) {
			const items = await this.readMany(keys);
			for (const item of items) {
				const updatedData = {
					...item,
					...data
				};
				const keyCombo = JSON.stringify([updatedData["key"], updatedData["language"]]);
				if (claimedCombos.has(keyCombo) || await this.translationKeyExists(updatedData["key"], updatedData["language"], movedKeys.filter((movedKey) => {
					return String(movedKey) !== String(item["id"]);
				}))) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
				claimedCombos.add(keyCombo);
			}
		}
		return await super.updateGroups(groups, opts);
	}
};

//#endregion
export { TranslationsService };