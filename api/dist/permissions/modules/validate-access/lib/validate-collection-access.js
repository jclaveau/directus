import { fetchPolicies } from "../../../lib/fetch-policies.js";
import { fetchPermissions } from "../../../lib/fetch-permissions.js";

//#region src/permissions/modules/validate-access/lib/validate-collection-access.ts
/**
* Check if you have (limited) access to a given collection by making sure there's at least 1
* permission rule available for the collection and action combo
*/
async function validateCollectionAccess(options, context) {
	const policies = await fetchPolicies(options.accountability, context);
	return (await fetchPermissions({
		action: options.action,
		policies,
		collections: [options.collection],
		accountability: options.accountability
	}, context)).length > 0;
}

//#endregion
export { validateCollectionAccess };