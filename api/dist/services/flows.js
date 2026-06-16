import { ItemsService } from "./items.js";
import { getEntitlementManager } from "../license/entitlements/manager.js";
import { getFlowManager } from "../flows.js";

//#region src/services/flows.ts
var FlowsService = class extends ItemsService {
	constructor(options) {
		super("directus_flows", options);
	}
	async createOne(data, opts) {
		if (!("status" in data) || data["status"] === "active") await getEntitlementManager().assert("flows", {
			adding: 1,
			knex: this.knex
		});
		const result = await super.createOne(data, opts);
		await getEntitlementManager().clearCache("flows");
		await getFlowManager().reload();
		return result;
	}
	async updateMany(keys, data, opts) {
		if ("status" in data && data["status"] === "active") await getEntitlementManager().assert("flows", {
			adding: keys.length,
			knex: this.knex
		});
		const result = await super.updateMany(keys, data, opts);
		await getEntitlementManager().clearCache("flows");
		await getFlowManager().reload();
		return result;
	}
	async deleteMany(keys, opts) {
		await this.knex("directus_operations").update({
			resolve: null,
			reject: null
		}).whereIn("flow", keys);
		const result = await super.deleteMany(keys, opts);
		await getEntitlementManager().clearCache("flows");
		await getFlowManager().reload();
		return result;
	}
};

//#endregion
export { FlowsService };