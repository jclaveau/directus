//#region src/metrics/lib/instance.ts
/**
* The metrics this process created, once it has.
*
* Held apart from `useMetrics()` so that a module can ask whether metrics exist
* without importing what creating them costs: the registry is prom-client, and
* the services it tracks are the database, the cache, storage and redis — the
* graph of a process that answers `/metrics`, which is not every process a
* deployment runs.
*/
const _cache = { metrics: void 0 };

//#endregion
export { _cache };