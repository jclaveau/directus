import { parseJsonFunction } from "../../helpers/fn/json/parse-function.js";
import { extractFunctionName } from "../../../utils/extract-function-name.js";
import { parseFilterKey } from "../../../utils/parse-filter-key.js";
import { fetchAllowedFields } from "../../../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js";
import { getRelation } from "@directus/utils";
import { cloneDeep } from "lodash-es";

//#region src/database/get-ast-from-query/lib/convert-wildcards.ts
async function convertWildcards(options, context) {
	const fields = cloneDeep(options.fields);
	const fieldsInCollection = Object.entries(context.schema.collections[options.collection].fields).map(([name]) => name);
	let allowedFields = fieldsInCollection;
	if (options.accountability && options.accountability.admin === false) allowedFields = await fetchAllowedFields({
		collection: options.collection,
		action: "read",
		accountability: options.accountability
	}, context);
	if (!allowedFields || allowedFields.length === 0) return [];
	if (allowedFields[0] === "*") allowedFields = fieldsInCollection;
	for (let index = 0; index < fields.length; index++) {
		const fieldKey = fields[index];
		if (fieldKey.includes("*") === false) continue;
		if (fieldKey === "*") {
			const aliases = Object.keys(options.alias ?? {});
			if (allowedFields.includes("*")) fields.splice(index, 1, ...fieldsInCollection, ...aliases);
			else {
				const allowedAliases = aliases.filter((fieldKey$1) => {
					const aliasValue = options.alias[fieldKey$1];
					if (extractFunctionName(aliasValue) === "json") try {
						const { field } = parseJsonFunction(aliasValue);
						return allowedFields.includes(field);
					} catch {
						return false;
					}
					const { fieldName } = parseFilterKey(aliasValue);
					return allowedFields.includes(fieldName);
				});
				fields.splice(index, 1, ...allowedFields, ...allowedAliases);
			}
		}
		if (fieldKey.includes(".") && fieldKey.split(".")[0] === "*") {
			const parts = fieldKey.split(".");
			let relationalFields = [];
			if (allowedFields.includes("*")) relationalFields = context.schema.relations.reduce((acc, relation) => {
				if (relation.collection === options.collection && !acc.includes(relation.field)) acc.push(relation.field);
				if (relation.related_collection === options.collection && !acc.includes(relation.meta.one_field)) acc.push(relation.meta.one_field);
				return acc;
			}, []);
			else relationalFields = allowedFields.filter((fieldKey$1) => getRelation(context.schema.relations, options.collection, fieldKey$1) !== void 0);
			if (options.backlink === false) relationalFields = relationalFields.filter((relationField) => getRelation(context.schema.relations, options.collection, relationField) !== context.parentRelation);
			const nonRelationalFields = allowedFields.filter((fieldKey$1) => relationalFields.includes(fieldKey$1) === false);
			const aliasFields = Object.keys(options.alias ?? {}).map((fieldKey$1) => {
				const name = options.alias[fieldKey$1];
				if (relationalFields.includes(name)) return `${fieldKey$1}.${parts.slice(1).join(".")}`;
				return fieldKey$1;
			});
			fields.splice(index, 1, ...[
				...relationalFields.map((relationalField) => {
					return `${relationalField}.${parts.slice(1).join(".")}`;
				}),
				...nonRelationalFields,
				...aliasFields
			]);
		}
	}
	return fields;
}

//#endregion
export { convertWildcards };