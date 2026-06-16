import { CUSTOM_LLM_FIELDS } from "../constants.js";
import { ItemsService } from "./items.js";
import { getEntitlementManager } from "../license/entitlements/manager.js";
import { sendReport } from "../telemetry/lib/send-report.js";
import "../telemetry/index.js";
import "../license/index.js";
import { InvalidPayloadError, ResourceRestrictedError } from "@directus/errors";
import { version } from "directus/version";

//#region src/services/settings.ts
var SettingsService = class extends ItemsService {
	constructor(options) {
		super("directus_settings", options);
	}
	async createOne(data, opts) {
		if (this.accountability !== null) {
			if ("license_key" in data) throw new InvalidPayloadError({ reason: `You can't change the "license_key" value manually` });
			if ("license_token" in data) throw new InvalidPayloadError({ reason: `You can't change the "license_token" value manually` });
		}
		const entitlementManager = getEntitlementManager();
		const changesLLM = CUSTOM_LLM_FIELDS.some((field) => field in data && data[field] !== null);
		if (!entitlementManager.isEntitled("custom_llms_enabled") && changesLLM) throw new ResourceRestrictedError({ category: "custom_llms_enabled" });
		const result = await super.createOne(data, opts);
		if (changesLLM) await getEntitlementManager().clearCache("custom_llms_enabled");
		return result;
	}
	async updateMany(keys, data, opts) {
		if (this.accountability !== null) {
			if ("license_key" in data) throw new InvalidPayloadError({ reason: `You can't change the "license_key" value manually` });
			if ("license_token" in data) throw new InvalidPayloadError({ reason: `You can't change the "license_token" value manually` });
		}
		const entitlementManager = getEntitlementManager();
		const changesLLM = CUSTOM_LLM_FIELDS.some((field) => field in data && data[field] !== null);
		if (!entitlementManager.isEntitled("custom_llms_enabled") && changesLLM) throw new ResourceRestrictedError({ category: "custom_llms_enabled" });
		const result = await super.updateMany(keys, data, opts);
		if (changesLLM) await entitlementManager.clearCache("custom_llms_enabled");
		return result;
	}
	async readByQuery(query, opts) {
		const data = await super.readByQuery(query, opts);
		if (!getEntitlementManager().isEntitled("custom_llms_enabled") && this.accountability !== null) {
			for (const record of data) for (const field of CUSTOM_LLM_FIELDS) if (record[field]) record[field] = null;
		}
		return data;
	}
	async setOwner(data) {
		const { project_id } = await this.knex.select("project_id").from("directus_settings").first();
		sendReport({
			...data,
			project_id,
			version
		}).catch(async () => {
			await this.knex.update("project_status", "pending").from("directus_settings");
		});
		return await this.upsertSingleton({
			project_owner: data.project_owner,
			product_updates: data.product_updates,
			project_usage: data.project_usage,
			org_name: data.org_name
		});
	}
};

//#endregion
export { SettingsService };