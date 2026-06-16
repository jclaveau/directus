import { UserIntegrityCheckFlag } from "../packages/types/dist/index.js";
import { clearSystemCache } from "../cache.js";
import { fetchRolesTree } from "../permissions/lib/fetch-roles-tree.js";
import { transaction } from "../utils/transaction.js";
import { ItemsService } from "./items.js";
import { AccessService } from "./access.js";
import { UsersService } from "./users.js";
import { PresetsService } from "./presets.js";
import { InvalidPayloadError } from "@directus/errors";

//#region src/services/roles.ts
var RolesService = class RolesService extends ItemsService {
	constructor(options) {
		super("directus_roles", options);
	}
	async updateMany(keys, data, opts = {}) {
		if ("parent" in data) {
			opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
			opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
			await this.validateRoleNesting(keys, data["parent"]);
		}
		const result = await super.updateMany(keys, data, opts);
		if ("parent" in data) await this.clearCaches();
		return result;
	}
	async deleteMany(keys, opts = {}) {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);
		await transaction(this.knex, async (trx) => {
			const options = {
				knex: trx,
				accountability: this.accountability,
				schema: this.schema
			};
			const rolesItemsService = new ItemsService("directus_roles", options);
			const rolesService = new RolesService(options);
			const accessService = new AccessService(options);
			const presetsService = new PresetsService(options);
			const usersService = new UsersService(options);
			await accessService.deleteByQuery({ filter: { role: { _in: keys } } }, {
				...opts,
				bypassLimits: true
			});
			await presetsService.deleteByQuery({ filter: { role: { _in: keys } } }, {
				...opts,
				bypassLimits: true
			});
			await usersService.updateByQuery({ filter: { role: { _in: keys } } }, {
				status: "suspended",
				role: null
			}, {
				...opts,
				bypassLimits: true
			});
			await rolesService.updateByQuery({ filter: { parent: { _in: keys } } }, { parent: null });
			await rolesItemsService.deleteMany(keys, opts);
		});
		await this.clearCaches();
		return keys;
	}
	async validateRoleNesting(ids, parent) {
		if (ids.includes(parent)) throw new InvalidPayloadError({ reason: "A role cannot be a parent of itself" });
		const roles = await fetchRolesTree(parent, { knex: this.knex });
		if (ids.some((id) => roles.includes(id))) throw new InvalidPayloadError({ reason: "A role cannot have a parent that is already a descendant of itself" });
	}
	async clearCaches(opts) {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
		if (this.cache && opts?.autoPurgeCache !== false) await this.cache.clear();
	}
};

//#endregion
export { RolesService };