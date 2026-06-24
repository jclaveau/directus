import { useLogger } from "../../logger/index.js";
import { extractRequiredDynamicVariableContextForPermissions } from "../../permissions/utils/extract-required-dynamic-variable-context.js";
import { fetchDynamicVariableData } from "../../permissions/utils/fetch-dynamic-variable-data.js";
import { fetchPolicies } from "../../permissions/lib/fetch-policies.js";
import { processPermissions } from "../../permissions/utils/process-permissions.js";
import { fetchPermissions } from "../../permissions/lib/fetch-permissions.js";
import { fetchAllowedFields } from "../../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js";
import { validateItemAccess } from "../../permissions/modules/validate-access/lib/validate-item-access.js";
import { getService } from "../../utils/get-service.js";
import { calculateCacheMetadata } from "./calculate-cache-metadata.js";
import { filterToFields } from "./filter-to-fields.js";
import { permissionCache } from "./permissions-cache.js";

//#region src/websocket/collab/verify-permissions.ts
/**
* Verify if a client has permissions to perform an action on the item.
* - `string[]`: List of fields the client has access to, empty if item exists but access is restricted.
* - `null`: Indicates the item doesn't exist.
*/
async function verifyPermissions(accountability, collection, item, action = "read", options) {
	if (!accountability) return [];
	const { schema, knex } = options;
	if (!schema.collections[collection]) return [];
	if (accountability.admin) return ["*"];
	const cached = permissionCache.get(accountability, collection, String(item), action);
	if (cached !== void 0) return cached;
	const startInvalidationCount = permissionCache.getInvalidationCount();
	let itemData = null;
	try {
		const adminService = getService(collection, {
			schema,
			knex
		});
		const policies = await fetchPolicies(accountability, {
			knex,
			schema
		});
		const rawPermissions = await fetchPermissions({
			action,
			collections: [collection],
			policies,
			accountability,
			bypassDynamicVariableProcessing: true
		}, {
			knex,
			schema
		});
		const hasItemRules = rawPermissions.some((p) => p.permissions && Object.keys(p.permissions).length > 0);
		if (hasItemRules) {
			const fieldsToFetch = processPermissions({
				permissions: rawPermissions,
				accountability,
				permissionsContext: await fetchDynamicVariableData({
					accountability,
					policies,
					dynamicVariableContext: extractRequiredDynamicVariableContextForPermissions(rawPermissions)
				}, {
					knex,
					schema
				})
			}).map((perm) => perm.permissions ? filterToFields(perm.permissions, collection, schema) : []).flat();
			if (item && action !== "create") try {
				itemData = await adminService.readOne(item, { fields: fieldsToFetch });
			} catch {
				permissionCache.set(accountability, collection, String(item), action, null, []);
				return null;
			}
			else if (schema.collections[collection]?.singleton && action !== "create") {
				const pkField = schema.collections[collection].primary;
				if (pkField) {
					if (Array.from(fieldsToFetch).some((field) => field === "*" || field === pkField) === false) fieldsToFetch.push(pkField);
				}
				itemData = await adminService.readSingleton({ fields: fieldsToFetch });
			}
		}
		let allowedFields = [];
		if ((item || schema.collections[collection]?.singleton) && hasItemRules) allowedFields = (await validateItemAccess({
			collection,
			accountability,
			action,
			primaryKeys: item ? [item] : [],
			returnAllowedRootFields: true
		}, {
			knex,
			schema
		})).allowedRootFields || [];
		else allowedFields = await fetchAllowedFields({
			accountability,
			action,
			collection
		}, {
			knex,
			schema
		});
		if (permissionCache.getInvalidationCount() === startInvalidationCount) {
			const { ttlMs, dependencies } = calculateCacheMetadata(collection, itemData, rawPermissions, schema, accountability);
			permissionCache.set(accountability, collection, String(item), action, allowedFields, dependencies, ttlMs);
		}
		return allowedFields;
	} catch (err) {
		useLogger().error(err, `[Collab] verifyPermissions failed for user "${accountability.user}", collection "${collection}", and item "${item}"`);
		return [];
	}
}

//#endregion
export { verifyPermissions };