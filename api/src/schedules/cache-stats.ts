import {
	cacheStatsConfigured,
	enforceCacheStatsBudget,
	flushCacheEvents,
	flushCacheEventBuffer,
	reapCacheAnomalies,
	reapCacheDescriptors,
	reapCacheEvents,
	refreshCacheStatsFlag,
	subscribeCacheStatsToggle,
} from '../cache-events.js';
import { useLogger } from '../logger/index.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';

// Every 10s: low enough staleness for tuning, cheap for one node to flush a batch.
const FLUSH_CRON = '*/10 * * * * *';

// Daily: prune fact rows past CACHE_STATS_RETENTION (cross-dialect bound) and the
// orphaned descriptors left behind (the dimension has no retention of its own).
const REAP_CRON = '0 3 * * *';

/**
 * Boot the cache-stats pipeline. The flush + budget watchdog run on a single node
 * (SynchronizedClock picks one per tick); each node primes its gate from the Redis
 * key then subscribes to the bus so a runtime toggle/autokill flips it at once.
 */
export default async function schedule(): Promise<boolean> {
	if (!cacheStatsConfigured()) {
		return false;
	}

	if (!validateCron(FLUSH_CRON)) {
		return false;
	}

	const logger = useLogger();

	// Prime the gate from the durable key, then take live updates off the bus
	// (event-driven — no per-node poll). Boot-read covers a missed publish.
	await refreshCacheStatsFlag();
	subscribeCacheStatsToggle();

	// Flush the in-memory XADD batch on shutdown so the last tick isn't lost.
	process.once('SIGTERM', () => void flushCacheEventBuffer());

	scheduleSynchronizedJob('cache-stats', FLUSH_CRON, async () => {
		try {
			await flushCacheEvents();
			await enforceCacheStatsBudget();
		}
		catch (err: any) {
			logger.warn(err, `[cache-stats] flush/enforce failed. ${err.message}`);
		}
	});

	if (validateCron(REAP_CRON)) {
		scheduleSynchronizedJob('cache-stats-reap', REAP_CRON, async () => {
			try {
				await reapCacheEvents();
				await reapCacheDescriptors();
				await reapCacheAnomalies();
			}
			catch (err: any) {
				logger.warn(err, `[cache-stats] reap failed. ${err.message}`);
			}
		});
	}

	return true;
}
