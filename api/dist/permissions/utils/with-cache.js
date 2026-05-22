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
	return (async (arg0, ...args) => {
		arg0 = prepareArg ? prepareArg(arg0) : arg0;
		const key = namespace + "-" + getSimpleHash(JSON.stringify(arg0));
		const cached = await cache.get(key);
		if (cached !== void 0) return cached;
		const res = await handler(arg0, ...args);
		cache.set(key, res);
		return res;
	});
}

//#endregion
export { withCache };