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
		case "field":
		case "functionField": return parseFilterKey(node.name).fieldName;
	}
}

//#endregion
export { getUnaliasedFieldKey };