import { applyFunctionToColumnName } from "./apply-function-to-column-name.js";

//#region src/database/run-ast/utils/get-field-alias.ts
function getNodeAlias(node) {
	return applyFunctionToColumnName(node.fieldKey);
}

//#endregion
export { getNodeAlias };