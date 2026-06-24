import { UserIntegrityCheckFlag } from "../packages/types/dist/index.js";
import { clearSystemCache } from "../cache.js";
import { ItemsService } from "./items.js";

//#region src/services/access.ts
var AccessService = class extends ItemsService {
	constructor(options) {
		super("directus_access", options);
	}
	async clearCaches(opts) {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
		if (this.cache && opts?.autoPurgeCache !== false) await this.cache.clear();
	}
	async createOne(data, opts = {}) {
		opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		const result = await super.createOne(data, opts);
		await this.clearCaches();
		return result;
	}
	async updateMany(keys, data, opts = {}) {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		const result = await super.updateMany(keys, data, {
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