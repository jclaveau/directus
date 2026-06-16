import hash from "object-hash";
import { print } from "graphql";

//#region src/services/graphql/utils/dedupe-resolvers.ts
/**
* Builds a stable deduplication key for a GraphQL resolver call by combining
* the field name, a hash of its arguments, and the printed selection set.
* Used to identify structurally identical resolver invocations within a request.
*/
function resolverCacheKey(args, info) {
	const selectionKey = info.fieldNodes[0]?.selectionSet ? print(info.fieldNodes[0].selectionSet) : "";
	return `${info.fieldName}:${hash(args ?? {})}:${selectionKey}`;
}
/**
* Wraps a GraphQL field resolver to deduplicate concurrent calls with identical
* inputs within a single request. The first call stores the Promise in the
* request-scoped `context.cache`; subsequent identical calls return the same
* Promise, preventing redundant async work.
*
* @param resolver - The async resolver to wrap.
* @param overrideKey - Optional fixed key, bypassing the auto-generated key.
*/
function dedupeResolver(resolver, overrideKey) {
	return (source, args, context, info) => {
		const { cache } = context;
		const cacheKey = overrideKey ?? resolverCacheKey(args, info);
		if (!cache.has(cacheKey)) cache.set(cacheKey, resolver(source, args, context, info));
		return cache.get(cacheKey);
	};
}
/**
* Like `dedupeResolver`, but for relational resolvers using the GraphQL Compose
* resolver param convention `{ source, args, context, info }`.
*
* Additionally writes the resolved value to `context.data` after resolution,
* which is required as a workaround for many-to-any (m2a) type handling.
*
* @param resolver - The async relational resolver to wrap.
*/
function dedupeRelationalResolver(resolver) {
	return async ({ source, args, context, info }) => {
		const { cache } = context;
		const cacheKey = resolverCacheKey(args, info);
		if (!cache.has(cacheKey)) cache.set(cacheKey, resolver({
			source,
			args,
			context,
			info
		}));
		const result = await cache.get(cacheKey);
		context.data = result;
		return result;
	};
}

//#endregion
export { dedupeRelationalResolver, dedupeResolver, resolverCacheKey };