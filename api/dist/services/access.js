import { clearCachesAfterCommit } from "../utils/clear-caches-after-commit.js";
import { ItemsService } from "./items.js";
import { InvalidPayloadError } from "@directus/errors";
import { UserIntegrityCheckFlag } from "@directus/types";

//#region src/services/access.ts
const MANAGED_ACCESS_GRANT_FIELDS = [
	"role",
	"user",
	"policy"
];
var ManagedAccessChangeError = class extends InvalidPayloadError {
	constructor({ id, managed_by }) {
		super({ reason: `Access ${JSON.stringify(id)} is managed by ${JSON.stringify(managed_by)}, which alone changes it` });
	}
};
var ManagedBySetError = class extends InvalidPayloadError {
	constructor() {
		super({ reason: "\"managed_by\" is set by the extension granting the access, not by a request" });
	}
};
function lowerCaseAccessKey(accessKey) {
	return String(accessKey).toLowerCase();
}
function groupDataByKey(groups) {
	const dataByKey = /* @__PURE__ */ new Map();
	for (const { keys, data } of groups) for (const key of keys) {
		const accessKey = lowerCaseAccessKey(key);
		const keyData = dataByKey.get(accessKey);
		if (keyData) keyData.push(data);
		else dataByKey.set(accessKey, [data]);
	}
	return dataByKey;
}
function lowerCaseKey(relatedKey) {
	return typeof relatedKey === "string" ? relatedKey.toLowerCase() : relatedKey;
}
function setsManagedBy(item) {
	return "managed_by" in item && item["managed_by"] !== null;
}
function changesManagedBy(data, managedAccess) {
	return "managed_by" in data && data["managed_by"] !== managedAccess.managed_by;
}
/** A relation may come as its key, or as an object holding it: `{ id, ... }`. */
function changesGrantField(data, managedAccess) {
	return MANAGED_ACCESS_GRANT_FIELDS.some((grantField) => {
		if (!(grantField in data)) return false;
		const fieldValue = data[grantField];
		const isRelatedObject = typeof fieldValue === "object" && fieldValue !== null;
		if (isRelatedObject && fieldValue.id === null) return true;
		return lowerCaseKey(isRelatedObject ? fieldValue.id : fieldValue) !== lowerCaseKey(managedAccess[grantField]);
	});
}
var AccessService = class extends ItemsService {
	constructor(options) {
		super("directus_access", options);
	}
	async clearCaches(opts) {
		await clearCachesAfterCommit(this.knex, this.cache, opts);
	}
	/**
	* An access row with `managed_by` is granted by that extension, whose code
	* runs without accountability: a request changing it by hand would be undone
	* by the extension, or strand the subscription it tracks.
	*
	* Judged like the write's other checks, after the filter hooks, the 403s and
	* the permission presets: a side effect of a refused request belongs in an
	* action hook, which it never reaches.
	*/
	async validateRowsToCreate(rows) {
		if (this.accountability && rows.some((row) => setsManagedBy(row))) throw new ManagedBySetError();
	}
	async readManagedAccess(keys, trx) {
		return await trx.select("id", "managed_by", ...MANAGED_ACCESS_GRANT_FIELDS).from("directus_access").whereIn("id", keys).whereNotNull("managed_by");
	}
	async validateKeysToDelete(keys, opts, trx) {
		if (!this.accountability || opts.deletesManagedAccess) return;
		const [managedAccess] = await this.readManagedAccess(keys, trx);
		if (managedAccess) throw new ManagedAccessChangeError(managedAccess);
	}
	/**
	* Who gets which policy is the extension's; `sort` and the rest are not. A
	* value sent back as it is stored changes nothing, so it is no refusal.
	*/
	async validateGroupsToUpdate(groups, trx) {
		if (!this.accountability) return;
		const managedRows = await this.readManagedAccess(groups.flatMap((group) => group.keys), trx);
		const dataByKey = groupDataByKey(groups);
		for (const managedAccess of managedRows) if ((dataByKey.get(lowerCaseAccessKey(managedAccess.id)) ?? []).some((data) => {
			return changesManagedBy(data, managedAccess) || changesGrantField(data, managedAccess);
		})) throw new ManagedAccessChangeError(managedAccess);
		const managedKeys = new Set(managedRows.map(({ id }) => lowerCaseAccessKey(id)));
		for (const group of groups.filter(({ data }) => setsManagedBy(data))) if (group.keys.some((key) => {
			return !managedKeys.has(lowerCaseAccessKey(key));
		})) throw new ManagedBySetError();
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
	/**
	* What a role delete takes along, managed rows included: the database's
	* cascade does the same for a deleted user or policy.
	*/
	async deleteRoleAccess(roleKeys, opts = {}) {
		const accessKeys = await this.getKeysByQuery({ filter: { role: { _in: roleKeys } } });
		return accessKeys.length > 0 ? await this.deleteMany(accessKeys, {
			...opts,
			deletesManagedAccess: true,
			keysFromQuery: true
		}) : [];
	}
};

//#endregion
export { AccessService };