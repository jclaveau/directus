import { ipInNetworks } from "../../../../utils/ip-in-networks.js";
import { toArray, toBoolean } from "@directus/utils";

//#region src/permissions/modules/fetch-global-access/utils/fetch-global-access-for-query.ts
async function fetchGlobalAccessForQuery(query, accountability) {
	const globalAccess = {
		app: false,
		admin: false
	};
	const accessRows = await query.select("directus_policies.admin_access", "directus_policies.app_access", "directus_policies.ip_access").from("directus_access").leftJoin("directus_policies", "directus_policies.id", "directus_access.policy");
	for (const { admin_access, app_access, ip_access } of accessRows) {
		if (accountability.ip && ip_access) {
			const networks = toArray(ip_access);
			if (!ipInNetworks(accountability.ip, networks)) continue;
		}
		globalAccess.admin ||= toBoolean(admin_access);
		globalAccess.app ||= globalAccess.admin || toBoolean(app_access);
		if (globalAccess.admin) break;
	}
	return globalAccess;
}

//#endregion
export { fetchGlobalAccessForQuery };