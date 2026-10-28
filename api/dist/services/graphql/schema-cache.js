import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { useEnv } from "@directus/env";
import { AsyncLocalStorage } from "node:async_hooks";
import { LRUMap } from "mnemonist";

//#region src/services/graphql/schema-cache.ts
const env = useEnv();
const bus = useBus();
const cache = new LRUMap(Number(env["GRAPHQL_SCHEMA_CACHE_CAPACITY"] ?? 100));
bus.subscribe("schemaChanged", () => {
	cache.clear();
});
/**
* The service of the request running a schema. A cached schema outlives the
* request that built it, and its resolvers have to read and record through the
* request running them, not through that first one.
*/
const executingService = new AsyncLocalStorage();
/**
* What a schema build hands its resolvers in place of `builder`: every access
* goes to the service running the schema, or to `builder` when none is.
*
* Only reads and writes are forwarded: `in`, `Object.keys` or a spread still see
* `builder`.
*/
function followExecutingService(builder) {
	return new Proxy(builder, {
		get(target, property) {
			const runningService = executingService.getStore() ?? target;
			const value = Reflect.get(runningService, property, runningService);
			if (typeof value === "function" && !Object.hasOwn(runningService, property)) return value.bind(runningService);
			return value;
		},
		set(target, property, value) {
			const runningService = executingService.getStore() ?? target;
			return Reflect.set(runningService, property, value, runningService);
		}
	});
}

//#endregion
export { cache, executingService, followExecutingService };