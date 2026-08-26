import {
	cacheStatsConfigured,
	enforceCacheStatsBudget,
	drainCacheEvents,
	flushCacheEventBuffer,
	reapCacheAnomalies,
	reapCacheConfigEvents,
	reapCacheDescriptors,
	reapCacheEvents,
	reapScopedCacheEntryTags,
	reapCachePurges,
	reapScopedCachePurgeTags,
	refreshCacheStatsFlag,
	subscribeCacheStatsToggle,
} from '../cache-events.js';
import { useEnv } from '@directus/env';
import { useLogger } from '../logger/index.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';

/**
 * Boot the cache-stats pipeline. The flush + budget watchdog run on a single node
 * (SynchronizedClock picks one per tick); each node primes its gate from the Redis
 * key then subscribes to the bus so a runtime toggle/autokill flips it at once.
 */
export default async function schedule(): Promise<boolean> {
	if (!cacheStatsConfigured()) {
		return false;
	}

	const env = useEnv();
	const logger = useLogger();

	// Every ten seconds by default. Two things ride this tick: the buffered
	// events are moved out of the Redis stream into the fact tables, and the byte
	// budget is measured over those tables and evicted down to. Ten seconds is
	// low enough staleness for tuning and cheap for one node to drain a batch.
	const drainSchedule = String(env['CACHE_STATS_DRAIN_SCHEDULE']);

	if (!validateCron(drainSchedule)) {
		logger.warn(
			`[cache-stats] CACHE_STATS_DRAIN_SCHEDULE is not a cron rule `
			+ `(${drainSchedule}) — the pipeline stays off`,
		);

		return false;
	}

	// Prime the gate from the durable key, then take live updates off the bus
	// (event-driven — no per-node poll). Boot-read covers a missed publish.
	await refreshCacheStatsFlag();
	subscribeCacheStatsToggle();

	// Best-effort flush of the buffered XADDs on shutdown; if the runtime exits before
	// the pipeline resolves, the last tick is still lost (telemetry is lossy anyway).
	process.once('SIGTERM', () => void flushCacheEventBuffer());

	scheduleSynchronizedJob('cache-stats', drainSchedule, async () => {
		try {
			await drainCacheEvents();
			await enforceCacheStatsBudget();
		}
		catch (err: any) {
			logger.warn(err, `[cache-stats] drain/enforce failed. ${err.message}`);
		}
	});

	// One sweep for everything retention leaves behind, in the order the rules
	// depend on each other: the facts age out on CACHE_STATS_RETENTION, which is
	// what turns a descriptor into an orphan, which is what turns its entry tags
	// into orphans. Two jobs on two cadences would have raced that chain.
	//
	// Every ten minutes rather than nightly because half of it is not a retention
	// window at all: the dimensions have no time axis to drop by, so nothing
	// reclaims their disk and what they settle at is their peak live row count.
	// The fact half costs nothing at this cadence — it deletes only what aged out
	// since the last pass — and it spreads what used to be a 3AM spike.
	const retentionSchedule = String(env['CACHE_STATS_RETENTION_SCHEDULE']);

	if (validateCron(retentionSchedule)) {
		scheduleSynchronizedJob('cache-stats-reap', retentionSchedule, async () => {
			try {
				await reapCacheEvents();
				await reapCacheAnomalies();
				await reapCachePurges();
				await reapScopedCachePurgeTags();
				await reapCacheConfigEvents();
				await reapCacheDescriptors();
				await reapScopedCacheEntryTags();
			}
			catch (err: any) {
				logger.warn(err, `[cache-stats] reap failed. ${err.message}`);
			}
		});
	}

	return true;
}
