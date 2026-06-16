import { UserIntegrityCheckFlag } from "../packages/types/dist/index.js";
import { clearCache } from "../permissions/cache.js";
import { clearSystemCache } from "../cache.js";
import { ItemsService } from "./items.js";
import { InvalidPayloadError } from "@directus/errors";
import { getMatch } from "ip-matching";

//#region src/services/policies.ts
var PoliciesService = class extends ItemsService {
	constructor(options) {
		super("directus_policies", options);
	}
	async clearCaches(opts) {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
		if (this.cache && opts?.autoPurgeCache !== false) await this.cache.clear();
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
	async createOne(data, opts = {}) {
		this.assertValidIpAccess(data);
		const result = await super.createOne(data, opts);
		await clearCache();
		return result;
	}
	async updateMany(keys, data, opts = {}) {
		this.assertValidIpAccess(data);
		if ("admin_access" in data) {
			let flags = UserIntegrityCheckFlag.RemainingAdmins;
			if (data["admin_access"] === true) flags |= UserIntegrityCheckFlag.All;
			opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | flags;
		}
		if ("app_access" in data) opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;
		if (opts.userIntegrityCheckFlags) opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		const result = await super.updateMany(keys, data, opts);
		if ("admin_access" in data || "app_access" in data || "ip_access" in data || "enforce_tfa" in data) await this.clearCaches(opts);
		return result;
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