import { clearCache } from "../permissions/cache.js";
import { flushResponseCache } from "../scoped-cache/purge.js";
import "../scoped-cache/index.js";
import { clearSystemCache } from "../cache.js";
import { ItemsService } from "./items.js";
import { InvalidPayloadError } from "@directus/errors";
import { getMatch } from "ip-matching";
import { UserIntegrityCheckFlag } from "@directus/types";

//#region src/services/policies.ts
var PoliciesService = class extends ItemsService {
	constructor(options) {
		super("directus_policies", options);
	}
	async clearCaches(opts) {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
		if (this.cache && opts?.autoPurgeCache !== false) await flushResponseCache(this.cache);
	}
	isIpAccessValid(value) {
		if (value === void 0) return false;
		if (value === null) return true;
		if (Array.isArray(value) && value.length === 0) return true;
		for (const ip of value) {
			if (typeof ip !== "string" || ip.includes("*")) return false;
			try {
				if (getMatch(ip).type == "IPMask") return false;
			} catch {
				return false;
			}
		}
		return true;
	}
	assertValidIpAccess(partialItem) {
		if ("ip_access" in partialItem && !this.isIpAccessValid(partialItem["ip_access"])) throw new InvalidPayloadError({ reason: "IP Access contains an incorrect value. Valid values are: IP addresses, IP ranges and CIDR blocks" });
	}
	async createMany(data, opts = {}) {
		for (const item of data) this.assertValidIpAccess(item);
		const result = await super.createMany(data, opts);
		await clearCache();
		return result;
	}
	async updateGroups(groups, opts = {}) {
		for (const { data } of groups) this.assertValidIpAccess(data);
		return await super.updateGroups(groups, opts);
	}
	requiredIntegrityChecks(groups) {
		let integrityCheckFlags = UserIntegrityCheckFlag.None;
		for (const { data } of groups) {
			if ("admin_access" in data) {
				integrityCheckFlags |= UserIntegrityCheckFlag.RemainingAdmins;
				if (data["admin_access"] === true) integrityCheckFlags |= UserIntegrityCheckFlag.All;
			}
			if ("app_access" in data) integrityCheckFlags |= UserIntegrityCheckFlag.UserLimits;
		}
		return integrityCheckFlags;
	}
	async applyUpdateSideEffects(groups, opts) {
		if (groups.some(({ data }) => {
			return [
				"admin_access",
				"app_access",
				"ip_access",
				"enforce_tfa"
			].some((field) => field in data);
		})) await this.clearCaches(opts);
	}
	async deleteMany(keys, opts = {}) {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		const result = await super.deleteMany(keys, opts);
		await this.clearCaches(opts);
		return result;
	}
};

//#endregion
export { PoliciesService };