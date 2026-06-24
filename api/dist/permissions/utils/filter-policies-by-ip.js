import { ipInNetworks } from "@directus/utils/node";

//#region src/permissions/utils/filter-policies-by-ip.ts
function filterPoliciesByIp(policies, ip) {
	return policies.filter(({ policy }) => {
		if (!policy.ip_access || policy.ip_access.length === 0) return true;
		if (!ip) return false;
		return ipInNetworks(ip, policy.ip_access);
	});
}

//#endregion
export { filterPoliciesByIp };