import { withCache } from "../utils/with-cache.js";
import { filterPoliciesByIp } from "../utils/filter-policies-by-ip.js";

//#region src/permissions/lib/fetch-policies.ts
const fetchPolicies = withCache("policies", _fetchPolicies, ({ roles, user, ip }) => ({
	roles,
	user,
	ip
}));
/**
* Fetch the policies associated with the current user accountability
*/
async function _fetchPolicies({ roles, user, ip }, context) {
	const { AccessService } = await import("../../services/access.js");
	const accessService = new AccessService(context);
	let roleFilter;
	if (roles.length === 0) roleFilter = { _and: [{ role: { _null: true } }, { user: { _null: true } }] };
	else roleFilter = { role: { _in: roles } };
	const filter = user ? { _or: [{ user: { _eq: user } }, roleFilter] } : roleFilter;
	const filteredAccessRows = filterPoliciesByIp(await accessService.readByQuery({
		filter,
		fields: [
			"policy.id",
			"policy.ip_access",
			"role"
		],
		limit: -1
	}), ip);
	filteredAccessRows.sort((a, b) => {
		if (!a.role && !b.role) return 0;
		if (!a.role) return 1;
		if (!b.role) return -1;
		return roles.indexOf(a.role) - roles.indexOf(b.role);
	});
	return filteredAccessRows.map(({ policy }) => policy.id);
}

//#endregion
export { _fetchPolicies, fetchPolicies };