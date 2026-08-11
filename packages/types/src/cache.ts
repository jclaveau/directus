/**
 * A subset of the cache the API can flush independently. `response` is the public
 * query cache; `system` is auto-invalidated on schema change and costly to rebuild;
 * `locks` holds the build-identity fingerprint. Shared here so the published
 * `UtilsService.clearCache` type and the runtime stay a single source of truth.
 */
export type CacheFlushTarget = 'response' | 'system' | 'locks';

/** One bucket of the cache timeseries: outcome counts, two different TTLs, and
 * response-latency percentiles: hit = serve, fill = a cached miss's compute,
 * anomaly = a flagged-uncacheable miss's compute, miss = all misses pooled (the
 * umbrella over fill + anomaly + silently-skipped), both = hits + misses pooled.
 * Shared so the API producer and the app chart can't drift. */
/**
 * How wide a purge reached. `slices` is the resolved value slices a mutation
 * touched; `collection` is the coarse fallback over one whole collection, taken
 * when those values could not be resolved; `namespace` is a non-scoped-mode
 * mutation clearing the entire cache.
 */
export type CachePurgeMode = 'slices' | 'collection' | 'namespace';

export interface CacheTimeseriesBucket {
	t: number; // bucket-start epoch ms
	hits: number;
	misses: number;
	fills: number;
	anomalies: number;
	/** Purge operations in this bucket, every mode pooled. */
	purges: number;
	/**
	 * The subset of `purges` that reached wider than the mutation did — a
	 * `collection` fallback or a whole-`namespace` clear. Counted apart because a
	 * precise purge is the cache working, while these two evict entries nothing
	 * asked to evict, and only they explain a hit ratio falling off a cliff.
	 */
	coarsePurges: number;
	/** Entries those purges deleted — the size of what they took, not their count. */
	purgedEntries: number;
	/**
	 * The longest lifetime STAMPED ON AN ENTRY served in this bucket, as of when that
	 * entry was filled — not the TTL in force. An entry filled under a since-changed
	 * TTL keeps reporting the old value until it expires, so this stays high long
	 * after the config moved. It answers "how long do the entries being served
	 * actually live"; `effectiveTtlMs` answers what the config says.
	 */
	ttlMs: number | null;
	/**
	 * The TTL IN FORCE over this bucket, reconstructed from the `ttl_change` markers.
	 * `null` when the window contains a change but nothing precedes it — the honest
	 * answer, rather than back-filling a later value over a span it did not apply to.
	 *
	 * Accurate only as far as the markers reach: a change whose marker has aged out of
	 * retention reads the same as no change at all, so a flat stretch is not proof the
	 * TTL held — only that nothing retained says otherwise.
	 */
	effectiveTtlMs: number | null;
	hitP50: number | null;
	hitP95: number | null;
	hitP99: number | null;
	fillP50: number | null;
	fillP95: number | null;
	fillP99: number | null;
	anomalyP50: number | null;
	anomalyP95: number | null;
	anomalyP99: number | null;
	missP50: number | null;
	missP95: number | null;
	missP99: number | null;
	bothP50: number | null;
	bothP95: number | null;
	bothP99: number | null;
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
