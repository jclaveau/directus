import { fetchPolicies } from "../../lib/fetch-policies.js";
import { fetchPermissions } from "../../lib/fetch-permissions.js";
import { uniq } from "lodash-es";

//#region src/permissions/modules/fetch-allowed-collections/fetch-allowed-collections.ts
async function fetchAllowedCollections({ action, accountability }, { knex, schema }) {
	if (accountability.admin) return Object.keys(schema.collections);
	return uniq((await fetchPermissions({
		action,
		policies: await fetchPolicies(accountability, {
			knex,
			schema
		}),
		accountability
	}, {
		knex,
		schema
	})).map(({ collection }) => collection));
}

//#endregion
export { fetchAllowedCollections };