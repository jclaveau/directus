/**
 * A subset of the cache the API can flush independently. `response` is the public
 * query cache; `system` is auto-invalidated on schema change and costly to rebuild;
 * `locks` holds the build-identity fingerprint. Shared here so the published
 * `UtilsService.clearCache` type and the runtime stay a single source of truth.
 */
export type CacheFlushTarget = 'response' | 'system' | 'locks';
