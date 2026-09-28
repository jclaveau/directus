import { isPositiveDuration } from "../utils/get-milliseconds.js";
import { ItemsService } from "./items.js";
import { validateCron } from "../utils/schedule.js";
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
		if ("cache_audit_schedule" in data) {
			const rule = data["cache_audit_schedule"];
			if (typeof rule === "string" && rule.trim() !== "" && !validateCron(rule.trim())) throw new InvalidPayloadError({ reason: `Invalid cache_audit_schedule "${rule}" — expected a cron rule like "0 3 * * *"` });
		}
		return super.upsertSingleton(data, opts);
	}
};

//#endregion
export { SettingsService };