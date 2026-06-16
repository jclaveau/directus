import { applyFunctionToColumnName } from "./apply-function-to-column-name.js";

//#region src/database/run-ast/utils/get-field-alias.ts
function getNodeAlias(node) {
	if ("alias" in node && node.alias === true) return node.fieldKey;
	return applyFunctionToColumnName(node.fieldKey);
}

//#endregion
export { getNodeAlias };