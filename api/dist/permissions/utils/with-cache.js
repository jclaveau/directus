import { runningReads } from "../running-reads.js";
import { useCache } from "../cache.js";
import { getSimpleHash } from "@directus/utils";

//#region src/permissions/utils/with-cache.ts
/**
* The `pick` parameter can be used to stabilize cache keys, by only using a subset of the available parameters and
* ensuring key order.
*
* If the `pick` function is provided, we pass the picked result to the handler, in order for TypeScript to ensure that
* the function only relies on the parameters that are used for generating the cache key.
*
* @NOTE only uses the first parameter for memoization
*/
function withCache(namespace, handler, prepareArg) {
	const cache = useCache();
	const readThrough = async (key, arg0, args) => {
		const cached = await cache.getWithGeneration(key);
		if (cached.found) return {
			result: cached.value,
			isCurrent: true
		};
		const result = await handler(arg0, ...args);
		return {
			result,
			isCurrent: await cache.setUnlessCleared(key, result, cached.generation)
		};
	};
	return (async (arg0, ...args) => {
		if (prepareArg) arg0 = prepareArg(arg0);
		const key = `${namespace}-${getSimpleHash(JSON.stringify(arg0))}`;
		const runningRead = runningReads.get(key);
		if (runningRead) {
			try {
				const { result, isCurrent } = await runningRead;
				if (isCurrent) return structuredClone(result);
			} catch {}
			return (await readThrough(key, arg0, args)).result;
		}
		const keyRead = readThrough(key, arg0, args);
		runningReads.set(key, keyRead);
		try {
			return structuredClone((await keyRead).result);
		} finally {
			if (runningReads.get(key) === keyRead) runningReads.delete(key);
		}
	});
}

//#endregion
export { withCache };