import { fetchPolicies } from "../../../permissions/lib/fetch-policies.js";
import { fetchPermissions } from "../../../permissions/lib/fetch-permissions.js";
import { getDBQuery } from "../lib/get-db-query.js";
import { parseCurrentLevel } from "../lib/parse-current-level.js";
import { cloneDeep } from "lodash-es";

//#region src/database/run-ast/modules/fetch-permitted-ast-root-fields.ts
/**
* Fetch the permitted top level fields of a given root type AST using a case/when query that is constructed the
* same way as `runAst` but only returns flags (1/null) instead of actual field values.
*/
async function fetchPermittedAstRootFields(originalAST, { schema, accountability, knex, action }) {
	const { name: collection, children, cases, query } = cloneDeep(originalAST);
	const { fieldNodes } = await parseCurrentLevel(schema, collection, children, query);
	let permissions = [];
	if (accountability && !accountability.admin) permissions = await fetchPermissions({
		action,
		accountability,
		policies: await fetchPolicies(accountability, {
			schema,
			knex
		})
	}, {
		schema,
		knex
	});
	return getDBQuery({
		table: collection,
		fieldNodes,
		o2mNodes: [],
		query,
		cases,
		permissions,
		permissionsOnly: true
	}, {
		schema,
		knex
	});
}

//#endregion
export { fetchPermittedAstRootFields };