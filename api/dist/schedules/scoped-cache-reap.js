import { useLogger } from "../logger/index.js";
import { scopedCachePurgeEnabled } from "../scoped-cache/config.js";
import { reapScopedCacheIndex } from "../scoped-cache/purge.js";
import { scheduleSynchronizedJob, validateCron } from "../utils/schedule.js";
import { useEnv } from "@directus/env";

//#region src/schedules/scoped-cache-reap.ts
/**
* Schedule the reap of the scoped cache's index: the members naming entries that
* expired, which nothing else removes.
*
* @returns Whether or not the reap has been scheduled
*/
async function schedule() {
	if (!scopedCachePurgeEnabled()) return false;
	const logger = useLogger();
	const reapSchedule = String(useEnv()["CACHE_SCOPED_INDEX_REAP_SCHEDULE"]);
	if (!validateCron(reapSchedule)) {
		logger.warn(`[scoped-cache] CACHE_SCOPED_INDEX_REAP_SCHEDULE is not a cron rule (${reapSchedule}) — expired entries stay in the index`);
		return false;
	}
	scheduleSynchronizedJob("scoped-cache-index-reap", reapSchedule, async () => {
		try {
			await reapScopedCacheIndex();
		} catch (error) {
			logger.warn(error, `[scoped-cache] reaping the index failed: ${error}`);
		}
	});
	return true;
}

//#endregion
export { schedule as default };