import { getSimpleHash } from '@directus/utils';
import { useCache } from '../cache.js';
import { runningReads } from '../running-reads.js';

/**
 * The `pick` parameter can be used to stabilize cache keys, by only using a subset of the available parameters and
 * ensuring key order.
 *
 * If the `pick` function is provided, we pass the picked result to the handler, in order for TypeScript to ensure that
 * the function only relies on the parameters that are used for generating the cache key.
 *
 * @NOTE only uses the first parameter for memoization
 */
export function withCache<F extends (arg0: Arg0, ...args: any[]) => R, R, Arg0 = Parameters<F>[0]>(
	namespace: string,
	handler: F,
	prepareArg?: (arg0: Arg0) => Arg0,
) {
	const cache = useCache();

	const readThrough = async (key: string, arg0: Arg0, args: any[]) => {
		const cached = await cache.get(key);

		if (cached !== undefined) {
			return cached as R;
		}

		const res = await handler(arg0, ...args);

		cache.set(key, res);

		return res;
	};

	// A call made while another one in this process reads the same key waits
	// for that read instead of querying a second time; a peer process still
	// queries on its own. Each caller gets its own copy, as a cache read does:
	// a caller changing its result must not change another's.
	return (async (arg0: Arg0, ...args: any[]) => {
		if (prepareArg) {
			arg0 = prepareArg(arg0);
		}

		const key = `${namespace}-${getSimpleHash(JSON.stringify(arg0))}`;
		const runningRead = runningReads.get(key) as Promise<R> | undefined;

		// The read runs on the first caller's context, which can be a transaction
		// that already failed: that error is the first caller's, so read anew.
		if (runningRead) {
			try {
				return structuredClone(await runningRead);
			}
			catch {
				return readThrough(key, arg0, args);
			}
		}

		const keyRead = readThrough(key, arg0, args);
		runningReads.set(key, keyRead);

		try {
			return structuredClone(await keyRead);
		}
		finally {
			// A clear made during this read may have let a newer one take the key.
			if (runningReads.get(key) === keyRead) {
				runningReads.delete(key);
			}
		}
	}) as F;
}
