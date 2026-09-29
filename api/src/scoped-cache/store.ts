/**
 * Where the scoped cache keeps its fingerprint index.
 *
 * Not the cached responses — those live in the response cache, behind `Keyv`,
 * whose store is the `CACHE_STORE` the rest of Directus configures. What is behind
 * this interface is the index a purge walks: the cached entries a collection's
 * reads were filed under, and the per-collection purge counters a fill rechecks
 * before it stores.
 *
 * The interface speaks fingerprints and cache keys, never keys of its own: how the
 * index is laid out — one set per collection or a hundred, how a set is named, how
 * a member is framed, which of them a scan can be narrowed to — is the store's own
 * answer, because it is chosen to fit what that store can filter on. Redis is the
 * only one that holds it today (`redis-store.ts`, where every command and every
 * glob lives), so a second — an in-process map, a directory of files — is one more
 * implementation rather than a second set of call sites.
 *
 * What an implementation owes the caller, per operation, is in each docblock — it
 * is the part a purge's correctness rests on, and the part a new store is most
 * likely to get wrong.
 */

import { redisScopedCacheStore } from './redis-store.js';
import type { ScopedCacheFingerprint } from './fingerprint.js';

/**
 * One cached entry, and the query case a read filed it under.
 *
 * `keys` is the entry and the siblings that go with it — they are dropped
 * together, so they are filed together. `indexPath` is the path that collection's
 * reads are indexed by (`scopedCacheIndexPath`), or `null` when it has none: what
 * a store MAY split its index by, never something a caller reads back.
 * `homePinFields` is that collection's primary key, then its
 * `scoped_cache_fields` in their declared order: what a store may rank the split
 * of a read off the index path by, the first one the read pins winning.
 */
export interface ScopedCacheIndexFiling {
	fingerprint: ScopedCacheFingerprint;
	keys: readonly string[];
	indexPath: string | null;
	homePinFields: readonly string[];
}

/**
 * One entry the index answered with: the query case it was filed under, the cache
 * key it protects, and where the store found it.
 *
 * `location` is the store's own. The caller hands the whole entry back to
 * `removeIndexedEntries` rather than reading it, so nothing outside the store
 * depends on how a member is filed.
 */
export interface ScopedCacheIndexedEntry {
	fingerprint: ScopedCacheFingerprint;
	key: string;
	location: unknown;
}

/**
 * One batch of a whole-collection take: how many index sets it took, the keys
 * they held, and the moved sets the caller releases once those keys are gone. A
 * name whose set was already gone is not a set taken.
 */
export interface ScopedCacheIndexTake {
	indexKeys: number;
	keys: string[];
	sweptKeys: string[];
}

/**
 * What a drop removed, and how many commands the store refused.
 *
 * Both, because a count on its own cannot be told from an index that was already
 * empty — and a refused drop is an index still there
 * (https://github.com/jclaveau/directus/issues/468).
 */
export interface ScopedCacheUnlinkTally {
	dropped: number;
	refused: number;
}

/**
 * What a reap read, how many members it removed from it, how many moved sets it
 * found that no swept index-key set named, and whether it could mark the
 * index-key sets complete: not when a drop started during the pass.
 */
export interface ScopedCacheReapTally {
	indexKeys: number;
	reaped: number;
	strandedSweptKeys: number;
	markedComplete: boolean;
}

export interface ScopedCacheStore {
	/**
	 * Refuse scoped mode at startup on a store that cannot answer for the whole
	 * keyspace. Throws, so the boot fails loudly rather than purging half of it.
	 */
	assertStoreSupported(): void;

	/**
	 * File these entries under the query cases they were read with, and hold the
	 * index for `ttlSeconds` — an expiry that only ever moves OUT, since whatever
	 * holds a filing is shared by every entry filed beside it and the shortest-lived
	 * of them must not cut it short. A `ttlSeconds` of 0 leaves the index unbounded,
	 * as the entries then are — clearing an expiry an earlier filing gave it.
	 *
	 * THROWS when the store refuses any of it: the caller is about to write the
	 * entries these filings name, and an entry indexed by nothing is reachable to no
	 * purge for the rest of its life.
	 */
	fileIndexedEntries(
		filings: readonly ScopedCacheIndexFiling[],
		ttlSeconds: number,
	): Promise<void>;

	/**
	 * The entries a write of these rows has to test, a page at a time.
	 *
	 * Every entry whose fingerprint COULD hold on one of `rowFingerprints` is
	 * answered with; which of them it does hold on is the caller's test. A store is
	 * free to skip what none of the rows can reach — that is what `indexPath` is
	 * for — and never free to skip an entry pinning nothing, which every row
	 * reaches.
	 *
	 * Paged rather than whole: a collection nothing is pinned by holds every cached
	 * read of it, and putting all of that in this process to keep the handful a
	 * write matched is what the pages exist to avoid.
	 */
	scanRowIndexedEntries(
		collection: string,
		rowFingerprints: readonly ScopedCacheFingerprint[],
		indexPath: string | null,
	): AsyncGenerator<ScopedCacheIndexedEntry[]>;

	/**
	 * The entries a DECLARED pin could reach, a page at a time.
	 *
	 * Wider than the row scan by construction: a declared pin matches entries by
	 * what they do NOT pin as much as by what they do, so a store may narrow only on
	 * what every one of `declared` names, and has to answer with the whole
	 * collection otherwise.
	 */
	scanDeclaredIndexedEntries(
		collection: string,
		declared: readonly ScopedCacheFingerprint[],
		indexPath: string | null,
	): AsyncGenerator<ScopedCacheIndexedEntry[]>;

	/** Every entry the collection holds, a page at a time, narrowed by nothing. */
	scanCollectionIndexedEntries(
		collection: string,
	): AsyncGenerator<ScopedCacheIndexedEntry[]>;

	/**
	 * Drop the entries a purge matched from everywhere the store filed them.
	 *
	 * Not only where it found them: a read bounded to a list of values is filed
	 * under each of them, and a write matching one of those values reads only that
	 * one's split. `indexPath` is what the filing was split by, so the store can
	 * name the other splits the same entry went into.
	 *
	 * Best effort, and LOGGED rather than thrown: an entry left in the index names a
	 * cache key that is already gone, which costs the next purge a compare and can
	 * never serve a stale hit.
	 */
	removeIndexedEntries(
		entries: readonly ScopedCacheIndexedEntry[],
		indexPath: string | null,
	): Promise<void>;

	/**
	 * Read the cache keys of a whole collection and drop its index, taking each
	 * part of the index out of every fill's reach before reading it.
	 *
	 * The order is the point: a fill filing its key between a read and a separate
	 * drop would have that filing deleted underneath it, leaving a correct entry
	 * indexed by nothing. Taken out first, the fill files into a fresh one the next
	 * purge reaches.
	 *
	 * Keys rather than entries, because this purge drops them whatever query case
	 * filed them — and `indexKeys` beside them, so the caller can report how split
	 * the collection's index was.
	 */
	takeCollectionIndexedKeys(
		collection: string,
	): AsyncGenerator<ScopedCacheIndexTake>;

	/**
	 * Every set a take moved aside and never released, whichever collection it
	 * swept. A process that dies between its move and its release leaves these
	 * behind, naming entries no write's own sets still reach.
	 */
	takeStrandedSweptIndexKeys(): AsyncGenerator<ScopedCacheIndexTake>;

	/**
	 * Drop the sets a take moved aside. Only once the entries they name are gone:
	 * a set dropped first leaves an entry cached and named by nothing when the
	 * entry drop fails, and the retry of that purge cannot find it.
	 */
	releaseSweptIndexKeys(sweptKeys: string[]): Promise<ScopedCacheUnlinkTally>;

	/**
	 * Remove every member naming an entry the cache no longer holds, from every set
	 * a fill files into. An entry expires on its own, and its members do not: a
	 * set outlives what it names, so without this it grows with every read ever
	 * cached.
	 *
	 * `rawKeyOf` names an entry the way the cache store holds it. `epochKeyOf` is
	 * the purge counter of a collection, bumped in the same step as a removal from
	 * that collection's sets: a fill files its members before it writes its entry,
	 * and one caught in between looks expired. Bumped, it compares its counter
	 * after the write and evicts the entry its members no longer name.
	 *
	 * A moved set no swept index-key set names is named there, for the recovery
	 * to release (`releaseStrandedScopedCacheSweeps`). And every set is named in
	 * its collection's index-key set, so a pass that reaches its end lets the
	 * collection-wide reads trust those sets until the next drop, rather than
	 * SCAN the keyspace — unless a drop started during the pass.
	 */
	reapIndexedEntries(
		rawKeyOf: (key: string) => string,
		epochKeyOf: (collection: string) => string,
		epochTtlSeconds: number,
	): Promise<ScopedCacheReapTally>;

	/**
	 * Drop the whole index, reporting what it cost. The collection-wide reads stop
	 * trusting the index-key sets BEFORE anything is dropped, and THROWS when the
	 * store refuses that: a drop cut short leaves sets those no longer name.
	 */
	dropIndex(): Promise<ScopedCacheUnlinkTally>;

	/**
	 * The purge counters of these keys, in the order asked, or `null` when the
	 * store could not answer at all — which the caller reads as no reading taken,
	 * leaving the fill unguarded exactly as it is with no store.
	 */
	readPurgeEpochs(
		epochKeys: readonly string[],
	): Promise<(string | null)[] | null>;

	/**
	 * Bump these purge counters and hold each for `ttlSeconds`. A counter that is
	 * missing — expired, evicted, flushed — must come back at a value it never held
	 * before, or a read that took the old value compares equal after its fill.
	 *
	 * THROWS when the store refuses any of it, so the caller can say that the
	 * guard stopped guarding. It cannot stop the sweep behind it — that is what
	 * makes the cache correct — but it must not be silent either.
	 */
	bumpPurgeEpochs(
		epochKeys: readonly string[],
		ttlSeconds: number,
	): Promise<void>;

	/**
	 * Run `listener` whenever the store becomes reachable again, including the
	 * first time. What the pending-purge recovery drains on.
	 */
	onStoreReady(listener: () => void): void;
}

/**
 * The store the scoped cache is running on.
 *
 * One store today, picked by nothing: scoped mode is refused unless
 * `CACHE_STORE=redis` (`scopedCachePurgeEnabled`), so the choice this function
 * would make is already made upstream of every caller. It exists so that adding a
 * store is a branch here plus an implementation, and so that no caller holds a
 * client.
 */
export function useScopedCacheStore(): ScopedCacheStore {
	return redisScopedCacheStore();
}
