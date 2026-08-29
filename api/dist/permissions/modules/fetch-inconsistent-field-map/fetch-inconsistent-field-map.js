import { fetchPolicies } from "../../lib/fetch-policies.js";
import { fetchPermissions } from "../../lib/fetch-permissions.js";
import { difference, intersection, uniq } from "lodash-es";

//#region src/permissions/modules/fetch-inconsistent-field-map/fetch-inconsistent-field-map.ts
/**
* Fetch a field map for fields that may or may not be null based on item-by-item permissions.
*/
async function fetchInconsistentFieldMap({ accountability, action }, { knex, schema }) {
	const fieldMap = {};
	if (!accountability || accountability.admin) {
		for (const collection of Object.keys(schema.collections)) fieldMap[collection] = [];
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
	const collections = uniq(permissions.map(({ collection }) => collection));
	for (const collection of collections) {
		const fields = permissions.filter((permission) => permission.collection === collection).map((permission) => permission.fields ?? []);
		const availableEverywhere = intersection(...fields);
		fieldMap[collection] = difference(uniq(fields.flat()), availableEverywhere);
	}
	return fieldMap;
}

//#endregion
export { fetchInconsistentFieldMap };