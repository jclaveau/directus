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

	// Every ten seconds by default: low enough staleness for tuning, cheap for one
	// node to drain a batch, and the cadence the byte budget is measured on.
	const flushSchedule = String(env['CACHE_STATS_FLUSH_SCHEDULE']);

	if (!validateCron(flushSchedule)) {
		logger.warn(
			`[cache-stats] CACHE_STATS_FLUSH_SCHEDULE is not a cron rule `
			+ `(${flushSchedule}) — the pipeline stays off`,
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

	scheduleSynchronizedJob('cache-stats', flushSchedule, async () => {
		try {
			await drainCacheEvents();
			await enforceCacheStatsBudget();
		}
		catch (err: any) {
			logger.warn(err, `[cache-stats] flush/enforce failed. ${err.message}`);
		}
	});

	// Daily by default: prune fact + anomaly rows past CACHE_STATS_RETENTION, the
	// cross-dialect bound where no chunk-drop reclaims them.
	const reapSchedule = String(env['CACHE_STATS_REAP_SCHEDULE']);

	if (validateCron(reapSchedule)) {
		scheduleSynchronizedJob('cache-stats-reap', reapSchedule, async () => {
			try {
				await reapCacheEvents();
				await reapCacheAnomalies();
				await reapCachePurges();
				await reapScopedCachePurgeTags();
				await reapCacheConfigEvents();
			}
			catch (err: any) {
				logger.warn(err, `[cache-stats] reap failed. ${err.message}`);
			}
		});
	}

	// Every ten minutes by default for the two dimensions, which the fact
	// retention leaves behind: they have no time axis to drop by, so a DELETE
	// never returns their disk and the size they settle at is their peak live row
	// count. Cheap because each pass takes a bounded slate through an index.
	const dimensionReapSchedule = String(
		env['CACHE_STATS_DIMENSION_REAP_SCHEDULE'],
	);

	if (validateCron(dimensionReapSchedule)) {
		scheduleSynchronizedJob(
			'cache-stats-dimension-reap',
			dimensionReapSchedule,
			async () => {
				try {
					// Descriptors first: the tags follow their entry's descriptor out,
					// so the same tick that orphans one hands the next reaper its rows.
					await reapCacheDescriptors();
					await reapScopedCacheEntryTags();
				}
				catch (err: any) {
					logger.warn(
						err,
						`[cache-stats] dimension reap failed. ${err.message}`,
					);
				}
			},
		);
	}

	return true;
}
