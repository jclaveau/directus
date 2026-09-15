import { fetchPolicies } from "../../lib/fetch-policies.js";

//#region src/permissions/modules/fetch-accountability-policy-globals/fetch-accountability-policy-globals.ts
async function fetchAccountabilityPolicyGlobals(accountability, context) {
	const policies = await fetchPolicies(accountability, context);
	const result = await context.knex.select(1).from("directus_policies").whereIn("id", policies).where("enforce_tfa", true).first();
	return {
		app_access: accountability.app,
		admin_access: accountability.admin,
		enforce_tfa: !!result
	};
}

//#endregion
export { fetchAccountabilityPolicyGlobals };