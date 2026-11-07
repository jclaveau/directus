import database_default from "../database/index.js";
import { ItemsService } from "./items.js";
import { ForbiddenError, InvalidPayloadError, ItemNotFoundError } from "@directus/errors";

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
	refuseUnreadableRow(key) {
		if (this.accountability?.admin === true) throw new ItemNotFoundError({
			collection: this.collection,
			primaryKey: key
		});
		throw new ForbiddenError({ reason: `You don't have permission to perform "update" for collection "${this.collection}" or it does not exist.` });
	}
	async createMany(data, opts) {
		for (const translationRow of data) for (const requiredField of ["key", "language"]) if (translationRow[requiredField] === void 0) throw new InvalidPayloadError({ reason: `"${requiredField}" is required` });
		const claimedCombos = /* @__PURE__ */ new Set();
		for (const translationRow of data) {
			const keyCombo = JSON.stringify([translationRow["key"], translationRow["language"]]);
			if (claimedCombos.has(keyCombo) || await this.translationKeyExists(translationRow["key"], translationRow["language"])) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
			claimedCombos.add(keyCombo);
		}
		return await super.createMany(data, opts);
	}
	async updateGroups(groups, opts) {
		const claimedCombos = /* @__PURE__ */ new Set();
		const movedKeys = groups.filter(({ data }) => {
			return "key" in data || "language" in data;
		}).flatMap(({ keys }) => {
			return keys;
		});
		for (const { data, keys } of groups) if (keys.length > 1 && "key" in data && "language" in data) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
		else if ("key" in data || "language" in data) {
			const items = await this.readMany(keys);
			for (const key of keys) {
				const item = items.find((readItem) => {
					return this.primaryKeyNameOf(readItem["id"]) === this.primaryKeyNameOf(key);
				});
				if (item === void 0) this.refuseUnreadableRow(key);
				const updatedData = {
					...item,
					...data
				};
				if (updatedData["key"] === void 0 || updatedData["language"] === void 0) this.refuseUnreadableRow(key);
				const keyCombo = JSON.stringify([updatedData["key"], updatedData["language"]]);
				if (claimedCombos.has(keyCombo) || await this.translationKeyExists(updatedData["key"], updatedData["language"], movedKeys.filter((movedKey) => {
					return String(movedKey) !== String(key);
				}))) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
				claimedCombos.add(keyCombo);
			}
		}
		return await super.updateGroups(groups, opts);
	}
};

//#endregion
export { TranslationsService };