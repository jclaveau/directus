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
	async translationKeyExists(key, language) {
		return (await this.knex.select("id").from(this.collection).where({
			key,
			language
		})).length > 0;
	}
	async createOne(data, opts) {
		if (await this.translationKeyExists(data["key"], data["language"])) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
		return await super.createOne(data, opts);
	}
	async updateMany(keys, data, opts) {
		if (keys.length > 0 && "key" in data && "language" in data) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
		else if ("key" in data || "language" in data) {
			const items = await this.readMany(keys);
			for (const item of items) {
				const updatedData = {
					...item,
					...data
				};
				if (await this.translationKeyExists(updatedData["key"], updatedData["language"])) throw new InvalidPayloadError({ reason: "Duplicate key and language combination" });
			}
		}
		return await super.updateMany(keys, data, opts);
	}
};

//#endregion
export { TranslationsService };