import { useEnv } from "@directus/env";

//#region src/utils/cache-audit-enabled.ts
/**
* Whether this node audits the cache at all. Per node rather than per fleet:
* the schedule is shared through the settings, so it is this switch that keeps
* a run — one uncached read per live entry — on the back-office and off the
* nodes serving traffic.
*/
function cacheAuditEnabled() {
	return useEnv()["CACHE_AUDIT_ENABLED"] === true;
}

//#endregion
export { cacheAuditEnabled };