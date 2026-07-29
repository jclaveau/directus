/**
 * A subset of the cache the API can flush independently. `response` is the public
 * query cache; `system` is auto-invalidated on schema change and costly to rebuild;
 * `locks` holds the build-identity fingerprint. Shared here so the published
 * `UtilsService.clearCache` type and the runtime stay a single source of truth.
 */
export type CacheFlushTarget = 'response' | 'system' | 'locks';

/** One bucket of the cache timeseries: outcome counts, the effective TTL, and
 * response-latency percentiles: hit = serve, fill = a cached miss's compute,
 * anomaly = a flagged-uncacheable miss's compute, miss = all misses pooled (the
 * umbrella over fill + anomaly + silently-skipped), both = hits + misses pooled.
 * Shared so the API producer and the app chart can't drift. */
export interface CacheTimeseriesBucket {
	t: number; // bucket-start epoch ms
	hits: number;
	misses: number;
	fills: number;
	anomalies: number;
	ttlMs: number | null;
	hitP50: number | null;
	hitP95: number | null;
	fillP50: number | null;
	fillP95: number | null;
	anomalyP50: number | null;
	anomalyP95: number | null;
	missP50: number | null;
	missP95: number | null;
	bothP50: number | null;
	bothP95: number | null;
}

/** A plotted config change — a TTL edit or a flush — shown as a chart marker. */
export interface CacheConfigEvent {
	time: number;
	kind: 'ttl_change' | 'flush';
	detail: string | null;
}

/** The full cache timeseries payload: dense buckets, config markers, and the TTL in
 * force (override, else env default) for the page's TTL input placeholder. */
export interface CacheTimeseries {
	buckets: CacheTimeseriesBucket[];
	markers: CacheConfigEvent[];
	effectiveTtl: string | null;
}
