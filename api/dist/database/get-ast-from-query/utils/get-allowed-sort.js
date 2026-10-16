import { fetchAllowedFields } from "../../../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js";

//#region src/database/get-ast-from-query/utils/get-allowed-sort.ts
async function getAllowedSort(options, context) {
	let sortField = context.schema.collections[options.collection].primary;
	if (context.schema.collections[options.collection]?.sortField) sortField = context.schema.collections[options.collection].sortField;
	if (options.relation?.meta?.sort_field) sortField = options.relation.meta.sort_field;
	if (options.accountability && options.accountability.admin === false) {
		const allowedFields = await fetchAllowedFields({
			collection: options.collection,
			action: "read",
			accountability: options.accountability
		}, context);
		if (allowedFields.length === 0) sortField = null;
		else if (allowedFields.includes("*") === false && allowedFields.includes(sortField) === false) sortField = allowedFields[0];
	}
	if (options.query?.group?.[0]) sortField = options.query.group[0];
	if (sortField) return [sortField];
	return null;
}

//#endregion
export { getAllowedSort };