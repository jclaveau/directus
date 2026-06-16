import { isValidUuid } from "./is-valid-uuid.js";
import { ForbiddenError } from "@directus/errors";

//#region src/utils/validate-keys.ts
/**
* Validate keys based on its type
*/
function validateKeys(schema, collection, keyField, keys) {
	if (Array.isArray(keys)) for (const key of keys) validateKeys(schema, collection, keyField, key);
	else {
		const primaryKeyFieldType = schema.collections[collection]?.fields[keyField]?.type;
		if (primaryKeyFieldType === "uuid" && !isValidUuid(String(keys))) throw new ForbiddenError();
		else if (primaryKeyFieldType === "integer" && !Number.isInteger(Number(keys))) throw new ForbiddenError();
	}
}

//#endregion
export { validateKeys };