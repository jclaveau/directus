import database_default from "../database/index.js";
import { ipInNetworks } from "./ip-in-networks.js";
import { fetchPoliciesIpAccess } from "../permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.js";
import { getGraphqlQueryAndVariables } from "./get-graphql-query-and-variables.js";
import hash from "object-hash";
import url from "url";
import { version } from "directus/version";

//#region src/utils/get-cache-key.ts
async function getCacheKey(req) {
	const path = url.parse(req.originalUrl).pathname;
	const isGraphQl = path?.startsWith("/graphql");
	let includeIp = false;
	if (req.accountability && req.accountability.ip) {
		const ipFilters = await fetchPoliciesIpAccess(req.accountability, database_default());
		includeIp = ipFilters.length > 0 && ipFilters.some((networks) => ipInNetworks(req.accountability.ip, networks));
	}
	return hash({
		version,
		user: req.accountability?.user || null,
		path,
		query: isGraphQl ? getGraphqlQueryAndVariables(req) : req.sanitizedQuery,
		...includeIp && { ip: req.accountability.ip }
	});
}

//#endregion
export { getCacheKey };