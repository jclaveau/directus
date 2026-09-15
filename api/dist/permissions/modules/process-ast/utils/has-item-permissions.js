//#region src/permissions/modules/process-ast/utils/has-item-permissions.ts
function hasItemPermissions(permission) {
	return permission.permissions !== null && Object.keys(permission.permissions).length > 0;
}

//#endregion
export { hasItemPermissions };