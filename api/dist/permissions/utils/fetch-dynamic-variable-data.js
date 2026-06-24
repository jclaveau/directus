import { getCache, getCacheValue, setCacheValue } from "../../cache.js";
import "./extract-required-dynamic-variable-context.js";
import { useEnv } from "@directus/env";
import { getSimpleHash } from "@directus/utils";

//#region src/permissions/utils/fetch-dynamic-variable-data.ts
async function fetchDynamicVariableData(options, context) {
	const { UsersService } = await import("../../services/users.js");
	const { RolesService } = await import("../../services/roles.js");
	const { PoliciesService } = await import("../../services/policies.js");
	const contextData = {};
	if (options.accountability.user && (options.dynamicVariableContext.$CURRENT_USER?.size ?? 0) > 0) contextData["$CURRENT_USER"] = await fetchContextData("$CURRENT_USER", options.dynamicVariableContext, { user: options.accountability.user }, async (fields) => {
		return await new UsersService(context).readOne(options.accountability.user, { fields });
	});
	if (options.accountability.role && (options.dynamicVariableContext.$CURRENT_ROLE?.size ?? 0) > 0) contextData["$CURRENT_ROLE"] = await fetchContextData("$CURRENT_ROLE", options.dynamicVariableContext, { role: options.accountability.role }, async (fields) => {
		return await new RolesService(context).readOne(options.accountability.role, { fields });
	});
	if (options.accountability.roles && options.accountability.roles.length > 0 && (options.dynamicVariableContext.$CURRENT_ROLES?.size ?? 0) > 0) contextData["$CURRENT_ROLES"] = await fetchContextData("$CURRENT_ROLES", options.dynamicVariableContext, { roles: options.accountability.roles }, async (fields) => {
		return await new RolesService(context).readMany(options.accountability.roles, { fields });
	});
	if (options.policies.length > 0) if ((options.dynamicVariableContext.$CURRENT_POLICIES?.size ?? 0) > 0) {
		options.dynamicVariableContext.$CURRENT_POLICIES.add("id");
		contextData["$CURRENT_POLICIES"] = await fetchContextData("$CURRENT_POLICIES", options.dynamicVariableContext, { policies: options.policies }, async (fields) => {
			return await new PoliciesService(context).readMany(options.policies, { fields });
		});
	} else contextData["$CURRENT_POLICIES"] = options.policies.map((id) => ({ id }));
	return contextData;
}
async function fetchContextData(key, permissionContext, cacheContext, fetch) {
	const { cache } = getCache();
	const env = useEnv();
	const fields = Array.from(permissionContext[key]);
	const cacheKey = cache ? `filter-context-${key.slice(1)}-${getSimpleHash(JSON.stringify({
		...cacheContext,
		fields
	}))}` : "";
	let data = void 0;
	if (cache) data = await getCacheValue(cache, cacheKey);
	if (!data) {
		data = await fetch(fields);
		if (cache && env["CACHE_ENABLED"] !== false) await setCacheValue(cache, cacheKey, data);
	}
	return data;
}

//#endregion
export { fetchDynamicVariableData };