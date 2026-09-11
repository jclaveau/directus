import type { Type } from './fields.js';
import type { PrimaryKey } from './items.js';
/**
 * A unit of cache scope. A collection-level tag (no `field`) covers every entry that
 * read the collection — the coarse bucket holding "global" reads that couldn't be
 * narrowed. A `field`+`value` tag pins a single slice so one owner's/partition's writes
 * drop only their own entries. `type` is the field's schema type, used to canonicalize
 * `value` so a filter value and the native DB row value resolve the same slice.
 */
export interface ScopedCacheTag {
    collection: string;
    field?: string | undefined;
    value?: unknown;
    type?: Type | undefined;
}
/** One tag, or a batch (e.g. `result.getMeta().scopedCacheTags`). */
type ScopedCacheTagInput = ScopedCacheTag | readonly ScopedCacheTag[];
/**
 * Shape of `context.scopedCache` on an `items.read` *filter* hook. Mirrors the
 * `cache.scope` event: scope the cached response TO extra slices it needs, so a
 * later purge of any of them invalidates it. Additive to the framework tags.
 *
 * A declared tag only invalidates the read if a write reproduces its EXACT key — the
 * same field AND the same value canonicalization (pass `type` for a non-string
 * field); else it won't match. The `manuallyPurged`/anomaly check below only covers
 * the coarser "field the collection isn't scoped on" case, not value drift.
 *
 * `manuallyPurged`: assert that a value-slice tag on a field the target collection
 * isn't scoped on is nonetheless reproduced by the author's own `purgeBy`. Without
 * it, such a tag is unautopurgeable — the framework can't invalidate the read on a
 * write to that collection — so the response is left uncached (an
 * `unautopurgeable_scope` anomaly) rather than served stale. True opts out of that.
 * Applies to every tag in the SAME call — pass a reproducible framework tag and a
 * custom unautopurgeable one in separate calls if only one is manuallyPurged.
 */
export interface ScopedCacheScopeHandle {
    scopeTo(tags: ScopedCacheTagInput, options?: {
        manuallyPurged?: boolean;
    }): void;
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
    /**
     * This create was swallowed into a row the payload never named AND nothing was
     * written, so no entry can have gone stale and the take-over needs no purge —
     * neither the coarse fallback nor a slice. Only for a genuinely inert write: a
     * take-over that MOVED the row must declare its slices with `purgeBy` instead,
     * or the old slice serves stale.
     *
     * TODO Silent dedup belongs in the service, not in each consumer's hook. If
     * scalabus ever grows a first-class "create resolves to an existing row"
     * path, it would know the write was inert without being told and this handle
     * becomes dead weight — drop it then rather than carrying both.
     */
    skipPurgeFor(key: PrimaryKey): void;
}
/**
 * Shape of `context.scopedCache` on the *registration* context of a register-type
 * hook/endpoint/operation extension (`ApiExtensionContext`) — the escape hatch for a
 * write done OUTSIDE `ItemsService` (e.g. a raw `knex` bulk update for performance),
 * which gets no automatic scoped purge. Row-based: pass the rows you wrote and the
 * host derives touched per-user slices from the collection's `scopedCacheFields`,
 * then purges this collection's bare tag (global reads) + those slices — sparing
 * every other collection. Scoped purging off (memory store / CI) → falls back to a
 * full `cache.clear()`. No admin gate — a cache-maintenance op on trusted server
 * code, matching `purgeBy`.
 *
 * Each row must carry the collection's primary key and its flat scope fields; a row
 * missing one, or a collection scoped through a relation (a dotted/M2O field whose
 * terminal a raw row can't resolve), degrades to a collection-wide purge (this
 * collection's bare tag + every slice, still sparing others) rather than risk a
 * stale slice. The primary key is required because every collection pins that slice,
 * so a read of a single row depends on it even with no scope field declared.
 *
 * Footgun: a manual purge decouples "what changed" from "what's dropped" — they can
 * silently drift into a stale read, the exact poison scoped cache prevents. Prefer
 * `ItemsService` (auto-purge); reach for this ONLY when you deliberately bypass it.
 *
 * And it is now needed where it once wasn't. A collection declaring no
 * `scopedCacheFields` used to carry ONE tag — its bare collection tag — so any write
 * anywhere in it dropped every cached read of it, and a bypassing write was covered
 * by accident. With the primary key pinned on every collection, a read of row K is
 * dropped only by a purge that names K, so rows you write outside `ItemsService` —
 * or beside the key a create-filter take-over returned — stay cached at their old
 * value unless you hand them here.
 *
 * Sandboxed extensions can't reach the host cache, so this is register-type
 * extensions only.
 */
export interface ScopedCacheExtensionHandle {
    purgeForMutatedRows(collection: string, mutatedRows: Record<string, unknown>[]): Promise<void>;
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
    /** Canonical keys of tags a `scopeTo` marked `manuallyPurged` (anomaly-exempt). */
    manuallyPurgedKeys: Set<string>;
    /** Keys a `skipPurgeFor` declared inert, as strings so `7` and `'7'` agree. */
    purgeSkippedKeys: Set<string>;
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
    /**
     * Tags a read hook scoped this response TO that are unautopurgeable — a value
     * slice on a field the target collection isn't scoped on, not `manuallyPurged`. No
     * write can auto-purge them, so respond.ts must not cache the response; it also
     * lists them as the `unautopurgeable_scope` anomaly detail. Non-empty ⟺ flagged.
     */
    scopedCacheUnautopurgeableTags?: ScopedCacheTag[];
}
/**
 * A read result that carries its `ReadMeta` via a non-enumerable `getMeta()`. The metadata rides the
 * value without polluting the payload — invisible to `JSON.stringify`, enumeration, and the wire.
 */
export type WithMeta<T> = T & {
    getMeta(): ReadMeta;
};
/**
 * A value that may or may not carry the rider, for a consumer that neither needs the
 * meta nor minds it.
 *
 * It costs a check: TypeScript refuses a source sharing no property with a weak
 * target (all-optional, e.g. `Partial<User>`), which is what catches a row from the
 * wrong collection. Declaring `getMeta` supplies that shared property for every read
 * result, so `WithMeta<Permission>` satisfies `MaybeWithMeta<Partial<User>>` too.
 */
export type MaybeWithMeta<T> = T & {
    getMeta?(): ReadMeta;
};
export {};
