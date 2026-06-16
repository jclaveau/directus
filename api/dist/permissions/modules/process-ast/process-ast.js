import { fetchPolicies } from "../../lib/fetch-policies.js";
import { fetchPermissions } from "../../lib/fetch-permissions.js";
import { injectCases } from "./lib/inject-cases.js";
import { fieldMapFromAst } from "./lib/field-map-from-ast.js";
import { collectionsInFieldMap } from "./utils/collections-in-field-map.js";
import { validatePathExistence } from "./utils/validate-path/validate-path-existence.js";
import { validatePathPermissions } from "./utils/validate-path/validate-path-permissions.js";

//#region src/permissions/modules/process-ast/process-ast.ts
async function processAst(options, context) {
	const fieldMap = fieldMapFromAst(options.ast, context.schema);
	const collections = collectionsInFieldMap(fieldMap);
	if (!options.accountability || options.accountability.admin) {
		for (const [path, { collection, fields }] of [...fieldMap.read.entries(), ...fieldMap.other.entries()]) validatePathExistence(path, collection, fields, context.schema);
		return options.ast;
	}
	const policies = await fetchPolicies(options.accountability, context);
	const permissions = await fetchPermissions({
		action: options.action,
		policies,
		collections,
		accountability: options.accountability
	}, context);
	const readPermissions = options.action === "read" ? permissions : await fetchPermissions({
		action: "read",
		policies,
		collections,
		accountability: options.accountability
	}, context);
	for (const [path, { collection, fields }] of [...fieldMap.read.entries(), ...fieldMap.other.entries()]) validatePathExistence(path, collection, fields, context.schema);
	for (const [path, { collection, fields }] of fieldMap.other.entries()) validatePathPermissions(path, permissions, collection, fields);
	for (const [path, { collection, fields }] of fieldMap.read.entries()) validatePathPermissions(path, readPermissions, collection, fields);
	injectCases(options.ast, permissions);
	return options.ast;
}

//#endregion
export { processAst };