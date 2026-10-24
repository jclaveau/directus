import { fetchPolicies } from "../permissions/lib/fetch-policies.js";
import { fetchPermissions } from "../permissions/lib/fetch-permissions.js";
import { createDefaultAccountability } from "../permissions/utils/create-default-accountability.js";

//#region src/utils/permissions-cachable.ts
/**
* Check if the read permissions for a collection contain the dynamic variable $NOW.
* If they do, the permissions are not cachable.
*/
async function permissionsCachable(collection, context, accountability) {
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
		return filter_has_now(permission.permissions);
	});
}
function filter_has_now(filter) {
	return Object.entries(filter).some(([key, value]) => {
		if (key === "_and" || key === "_or") return value.some((sub_filter) => filter_has_now(sub_filter));
		else if (typeof value === "object") return filter_has_now(value);
		else if (typeof value === "string") return value.startsWith("$NOW");
		return false;
	});
}

//#endregion
export { filter_has_now, permissionsCachable };