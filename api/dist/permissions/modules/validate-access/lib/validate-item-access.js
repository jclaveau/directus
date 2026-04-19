import { fetchPermittedAstRootFields } from "../../../../database/run-ast/modules/fetch-permitted-ast-root-fields.js";
import { processAst } from "../../process-ast/process-ast.js";
import { toBoolean } from "@directus/utils";

//#region src/permissions/modules/validate-access/lib/validate-item-access.ts
async function validateItemAccess(options, context) {
	const primaryKeyField = context.schema.collections[options.collection]?.primary;
	if (!primaryKeyField) throw new Error(`Cannot find primary key for collection "${options.collection}"`);
	const ast = {
		type: "root",
		name: options.collection,
		query: { limit: options.primaryKeys.length },
		children: options.fields?.map((field) => ({
			type: "field",
			name: field,
			fieldKey: field,
			whenCase: []
		})) ?? [],
		cases: []
	};
	await processAst({
		ast,
		...options
	}, context);
	ast.query.filter = { [primaryKeyField]: { _in: options.primaryKeys } };
	const items = await fetchPermittedAstRootFields(ast, {
		schema: context.schema,
		accountability: options.accountability,
		knex: context.knex,
		action: options.action
	});
	if (items && items.length === options.primaryKeys.length) {
		const { fields } = options;
		if (fields) return items.every((item) => fields.every((field) => toBoolean(item[field])));
		return true;
	}
	return false;
}

//#endregion
export { validateItemAccess };