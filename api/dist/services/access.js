import { clearCachesAfterCommit } from "../utils/clear-caches-after-commit.js";
import { ItemsService } from "./items.js";
import { UserIntegrityCheckFlag } from "@directus/types";

//#region src/services/access.ts
var AccessService = class extends ItemsService {
	constructor(options) {
		super("directus_access", options);
	}
	async clearCaches(opts) {
		await clearCachesAfterCommit(this.knex, this.cache, opts);
	}
	async createMany(data, opts = {}) {
		opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		const result = await super.createMany(data, opts);
		await this.clearCaches();
		return result;
	}
	async updateGroups(groups, opts = {}) {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		const result = await super.updateGroups(groups, {
			...opts,
			userIntegrityCheckFlags: UserIntegrityCheckFlag.All
		});
		await this.clearCaches();
		return result;
	}
	async deleteMany(keys, opts = {}) {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		const result = await super.deleteMany(keys, opts);
		await this.clearCaches();
		return result;
	}
};

//#endregion
export { AccessService };