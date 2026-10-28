import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/utils/cache.d.ts
/** One part of the cache `clearCache` can drop on its own. */
type CacheFlushTarget = 'response' | 'system' | 'permissions' | 'locks';
/**
 * Clears the given parts of the cache, the response cache when none are given.
 * This endpoint is only available to admin users.
 * @param targets The parts to clear.
 * @returns Nothing
 */
declare const clearCache: <Schema>(targets?: CacheFlushTarget[]) => RestCommand<void, Schema>;
//#endregion
export { CacheFlushTarget, clearCache };
//# sourceMappingURL=cache.d.cts.map