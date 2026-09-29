import { useEnv } from '@directus/env';
import { useLogger } from '../logger/index.js';
import { scopedCachePurgeEnabled } from '../scoped-cache/config.js';
import { runScopedCacheIndexReap } from '../scoped-cache/reap-requests.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';

/**
 * Schedule the reap of the scoped cache's index: the members naming entries that
 * expired, which nothing else removes.
 *
 * @returns Whether or not the reap has been scheduled
 */
export default async function schedule(): Promise<boolean> {
	if (!scopedCachePurgeEnabled()) {
		return false;
	}

	const logger = useLogger();
	const reapSchedule = String(useEnv()['CACHE_SCOPED_INDEX_REAP_SCHEDULE']);

	if (!validateCron(reapSchedule)) {
		logger.warn(
			`[scoped-cache] CACHE_SCOPED_INDEX_REAP_SCHEDULE is not a cron rule `
			+ `(${reapSchedule}) — expired entries stay in the index`,
		);

		return false;
	}

	scheduleSynchronizedJob('scoped-cache-index-reap', reapSchedule, async () => {
		// A failed reap leaves members naming nothing, which a purge tests and finds
		// nothing for: a compare, never a stale hit, so the next tick retries it.
		// Skipped while a pass a flush or a boot asked for holds the lock: the
		// next tick walks what this one would have.
		try {
			await runScopedCacheIndexReap();
		}
		catch (error) {
			logger.warn(
				error,
				`[scoped-cache] reaping the index failed: ${error}`,
			);
		}
	});

	return true;
}
