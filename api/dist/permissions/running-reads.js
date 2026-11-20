//#region src/permissions/running-reads.ts
/**
* The `withCache` reads still running in this process, by cache key.
* `clearCache()` empties it, so a call made after a clear queries again
* instead of waiting for a read that started before it.
*/
const runningReads = /* @__PURE__ */ new Map();

//#endregion
export { runningReads };