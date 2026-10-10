import { flushResponseCache } from "../scoped-cache/purge.js";
import { transaction } from "../utils/transaction.js";
import "../scoped-cache/index.js";
import { clearSystemCache } from "../cache.js";
import { ItemsService } from "./items.js";
import { AccessService } from "./access.js";
import { UsersService } from "./users.js";
import { PresetsService } from "./presets.js";
import { InvalidPayloadError } from "@directus/errors";
import { UserIntegrityCheckFlag } from "@directus/types";

//#region src/services/roles.ts
const DESCENDANT_PARENT_REASON = "A role cannot have a parent that is already a descendant of itself";
var RolesService = class RolesService extends ItemsService {
	constructor(options) {
		super("directus_roles", options);
	}
	async updateGroups(groups, opts = {}) {
		const parentGroups = groups.filter(({ data }) => "parent" in data);
		if (parentGroups.length > 0) await this.validateRoleNesting(parentGroups);
		return await super.updateGroups(groups, opts);
	}
	requiredIntegrityChecks(groups) {
		return groups.some(({ data }) => "parent" in data) ? UserIntegrityCheckFlag.All : UserIntegrityCheckFlag.None;
	}
	async applyUpdateSideEffects(groups) {
		if (groups.some(({ data }) => "parent" in data)) await this.clearCaches();
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
	async validateRoleNesting(parentGroups) {
		const normalizeRoleId = (roleId) => {
			if (!roleId) return null;
			return String(roleId).toLowerCase();
		};
		const parentsInBatch = /* @__PURE__ */ new Map();
		for (const { data, keys } of parentGroups) for (const key of keys) parentsInBatch.set(String(key).toLowerCase(), normalizeRoleId(data["parent"]));
		const storedParents = /* @__PURE__ */ new Map();
		const readParent = async (roleId) => {
			if (parentsInBatch.has(roleId)) return parentsInBatch.get(roleId) ?? null;
			if (!storedParents.has(roleId)) {
				const role = await this.knex.select("parent").from("directus_roles").where({ id: roleId }).first();
				storedParents.set(roleId, normalizeRoleId(role?.parent));
			}
			return storedParents.get(roleId) ?? null;
		};
		for (const [roleId, parentId] of parentsInBatch) {
			if (parentId === roleId) throw new InvalidPayloadError({ reason: "A role cannot be a parent of itself" });
			const climbedRoles = /* @__PURE__ */ new Set();
			let ancestorId = parentId;
			while (ancestorId && !climbedRoles.has(ancestorId)) {
				if (ancestorId === roleId) throw new InvalidPayloadError({ reason: DESCENDANT_PARENT_REASON });
				climbedRoles.add(ancestorId);
				ancestorId = await readParent(ancestorId);
			}
		}
	}
	async clearCaches(opts) {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
		if (this.cache && opts?.autoPurgeCache !== false) await flushResponseCache(this.cache);
	}
};

//#endregion
export { RolesService };