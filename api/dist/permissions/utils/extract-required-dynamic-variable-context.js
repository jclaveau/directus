import { deepMap } from "@directus/utils";

//#region src/permissions/utils/extract-required-dynamic-variable-context.ts
function extractRequiredDynamicVariableContextForPermissions(permissions) {
	let permissionContext = {
		$CURRENT_USER: /* @__PURE__ */ new Set(),
		$CURRENT_ROLE: /* @__PURE__ */ new Set(),
		$CURRENT_ROLES: /* @__PURE__ */ new Set(),
		$CURRENT_POLICIES: /* @__PURE__ */ new Set()
	};
	for (const permission of permissions) {
		permissionContext = mergeContexts(permissionContext, extractRequiredDynamicVariableContext(permission.permissions));
		permissionContext = mergeContexts(permissionContext, extractRequiredDynamicVariableContext(permission.validation));
		permissionContext = mergeContexts(permissionContext, extractRequiredDynamicVariableContext(permission.presets));
	}
	return permissionContext;
}
function extractRequiredDynamicVariableContext(val) {
	const permissionContext = {
		$CURRENT_USER: /* @__PURE__ */ new Set(),
		$CURRENT_ROLE: /* @__PURE__ */ new Set(),
		$CURRENT_ROLES: /* @__PURE__ */ new Set(),
		$CURRENT_POLICIES: /* @__PURE__ */ new Set()
	};
	deepMap(val, extractPermissionData);
	return permissionContext;
	function extractPermissionData(val$1) {
		for (const placeholder of [
			"$CURRENT_USER",
			"$CURRENT_ROLE",
			"$CURRENT_ROLES",
			"$CURRENT_POLICIES"
		]) if (typeof val$1 === "string" && val$1.startsWith(`${placeholder}.`)) permissionContext[placeholder].add(val$1.replace(`${placeholder}.`, ""));
	}
}
function mergeContexts(context1, context2) {
	return {
		$CURRENT_USER: new Set([...context1.$CURRENT_USER, ...context2.$CURRENT_USER]),
		$CURRENT_ROLE: new Set([...context1.$CURRENT_ROLE, ...context2.$CURRENT_ROLE]),
		$CURRENT_ROLES: new Set([...context1.$CURRENT_ROLES, ...context2.$CURRENT_ROLES]),
		$CURRENT_POLICIES: new Set([...context1.$CURRENT_POLICIES, ...context2.$CURRENT_POLICIES])
	};
}

//#endregion
export { extractRequiredDynamicVariableContext, extractRequiredDynamicVariableContextForPermissions };