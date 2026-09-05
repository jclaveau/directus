import { withCache } from "../../utils/with-cache.js";
import { toArray } from "@directus/utils";

//#region src/permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.ts
const fetchPoliciesIpAccess = withCache("policies-ip-access", _fetchPoliciesIpAccess, ({ user, roles }) => ({
	user,
	roles
}));
async function _fetchPoliciesIpAccess(accountability, knex) {
	const query = knex("directus_access").select({ ip_access: "directus_policies.ip_access" }).leftJoin("directus_policies", "directus_access.policy", "directus_policies.id").whereNotNull("directus_policies.ip_access");
	if (accountability.roles.length === 0 && !accountability.user) query.where({
		role: null,
		user: null
	});
	else query.where(function() {
		if (accountability.user) this.orWhere("directus_access.user", accountability.user);
		this.orWhereIn("directus_access.role", accountability.roles);
	});
	return (await query).filter(({ ip_access }) => ip_access).map(({ ip_access }) => toArray(ip_access));
}

//#endregion
export { _fetchPoliciesIpAccess, fetchPoliciesIpAccess };