/**
 * The `withCache` reads still running in this process, by cache key.
 * `clearCache()` empties it, so a call made after a clear queries again
 * instead of waiting for a read that started before it.
 */
export const runningReads = new Map<string, Promise<unknown>>();
