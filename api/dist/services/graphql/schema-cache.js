import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { useEnv } from "@directus/env";
import "graphql";
import { LRUMap } from "mnemonist";

//#region src/services/graphql/schema-cache.ts
const env = useEnv();
const bus = useBus();
const cache = new LRUMap(Number(env["GRAPHQL_SCHEMA_CACHE_CAPACITY"] ?? 100));
bus.subscribe("schemaChanged", () => {
	cache.clear();
});

//#endregion
export { cache };