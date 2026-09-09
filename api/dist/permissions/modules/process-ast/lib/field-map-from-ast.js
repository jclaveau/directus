import { extractFieldsFromQuery } from "./extract-fields-from-query.js";
import { extractFieldsFromChildren } from "./extract-fields-from-children.js";

//#region src/permissions/modules/process-ast/lib/field-map-from-ast.ts
function fieldMapFromAst(ast, schema) {
	const fieldMap = {
		read: /* @__PURE__ */ new Map(),
		other: /* @__PURE__ */ new Map()
	};
	extractFieldsFromChildren(ast.name, ast.children, fieldMap, schema);
	extractFieldsFromQuery(ast.name, ast.query, fieldMap, schema);
	return fieldMap;
}

//#endregion
export { fieldMapFromAst };