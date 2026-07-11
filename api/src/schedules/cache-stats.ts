import {
	cacheStatsConfigured,
	enforceCacheStatsBudget,
	flushCacheEvents,
	reapCacheDescriptors,
	reapCacheEvents,
	refreshCacheStatsFlag,
} from '../cache-events.js';
import { useLogger } from '../logger/index.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';

// Every 10s: low enough staleness for tuning, cheap for one node to flush a batch.
const FLUSH_CRON = '*/10 * * * * *';

// Daily: prune fact rows past CACHE_STATS_RETENTION (cross-dialect bound) and the
// orphaned descriptors left behind (the dimension has no retention of its own).
const REAP_CRON = '0 3 * * *';

// Per-instance flag re-read cadence — a live toggle/autokill propagates within this.
const FLAG_REFRESH_MS = 5_000;

/**
 * Boot the cache-stats pipeline. The flush + budget watchdog run on a single node
 * (SynchronizedClock picks one per tick); the flag refresh runs on every node so a
 * runtime toggle reaches each instance's hot-path gate.
 */
export default async function schedule(): Promise<boolean> {
	if (!cacheStatsConfigured()) {
		return false;
	}

	if (!validateCron(FLUSH_CRON)) {
		return false;
	}

	const logger = useLogger();

	// Prime the gate before the first request, then keep it fresh per instance.
	await refreshCacheStatsFlag();

	setInterval(() => {
		void refreshCacheStatsFlag().catch((err) => {
			logger.warn(err, `[cache-stats] flag refresh failed. ${err.message}`);
		});
	}, FLAG_REFRESH_MS).unref();

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
			}
			catch (err: any) {
				logger.warn(err, `[cache-stats] reap failed. ${err.message}`);
			}
		});
	}

	return true;
}
