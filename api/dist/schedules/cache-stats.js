import { useLogger } from "../logger/index.js";
import { cacheStatsConfigured, drainCacheEvents, enforceCacheStatsBudget, flushCacheEventBuffer, reapCacheAnomalies, reapCacheConfigEvents, reapCacheDescriptors, reapCacheEvents, reapCachePurges, reapScopedCacheEntryTags, reapScopedCachePurgeTags, refreshCacheStatsFlag, subscribeCacheStatsToggle } from "../cache-events.js";
import { scheduleSynchronizedJob, validateCron } from "../utils/schedule.js";
import { useEnv } from "@directus/env";

//#region src/schedules/cache-stats.ts
/**
* Boot the cache-stats pipeline. The flush + budget watchdog run on a single node
* (SynchronizedClock picks one per tick); each node primes its gate from the Redis
* key then subscribes to the bus so a runtime toggle/autokill flips it at once.
*/
async function schedule() {
	if (!cacheStatsConfigured()) return false;
	const env = useEnv();
	const logger = useLogger();
	const drainSchedule = String(env["CACHE_STATS_DRAIN_SCHEDULE"]);
	if (!validateCron(drainSchedule)) {
		logger.warn(`[cache-stats] CACHE_STATS_DRAIN_SCHEDULE is not a cron rule (${drainSchedule}) — the pipeline stays off`);
		return false;
	}
	await refreshCacheStatsFlag();
	subscribeCacheStatsToggle();
	process.once("SIGTERM", () => void flushCacheEventBuffer());
	scheduleSynchronizedJob("cache-stats", drainSchedule, async () => {
		try {
			await drainCacheEvents();
			await enforceCacheStatsBudget();
		} catch (err) {
			logger.warn(err, `[cache-stats] drain/enforce failed. ${err.message}`);
		}
	});
	const retentionSchedule = String(env["CACHE_STATS_RETENTION_SCHEDULE"]);
	if (validateCron(retentionSchedule)) scheduleSynchronizedJob("cache-stats-reap", retentionSchedule, async () => {
		try {
			await reapCacheEvents();
			await reapCacheAnomalies();
			await reapCachePurges();
			await reapScopedCachePurgeTags();
			await reapCacheConfigEvents();
			await reapCacheDescriptors();
			await reapScopedCacheEntryTags();
		} catch (err) {
			logger.warn(err, `[cache-stats] reap failed. ${err.message}`);
		}
	});
	return true;
}

//#endregion
export { schedule as default };