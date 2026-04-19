import { fetchPolicies } from "../../lib/fetch-policies.js";
import { fetchPermissions } from "../../lib/fetch-permissions.js";
import { uniq } from "lodash-es";

//#region src/permissions/modules/fetch-allowed-field-map/fetch-allowed-field-map.ts
async function fetchAllowedFieldMap({ accountability, action }, { knex, schema }) {
	const fieldMap = {};
	if (accountability.admin) {
		for (const [collection, { fields }] of Object.entries(schema.collections)) fieldMap[collection] = Object.keys(fields);
		return fieldMap;
	}
	const permissions = await fetchPermissions({
		action,
		policies: await fetchPolicies(accountability, {
			knex,
			schema
		}),
		accountability
	}, {
		knex,
		schema
	});
	for (const { collection, fields } of permissions) {
		if (!fieldMap[collection]) fieldMap[collection] = [];
		if (fields) fieldMap[collection].push(...fields);
	}
	for (const [collection, fields] of Object.entries(fieldMap)) fieldMap[collection] = uniq(fields);
	return fieldMap;
}

//#endregion
export { fetchAllowedFieldMap };