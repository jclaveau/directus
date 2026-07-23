import type { Type } from './fields.js';

/**
 * A unit of cache scope. A collection-level tag (no `field`) covers every entry that
 * read the collection — the coarse bucket holding "global" reads that couldn't be
 * narrowed. A `field`+`value` tag pins a single slice so one owner's/partition's writes
 * drop only their own entries. `type` is the field's schema type, used to canonicalize
 * `value` so a filter value and the native DB row value resolve the same slice.
 */
export interface ScopedCacheTag {
	collection: string;
	field?: string;
	value?: unknown;
	type?: Type;
}

/** One tag, or a batch (e.g. `result.getMeta().scopedCacheTags`). */
type ScopedCacheTagInput = ScopedCacheTag | readonly ScopedCacheTag[];

/**
 * Shape of `context.scopedCache` on an `items.read` *filter* hook. Mirrors the
 * `cache.scope` event: scope the cached response TO extra slices it needs, so a
 * later purge of any of them invalidates it. Additive to the framework tags.
 */
export interface ScopedCacheScopeHandle {
	scopeTo(tags: ScopedCacheTagInput): void;
}

/**
 * Shape of `context.scopedCache` on an `items.create`/`update`/`delete` *filter*
 * hook. Mirrors the `cache.purge` event: purge cached responses BY extra slices this
 * mutation touched. Additive to the framework purge tags.
 *
 * Only the *filter* hook can purge: on update/delete the purge runs before the
 * action hook, so an action-hook tag would arrive too late.
 */
export interface ScopedCachePurgeHandle {
	purgeBy(tags: ScopedCacheTagInput): void;
}

/**
 * A per-operation sink collecting tags from `context.scopedCache`. A batch/upsert
 * parent injects one via `MutationOptions.scopedCacheCollector` so its children (run
 * with autoPurgeCache off) accumulate into it and the parent drains it once.
 */
export interface ScopedCacheCollector {
	scope: ScopedCacheScopeHandle;
	purge: ScopedCachePurgeHandle;
	tags: ScopedCacheTag[];
}

/**
 * A relational-path scope field (`enrollment.student.user`): its dotted `field`
 * and the pre-split `segments` the pinner walks down a filter to the terminal value.
 */
export interface ScopedCachePath {
	field: string;
	segments: string[];
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
