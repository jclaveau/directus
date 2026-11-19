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

	// `isCurrent` is false when a clear came during the handler: the result may
	// hold what that clear removed, so it is neither stored nor shared. The
	// generation comes back with the miss, in the same round trip.
	const readThrough = async (key: string, arg0: Arg0, args: any[]) => {
		const cached = await cache.getWithGeneration<R>(key);

		if (cached.found) {
			return { result: cached.value, isCurrent: true };
		}

		const result = await handler(arg0, ...args);

		return {
			result,
			isCurrent: await cache.setUnlessCleared(key, result, cached.generation),
		};
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

		const runningRead = runningReads.get(key) as
			| Promise<{ result: R; isCurrent: boolean }>
			| undefined;

		// The read runs on the first caller's context, which can be a transaction
		// that already failed: that error is the first caller's, so read anew.
		if (runningRead) {
			try {
				const { result, isCurrent } = await runningRead;

				if (isCurrent) {
					return structuredClone(result);
				}
			}
			catch {
				// read anew below
			}

			return (await readThrough(key, arg0, args)).result;
		}

		const keyRead = readThrough(key, arg0, args);
		runningReads.set(key, keyRead);

		try {
			return structuredClone((await keyRead).result);
		}
		finally {
			// A clear made during this read may have let a newer one take the key.
			if (runningReads.get(key) === keyRead) {
				runningReads.delete(key);
			}
		}
	}) as F;
}
