import { parseJsonFunction } from "../../database/helpers/fn/json/parse-function.js";
import { extractFunctionName } from "../../utils/extract-function-name.js";
import { parseFilterKey } from "../../utils/parse-filter-key.js";

//#region src/permissions/utils/get-unaliased-field-key.ts
/**
* Derive the unaliased field key from the given AST node.
*/
function getUnaliasedFieldKey(node) {
	switch (node.type) {
		case "o2m": return node.relation.meta.one_field;
		case "a2o":
		case "m2o": return node.relation.field;
		case "field": return parseFilterKey(node.name).fieldName;
		case "functionField": if (extractFunctionName(node.name) === "json") return parseJsonFunction(node.name).field;
		else return parseFilterKey(node.name).fieldName;
	}
}

//#endregion
export { getUnaliasedFieldKey };