import database_default from "../database/index.js";
import { getFlowManager } from "../flows.js";
import { fetchPoliciesIpAccess } from "../permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.js";
import { getGraphqlQueryAndVariables } from "./get-graphql-query-and-variables.js";
import { toArray } from "@directus/utils";
import { isEmpty, pick } from "lodash-es";
import { ipInNetworks } from "@directus/utils/node";
import hash from "object-hash";
import url from "url";
import { version } from "directus/version";

//#region src/utils/get-cache-key.ts
const FLOW_TRIGGER_PATTERN = /^\/flows\/trigger\/([0-9a-f-]+)/i;
async function getCacheKey(req) {
	const path = url.parse(req.originalUrl).pathname;
	const isGraphQl = path?.startsWith("/graphql");
	let flowTriggerQuery = void 0;
	if (path) {
		const flowMatch = path.match(FLOW_TRIGGER_PATTERN);
		if (flowMatch) {
			const cacheQueryParams = toArray(getFlowManager().getFlow(flowMatch[1])?.options?.["cacheQueryParams"] ?? []);
			const picked = pick(req.query, cacheQueryParams);
			if (!isEmpty(picked)) flowTriggerQuery = picked;
		}
	}
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
		...flowTriggerQuery && { rawQuery: flowTriggerQuery },
		...includeIp && { ip: req.accountability.ip }
	});
}

//#endregion
export { getCacheKey };