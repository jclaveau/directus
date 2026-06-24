import { fetchPolicies } from "../permissions/lib/fetch-policies.js";
import { fetchPermissions } from "../permissions/lib/fetch-permissions.js";
import { createDefaultAccountability } from "../permissions/utils/create-default-accountability.js";

//#region src/utils/permissions-cacheable.ts
/**
* Check if the read permissions for a collection contain the dynamic variable $NOW.
* If they do, the permissions are not cacheable.
*/
async function permissionsCacheable(collection, context, accountability) {
	if (!collection) return true;
	if (!accountability) accountability = createDefaultAccountability();
	return !(await fetchPermissions({
		action: "read",
		policies: await fetchPolicies(accountability, context),
		collections: [collection],
		accountability,
		bypassDynamicVariableProcessing: true
	}, context)).some((permission) => {
		if (!permission.permissions) return false;
		return filterHasNow(permission.permissions);
	});
}
function filterHasNow(filter) {
	if (filter === null) return false;
	return Object.entries(filter).some(([key, value]) => {
		if (key === "_and" || key === "_or") return value.some((sub_filter) => filterHasNow(sub_filter));
		else if (typeof value === "object") return filterHasNow(value);
		else if (typeof value === "string") return value.startsWith("$NOW");
		return false;
	});
}

//#endregion
export { filterHasNow, permissionsCacheable };