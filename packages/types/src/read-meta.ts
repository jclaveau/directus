/**
 * A unit of cache scope. A bare tag (no `field`) covers every entry that read the collection — the
 * coarse bucket holding "global" reads that couldn't be narrowed. A value tag pins a single
 * `field=value` slice so one owner's/partition's writes drop only their own entries.
 */
export interface CacheTag {
	collection: string;
	field?: string;
	value?: unknown;
}

/**
 * Metadata about a read operation, carried alongside its result (see `WithMeta`). Bounded to the
 * single read that produced it — never an accumulating service-level field.
 */
export interface ReadMeta {
	/** Scope tags whose data fed this read (root value slices + relations); scopes cache-tag invalidation. */
	cacheTags: CacheTag[];
}

/**
 * A read result that carries its `ReadMeta` via a non-enumerable `getMeta()`. The metadata rides the
 * value without polluting the payload — invisible to `JSON.stringify`, enumeration, and the wire.
 */
export type WithMeta<T> = T & { getMeta(): ReadMeta };
