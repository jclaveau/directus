import { GENERATE_SPECIAL } from "@directus/constants";

//#region src/permissions/modules/process-payload/lib/is-field-nullable.ts
/**
* Checks if a given field is allowed to be set to `null`.
*/
function isFieldNullable(field) {
	if (field.nullable) return true;
	if (field.generated) return true;
	return GENERATE_SPECIAL.some((name) => field.special.includes(name));
}

//#endregion
export { isFieldNullable };