/**
 * Metadata about a read operation, carried alongside its result (see `WithMeta`). Bounded to the
 * single read that produced it — never an accumulating service-level field.
 */
export interface ReadMeta {
	/** Collections whose data fed this read (root + relations via fields/filter/sort); scopes cache-tag invalidation. */
	cacheTags: Set<string>;
}

/**
 * A read result that carries its `ReadMeta` via a non-enumerable `getMeta()`. The metadata rides the
 * value without polluting the payload — invisible to `JSON.stringify`, enumeration, and the wire.
 */
export type WithMeta<T> = T & { getMeta(): ReadMeta };
