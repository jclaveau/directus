import { createCollectionForbiddenError, createFieldsForbiddenError } from "./create-error.js";

//#region src/permissions/modules/process-ast/utils/validate-path/validate-path-permissions.ts
function validatePathPermissions(path, permissions, collection, fields) {
	const permissionsForCollection = permissions.filter((permission) => permission.collection === collection);
	if (permissionsForCollection.length === 0) throw createCollectionForbiddenError(path, collection);
	const allowedFields = /* @__PURE__ */ new Set();
	for (const { fields: fields$1 } of permissionsForCollection) {
		if (!fields$1) continue;
		for (const field of fields$1) {
			if (field === "*") return;
			allowedFields.add(field);
		}
	}
	const requestedFields = Array.from(fields);
	const forbiddenFields = allowedFields.has("*") ? [] : requestedFields.filter((field) => allowedFields.has(field) === false);
	if (forbiddenFields.length > 0) throw createFieldsForbiddenError(path, collection, forbiddenFields);
}

//#endregion
export { validatePathPermissions };