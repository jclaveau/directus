/**
 * A unit of cache scope. A collection-level tag (no `field`) covers every entry that
 * read the collection — the coarse bucket holding "global" reads that couldn't be
 * narrowed. A `field`+`value` tag pins a single slice so one owner's/partition's writes
 * drop only their own entries.
 */
export interface ScopedCacheTag {
	collection: string;
	field?: string;
	value?: unknown;
}

/**
 * Metadata about a read operation, carried alongside its result (see `WithMeta`). Bounded to the
 * single read that produced it — never an accumulating service-level field.
 */
export interface ReadMeta {
	/**
	 * Scoped cache tags whose data fed this read (root scope tags + relation collection
	 * tags); scope invalidation.
	 */
	scopedCacheTags: ScopedCacheTag[];
}

/**
 * A read result that carries its `ReadMeta` via a non-enumerable `getMeta()`. The metadata rides the
 * value without polluting the payload — invisible to `JSON.stringify`, enumeration, and the wire.
 */
export type WithMeta<T> = T & { getMeta(): ReadMeta };
