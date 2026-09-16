import { useEnv } from '@directus/env';
import { auditCache } from '../cache-audit.js';
import { useLogger } from '../logger/index.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';

/**
 * A recurring cache audit over real traffic — dev and preview only, since a run
 * costs one uncached read per live entry. Its `stale_entry` and `tag_drift`
 * findings land on the cache dashboard as anomalies, so a missed invalidation
 * shows up without anyone reading a log. Off unless CACHE_AUDIT_SCHEDULE is set.
 */
export default async function schedule(): Promise<boolean> {
	const env = useEnv();
	const logger = useLogger();
	const rule = String(env['CACHE_AUDIT_SCHEDULE'] ?? '');

	if (rule === '') {
		return false;
	}

	if (!validateCron(rule)) {
		logger.warn(
			`[cache-audit] CACHE_AUDIT_SCHEDULE is not a cron rule (${rule}) `
			+ '— the audit stays off',
		);

		return false;
	}

	scheduleSynchronizedJob('cache-audit', rule, async () => {
		try {
			const report = await auditCache();

			const summary = `${report.scanned} entries in ${report.durationMs}ms: `
				+ `${report.counts.stale} stale, ${report.counts.tag_drift} drifted, `
				+ `${report.counts.unreplayable} unreplayable`;

			if (report.counts.stale > 0 || report.counts.tag_drift > 0) {
				logger.warn(`[cache-audit] ${summary}`);
			}
			else {
				logger.info(`[cache-audit] ${summary}`);
			}
		}
		catch (err: any) {
			logger.warn(err, `[cache-audit] run failed. ${err.message}`);
		}
	});

	return true;
}
