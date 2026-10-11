import { dedupeAccess } from "../utils/dedupe-access.js";
import { hasItemPermissions } from "../utils/has-item-permissions.js";

//#region src/permissions/modules/process-ast/lib/get-cases.ts
function getCases(collection, permissions, requestedKeys) {
	const permissionsForCollection = permissions.filter((permission) => permission.collection === collection);
	const rules = dedupeAccess(permissionsForCollection);
	const cases = [];
	const caseMap = {};
	let index = 0;
	for (const { rule, fields } of rules) {
		if (requestedKeys.length > 0 && fields.has("*") === false && Array.from(fields).every((field) => requestedKeys.includes(field) === false)) continue;
		if (rule === null) continue;
		cases.push(rule);
		for (const field of fields) caseMap[field] = [...caseMap[field] ?? [], index];
		index++;
	}
	return {
		cases,
		caseMap,
		allowedFields: new Set(permissionsForCollection.filter((permission) => hasItemPermissions(permission) === false).map((permission) => permission.fields ?? []).flat())
	};
}

//#endregion
export { getCases };