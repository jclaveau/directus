import type { RestCommand } from '../../types.js';

/** One part of the cache `clearCache` can drop on its own. */
export type CacheFlushTarget = 'response' | 'system' | 'permissions' | 'locks';

/**
 * Clears the given parts of the cache, the response cache when none are given.
 * This endpoint is only available to admin users.
 * @param targets The parts to clear.
 * @returns Nothing
 */
export const clearCache = <Schema>(
	targets: CacheFlushTarget[] = [],
): RestCommand<void, Schema> => {
	const clearPath = '/utils/cache/clear';

	// One `targets=` per target: the API reads a comma-joined value as a single
	// unknown target.
	const targetQuery = new URLSearchParams(
		targets.map((target) => ['targets', target]),
	).toString();

	return () => {
		return {
			method: 'POST',
			path: targetQuery
				? `${clearPath}?${targetQuery}`
				: clearPath,
		};
	};
};
