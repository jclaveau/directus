import { isPositiveDuration } from "../utils/get-milliseconds.js";
import { ItemsService } from "./items.js";
import { InvalidPayloadError } from "@directus/errors";

//#region src/services/settings.ts
var SettingsService = class extends ItemsService {
	constructor(options) {
		super("directus_settings", options);
	}
	async upsertSingleton(data, opts) {
		if ("cache_ttl" in data) {
			const ttl = data["cache_ttl"];
			if (typeof ttl === "string" && ttl.trim() !== "" && !isPositiveDuration(ttl)) throw new InvalidPayloadError({ reason: `Invalid cache_ttl "${ttl}" — expected a positive duration like "30s", "5m", "1h"` });
		}
		return super.upsertSingleton(data, opts);
	}
};

//#endregion
export { SettingsService };