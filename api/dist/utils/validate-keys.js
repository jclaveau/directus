import { isValidUuid } from "./is-valid-uuid.js";
import { InvalidPayloadError } from "@directus/errors";
import { oneLine } from "@directus/utils";

//#region src/utils/validate-keys.ts
/**
* Validate keys based on its type
*/
function validateKeys(schema, collection, keyField, keys) {
	if (Array.isArray(keys)) for (const key of keys) validateKeys(schema, collection, keyField, key);
	else {
		const primaryKeyFieldType = schema.collections[collection]?.fields[keyField]?.type;
		if (primaryKeyFieldType === "uuid" && !isValidUuid(String(keys))) throw new InvalidPayloadError({ reason: `Primary key of ${collection} must be a uuid instead of ${JSON.stringify(keys, null, 2)}` });
		else if ((primaryKeyFieldType === "integer" || primaryKeyFieldType === "bigInteger") && !isIntegerKey(keys)) throw new InvalidPayloadError({ reason: `Primary key of ${collection} must be an integer instead of ${JSON.stringify(keys, null, 2)}` });
		else if (keys === void 0 || keys === null) throw new InvalidPayloadError({ reason: oneLine`
					Primary key of ${JSON.stringify(collection)} must be a
					${JSON.stringify(primaryKeyFieldType)} instead of ${JSON.stringify(keys)}
				` });
	}
}
function isIntegerKey(key) {
	return typeof key === "number" ? Number.isInteger(key) : /^[+-]?\d+$/.test(key);
}

//#endregion
export { validateKeys };