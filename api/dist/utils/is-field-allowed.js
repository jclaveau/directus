//#region src/utils/is-field-allowed.ts
/**
* Check if a specific field is allowed within a set of allowed fields
*/
function isFieldAllowed(allowedFields, field) {
	if (Array.isArray(allowedFields)) return allowedFields.includes(field) || allowedFields.includes("*");
	return allowedFields.has(field) || allowedFields.has("*");
}

//#endregion
export { isFieldAllowed };