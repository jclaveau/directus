import type { Type } from './fields.js';
import type { PrimaryKey } from './items.js';

/**
 * One axis a read is pinned to, before it is canonicalized into a fingerprint.
 *
 * `type` is the field's schema type, and it is what makes the pin resolvable: a
 * filter value and the native DB row value spell the same value differently —
 * `TRUE` against `t`, an ISO string against a `Date` — and only the type says they
 * are one. A pin naming no `field` pins nothing, which is what a read that could
 * not be narrowed depends on: the collection, whole.
 */
export interface ScopedCacheScopePin {
	// Built by resolving a field off a payload, so an absent one arrives as an
	// explicit `undefined` rather than a missing key.
	field?: string | undefined;
	value?: unknown;
	type?: Type | undefined;
}

/**
 * One pin, in the collection it is an axis of — what a read resolves a dozen of
 * before they are composed into that collection's fingerprint, and what a row
 * writes one of per scoped field.
 *
 * A pin naming no `field` names the collection whole: the coarse bucket holding
 * the reads that could not be narrowed.
 */
export interface ScopedCacheCollectionPin extends ScopedCacheScopePin {
	collection: string;
}

/**
 * One collection's whole dependency, in one value.
 *
 * A set of tags dies on ANY match, so every extra pin is an extra way to be
 * evicted: a read bounded to `owner=alpha AND method=spaced` is dropped by every
 * write carrying `method=spaced`, whoever owns it. A fingerprint carries the same
 * pins as ONE value, so a write purges it only when the row it wrote satisfies the
 * whole query case.
 *
 * Node holds it open — a collection, the scope it is pinned to and the fields its
 * view is built from — so every consumer reads a pin off an object instead of
 * re-parsing a string. Redis holds it serialised
 * as `<collection>:&<key>=,<v>,&…`, where the wrapping commas make a partial
 * fingerprint a well-formed glob. The grammar, the serialiser and the matcher live
 * in the api's `scoped-cache`.
 */
export interface ScopedCacheFingerprint {
	readonly collection: string;
	/**
	 * Field path to the values the read is pinned to. The values of one field are an
	 * OR — what an `_in` means — and the fields together are an AND.
	 *
	 * Empty pins nothing, so there is nothing left to fail and every write to the
	 * collection matches — `{ collection, pinnedScope: {}, viewFields: [] }` is what
	 * a tag naming only a collection said.
	 */
	readonly pinnedScope: Readonly<Record<string, readonly string[]>>;
	/**
	 * The fields the read's view is built from: what it selected, sorted on,
	 * filtered by, grouped or aggregated on, plus the reverse key of every to-many
	 * it descended. Empty names every field: a read that cannot say which columns it
	 * depends on depends on all of them.
	 *
	 * `limit` shapes the view too but names no field, so it is not one of them: it
	 * already varies the cache key, so two page sizes are two entries, and a nested
	 * node cut by a limit gets a bare fingerprint rather than a pin
	 * (`read-plan.ts`) — the rows past the cut are named by nothing.
	 */
	readonly viewFields: readonly string[];
}

/**
 * A fingerprint as a hook spells one: the collection it names, the scope it pins
 * and, for a read's own, the fields its view is built from.
 *
 * Looser than the fingerprint the host builds, in the two ways a declaration is:
 * `pinnedScope` is optional, since naming a collection and nothing else is the
 * whole collection — what a bare tag said; and its values are whatever the hook
 * holds, since the host canonicalizes them against the schema (a `7` and a `'7'`
 * name one slice, and only the column's type says so).
 *
 * `viewFields` is there to be ignored: they say which columns a READ depends on,
 * and no purge reads them. A fingerprint off `getMeta()` carries them, so the field
 * is accepted and dropped — two reads of one slice through different columns are
 * one thing to purge.
 */
export interface ScopedCacheDeclaredFingerprint {
	readonly collection: string;
	readonly pinnedScope?: Readonly<Record<string, readonly unknown[]>>;
	readonly viewFields?: readonly string[];
}

/**
 * One fingerprint, or a batch — `result.getMeta().scopedCacheFingerprints` handed
 * straight back.
 */
export type ScopedCacheFingerprintInput =
	ScopedCacheDeclaredFingerprint | readonly ScopedCacheDeclaredFingerprint[];

/**
 * What a read can depend on through `dependOn`: a read result carrying its meta, a
 * batch of them (`Promise.all`), or `Promise.allSettled`'s verdicts over them. A
 * result is itself an array, so the rider is what tells one lookup from a batch —
 * and a value without one folds nothing and passes through, which is why the type
 * is open rather than the union it describes.
 */
export type ScopedCacheDependency = unknown;

/**
 * Shape of `context.scopedCache` on an `items.read` *filter* hook. Mirrors the
 * `cache.scope` event: scope the cached response TO extra slices it needs, so a
 * later purge of any of them invalidates it. Additive to what the host derived.
 *
 * A declared fingerprint only invalidates the read if a write reproduces its EXACT
 * scope — the same fields AND the same value canonicalization, which the host runs
 * against the schema; else it won't match. The `manuallyPurged`/anomaly check below
 * only covers the coarser "field the collection isn't scoped on" case, not value
 * drift.
 *
 * `manuallyPurged`: assert that a scope on a field the target collection isn't
 * scoped on is nonetheless reproduced by the author's own `purgeBy`. Without it,
 * such a scope is unautopurgeable — the framework can't invalidate the read on a
 * write to that collection — so the response is left uncached (an
 * `unautopurgeable_scope` anomaly) rather than served stale. True opts out of that.
 * Applies to every fingerprint in the SAME call — pass a reproducible one and a
 * custom unautopurgeable one in separate calls if only one is manuallyPurged.
 *
 * It does NOT stand in for `epochs`, and the two answer different questions: this
 * one says a WRITE will reproduce the scope, `epochs` says whether a purge already
 * landed while this read was running. A fingerprint naming a collection with no
 * counter is left uncached whatever this flag says — see `epochs` below.
 */
export interface ScopedCacheScopeHandle {
	scopeTo(
		fingerprints: ScopedCacheFingerprintInput,
		options?: {
			manuallyPurged?: boolean;
			/**
			 * The purge counters the read these fingerprints came from snapshotted
			 * BEFORE its own query — `result.getMeta()?.scopedCacheEpochs` of the
			 * dependent read.
			 *
			 * The host snapshots the counters of the collections it can name up front,
			 * and a hook's declaration arrives long after that, on a collection nothing
			 * snapshotted: a purge of it landing mid-read would then pass the post-fill
			 * comparison unnoticed and the response would be stored already stale.
			 * There is no snapshotting it late — the check needs a value from before
			 * the data was read — so a scoped-to collection with no counter leaves the
			 * response uncached (an `unguarded_scope` anomaly).
			 *
			 * Handing the dependent read's own snapshot over is what keeps it cacheable,
			 * and it is the right value by construction: that read took it before the
			 * rows these fingerprints describe were fetched.
			 */
			epochs?: Record<string, string | null>;
		},
	): void;

	/**
	 * Make this read depend on a lookup it ran: fold the lookup's own fingerprints
	 * AND the purge counters it took before its query into this read, the pair
	 * `scopeTo` needs spelled out. Takes the lookup as returned — still pending,
	 * one, several, or `allSettled` verdicts — and hands it back resolved, so the
	 * call wraps the lookup where it happens:
	 *
	 *   const rows = await context.scopedCache.dependOn(service.readByQuery(query));
	 *
	 * A rejected verdict is passed through untouched; whether it fails the read is
	 * the caller's call. Each fulfilled lookup is folded on its own, so two lookups
	 * of one collection straddling a purge are judged on the earlier counter.
	 *
	 * Nothing here is `manuallyPurged`: a lookup's returned fingerprints are the
	 * ones the host itself derives, which a write to that collection reproduces.
	 */
	dependOn<T extends ScopedCacheDependency>(lookup: T | Promise<T>): Promise<T>;
}

/**
 * Shape of `context.scopedCache` on an `items.create`/`update`/`delete` *filter*
 * hook. Mirrors the `cache.purge` event: purge cached responses BY extra slices this
 * mutation touched. Additive to what the mutation's own rows purge.
 *
 * Only the *filter* hook can purge: on update/delete the purge runs before the
 * action hook, so an action-hook declaration would arrive too late.
 */
export interface ScopedCachePurgeHandle {
	/**
	 * Purge every entry a fingerprint reaches: the entries whose own pinned scope
	 * this one holds of, and — for a fingerprint pinning nothing — the reads of
	 * that collection that could not be narrowed.
	 *
	 * A fingerprint, not a tag, because a set of tags is an OR and the scope a
	 * write touched is an AND: `{ owner: ['alpha'], method: ['spaced'] }` purges
	 * the entries bound to BOTH, where two tags would purge every entry bound to
	 * either. What a read returns is already in this shape, so a hook purging what
	 * a lookup read hands `result.getMeta().scopedCacheFingerprints` over whole.
	 */
	purgeBy(fingerprints: ScopedCacheFingerprintInput): void;
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
 * then purges this collection's bare fingerprint (global reads) + those slices —
 * sparing every other collection. Scoped purging off (memory store / CI) → falls
 * back to a full `cache.clear()`. No admin gate — a cache-maintenance op on
 * trusted server code, matching `purgeBy`.
 *
 * Each row must carry the collection's primary key and its flat scope fields; a row
 * missing one, or a collection scoped through a relation (a dotted/M2O field whose
 * terminal a raw row can't resolve), degrades to a collection-wide purge (this
 * collection's bare fingerprint + every slice, still sparing others) rather than
 * risk a stale slice. The primary key is required because every collection pins
 * that slice, so a read of a single row depends on it even with no scope field
 * declared.
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
	purgeForMutatedRows(
		collection: string,
		mutatedRows: Record<string, unknown>[],
	): Promise<void>;
}

/**
 * A per-operation sink holding what a hook declared through `context.scopedCache`.
 * A batch/upsert parent injects one via
 * `MutationOptions.scopedCacheHookDeclarations` so its children (run with
 * autoPurgeCache off) accumulate into it and the parent drains it once.
 */
export interface ScopedCacheHookDeclarations {
	scope: ScopedCacheScopeHandle;
	purge: ScopedCachePurgeHandle;
	/**
	 * What a read hook declared through `scopeTo`, one query case per declared
	 * fingerprint: its axes, typed off the schema, kept together. Not canonicalized
	 * here — the read composes them with its own query cases, and the composition is
	 * where every value becomes a token.
	 *
	 * Grouped rather than flat because the grouping IS the declaration: a hook
	 * saying `{ owner: ['alpha'], method: ['spaced'] }` depends on the rows holding
	 * both, and a flat list would drop the read on a write to either.
	 */
	scopeQueryCases: ScopedCacheCollectionPin[][];
	/**
	 * What a mutation hook declared through `purgeBy`, canonicalized against the
	 * schema. Canonical already because nothing composes it further: a purge is
	 * answered by the scope alone, where a read's is folded into the fields its
	 * view is built from first.
	 */
	purgeFingerprints: ScopedCacheFingerprint[];
	/** Canonical keys of pins a `scopeTo` marked `manuallyPurged` (anomaly-exempt). */
	manuallyPurgedKeys: Set<string>;
	/**
	 * Purge counters handed over with a `scopeTo`, merged into the read's own so
	 * `respond` can compare a hook-declared collection after the fill. First one
	 * wins per collection: two dependent reads of the same collection straddling a
	 * purge must be judged on the earlier value, the only one that shows it moved.
	 */
	epochs: Record<string, string | null>;
	/** Keys a `skipPurgeFor` declared inert, as strings so `7` and `'7'` agree. */
	purgeSkippedKeys: Set<string>;
	/**
	 * Keys a create-filter take-over returned instead of inserting, as
	 * `collection:key` so a shared parent's children can't collide on `1`.
	 */
	takenOverKeys: Set<string>;
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
	 * One token per way this read matches a collection: the pins that had to hold
	 * TOGETHER and the fields its view is built from, composed. A root filter of
	 * `owner=alpha AND method=spaced` is one fingerprint, an `_or` over those
	 * fields is two, and every collection reached from anywhere else gets its own.
	 *
	 * The whole dependency of the read, and what the fill files it in the index
	 * under.
	 */
	scopedCacheFingerprints: readonly ScopedCacheFingerprint[];

	/**
	 * Fingerprints a read hook scoped this response TO that are unautopurgeable — a
	 * value slice on a field the target collection isn't scoped on, not
	 * `manuallyPurged`. No write can auto-purge them, so respond.ts must not cache
	 * the response; it also names their collection and field as the
	 * `unautopurgeable_scope` anomaly detail. Non-empty ⟺ flagged.
	 */
	scopedCacheUnautopurgeableFingerprints?: ScopedCacheFingerprint[];

	/**
	 * The purge counters of the collections this read depends on, snapshotted BEFORE
	 * its query ran. `respond` re-reads them at fill time: a counter that moved
	 * means a purge landed while the read was in flight, so the rows it holds are
	 * already superseded and the entry it would write could never be invalidated —
	 * its fingerprints were not in the index for that purge to find.
	 */
	scopedCacheEpochs?: Record<string, string | null>;
}

/**
 * A read result that carries its `ReadMeta` via a non-enumerable `getMeta()`. The metadata rides the
 * value without polluting the payload — invisible to `JSON.stringify`, enumeration, and the wire.
 */
export type WithMeta<T> = T & { getMeta(): ReadMeta };

/**
 * A value that may or may not carry the rider, for a consumer that neither needs the
 * meta nor minds it.
 *
 * It costs a check: TypeScript refuses a source sharing no property with a weak
 * target (all-optional, e.g. `Partial<User>`), which is what catches a row from the
 * wrong collection. Declaring `getMeta` supplies that shared property for every read
 * result, so `WithMeta<Permission>` satisfies `MaybeWithMeta<Partial<User>>` too.
 */
export type MaybeWithMeta<T> = T & { getMeta?(): ReadMeta };
