import { isEqual } from "../../../../utils/lodash-es-used.js";
import { getCases } from "./get-cases.js";

//#region src/permissions/modules/process-ast/lib/aggregate-field-cases.ts
/**
* The rules an aggregate of the field reads through a CASE, none when every row
* read already grants the field.
*/
function getAggregateFieldCases(collection, field, { cases, permissions }) {
	const { cases: ruleCases, caseMap, allowedFields } = getCases(collection, permissions, []);
	if (allowedFields.has("*") || allowedFields.has(field)) return [];
	const fieldCases = [...caseMap["*"] ?? [], ...caseMap[field] ?? []].map((caseIndex) => ruleCases[caseIndex]);
	if (cases.length > 0 && cases.every((rowCase) => {
		return fieldCases.some((fieldCase) => isEqual(fieldCase, rowCase));
	})) return [];
	return fieldCases;
}

//#endregion
export { getAggregateFieldCases };