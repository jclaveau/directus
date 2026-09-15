import { InvalidQueryError } from "@directus/errors";
import { getFilterOperatorsForType } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/filter/validate-operator.ts
function validateOperator(type, filterOperator, special) {
	if (filterOperator.startsWith("_")) filterOperator = filterOperator.slice(1);
	if (!getFilterOperatorsForType(type).includes(filterOperator)) throw new InvalidQueryError({ reason: `"${type}" field type does not contain the "_${filterOperator}" filter operator` });
	if (special?.includes("conceal") && !getFilterOperatorsForType("hash").includes(filterOperator)) throw new InvalidQueryError({ reason: `Field with "conceal" special does not allow the "_${filterOperator}" filter operator` });
}

//#endregion
export { validateOperator };