import { useLogger } from "../logger/index.js";
import { scopedCachePurgeEnabled } from "../scoped-cache/config.js";
import { runScopedCacheIndexReap } from "../scoped-cache/reap-requests.js";
import { scopedCacheFillPaused } from "../scoped-cache/fill-pause.js";
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
		logger.warn(`[scoped-cache] CACHE_SCOPED_INDEX_REAP_SCHEDULE is not a cron rule (${reapSchedule}) — only a flush or a boot reaps the index, so expired entries pile up in it between them`);
		return false;
	}
	scheduleSynchronizedJob("scoped-cache-index-reap", reapSchedule, async () => {
		if (scopedCacheFillPaused()) return;
		try {
			await runScopedCacheIndexReap();
		} catch (error) {
			logger.warn(error, `[scoped-cache] reaping the index failed: ${error}`);
		}
	});
	return true;
}

//#endregion
export { schedule as default };