import { fetchPolicies } from "../../../lib/fetch-policies.js";
import { fetchPermissions } from "../../../lib/fetch-permissions.js";
import { fetchPermittedAstRootFields } from "../../../../database/run-ast/modules/fetch-permitted-ast-root-fields.js";
import { fetchAllowedFields } from "../../fetch-allowed-fields/fetch-allowed-fields.js";
import { injectCases } from "../../process-ast/lib/inject-cases.js";
import { processAst } from "../../process-ast/process-ast.js";
import { toBoolean } from "@directus/utils";

//#region src/permissions/modules/validate-access/lib/validate-item-access.ts
async function validateItemAccess(options, context) {
	const collectionInfo = context.schema.collections[options.collection];
	const primaryKeyField = collectionInfo?.primary;
	if (!primaryKeyField) throw new Error(`Cannot find primary key for collection "${options.collection}"`);
	const isSingleton = collectionInfo?.singleton === true;
	const hasPrimaryKeys = options.primaryKeys && options.primaryKeys.length > 0;
	if (!isSingleton && !hasPrimaryKeys) return { accessAllowed: false };
	const ast = {
		type: "root",
		name: options.collection,
		query: { limit: isSingleton && !hasPrimaryKeys ? 1 : options.primaryKeys.length },
		children: options.fields?.map((field) => ({
			type: "field",
			name: field,
			fieldKey: field,
			whenCase: [],
			alias: false
		})) ?? [],
		cases: []
	};
	await processAst({
		ast,
		...options
	}, context);
	if (hasPrimaryKeys) ast.query.filter = { [primaryKeyField]: { _in: options.primaryKeys } };
	let hasItemRules;
	let permissionedFields;
	if (options.returnAllowedRootFields) {
		const allowedFields = await fetchAllowedFields({
			accountability: options.accountability,
			action: options.action,
			collection: options.collection
		}, context);
		const schemaFields = Object.keys(context.schema.collections[options.collection].fields);
		permissionedFields = allowedFields.includes("*") ? schemaFields : allowedFields;
		const policies = await fetchPolicies(options.accountability, context);
		const permissions = await fetchPermissions({
			action: options.action,
			policies,
			collections: [options.collection],
			accountability: options.accountability
		}, context);
		hasItemRules = permissions.some((p) => p.permissions && Object.keys(p.permissions).length > 0);
		if (hasItemRules) {
			ast.children = permissionedFields.map((field) => ({
				type: "field",
				name: field,
				fieldKey: field,
				whenCase: [],
				alias: false
			}));
			injectCases(ast, permissions);
		}
	}
	const items = await fetchPermittedAstRootFields(ast, {
		schema: context.schema,
		accountability: options.accountability,
		knex: context.knex,
		action: options.action
	});
	const expectedCount = isSingleton && !hasPrimaryKeys ? 1 : options.primaryKeys.length;
	if (!(items && items.length === expectedCount)) {
		if (options.returnAllowedRootFields) return {
			accessAllowed: false,
			allowedRootFields: []
		};
		return { accessAllowed: false };
	}
	let accessAllowed = true;
	if (options.fields) accessAllowed = items.every((item) => options.fields.every((field) => toBoolean(item[field])));
	if (options.returnAllowedRootFields) {
		if (!hasItemRules) return {
			accessAllowed,
			allowedRootFields: permissionedFields
		};
		const allowedRootFields = items.length > 0 ? Object.keys(items[0]).filter((field) => items.every((item) => item[field] === 1)) : [];
		return {
			accessAllowed,
			allowedRootFields
		};
	}
	return { accessAllowed };
}

//#endregion
export { validateItemAccess };