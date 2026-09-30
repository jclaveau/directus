import { createCollectionForbiddenError, createFieldsForbiddenError } from "./create-error.js";

//#region src/permissions/modules/process-ast/utils/validate-path/validate-path-existence.ts
function validatePathExistence(path, collection, fields, schema) {
	const collectionInfo = schema.collections[collection];
	if (collectionInfo === void 0) throw createCollectionForbiddenError(path, collection);
	const nonExistentFields = Array.from(fields).filter((field) => collectionInfo.fields[field] === void 0);
	if (nonExistentFields.length > 0) throw createFieldsForbiddenError(path, collection, nonExistentFields);
}

//#endregion
export { validatePathExistence };