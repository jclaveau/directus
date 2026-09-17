import { useEnv } from '@directus/env';

/**
 * Whether this node audits the cache at all. Per node rather than per fleet:
 * the schedule is shared through the settings, so it is this switch that keeps
 * a run — one uncached read per live entry — on the back-office and off the
 * nodes serving traffic.
 */
export function cacheAuditEnabled(): boolean {
	return useEnv()['CACHE_AUDIT_ENABLED'] === true;
}
