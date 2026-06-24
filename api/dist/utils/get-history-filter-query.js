import { getEntitlementManager } from "../license/entitlements/manager.js";
import "../license/index.js";
import { mergeFilters } from "@directus/utils";

//#region src/utils/get-history-filter-query.ts
function getHistoryFilterQuery(query, entitlement, buildFilter) {
	const limit = getEntitlementManager().getEntitlementLimit(entitlement);
	if (limit === null || !Number.isFinite(limit) || limit < 0) return query;
	if (limit === 0) return {
		...query,
		limit: 0
	};
	const filter = mergeFilters(buildFilter(/* @__PURE__ */ new Date(Date.now() - limit * 1e3)), query.filter ?? null, "and");
	if (!filter) return query;
	return {
		...query,
		filter
	};
}

//#endregion
export { getHistoryFilterQuery };