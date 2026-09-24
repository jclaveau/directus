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
 */
export interface ScopedCacheIndexFiling {
	fingerprint: ScopedCacheFingerprint;
	keys: readonly string[];
	indexPath: string | null;
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

/** One batch of a whole-collection take: what it dropped, and what it named. */
export interface ScopedCacheIndexTake {
	indexKeys: number;
	keys: string[];
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
	 * as the entries then are.
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
	 * Read the cache keys of a whole collection and drop its index, as ONE step per
	 * batch.
	 *
	 * Atomicity is the point: a fill filing its key between a read and a separate
	 * drop would have that filing deleted underneath it, leaving a correct entry
	 * indexed by nothing.
	 *
	 * Keys rather than entries, because this purge drops them whatever query case
	 * filed them — and `indexKeys` beside them, so the caller can report how split
	 * the collection's index was.
	 */
	takeCollectionIndexedKeys(
		collection: string,
	): AsyncGenerator<ScopedCacheIndexTake>;

	/** Drop the whole index, reporting what it cost. */
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
	 * Bump these purge counters and hold each for `ttlSeconds`.
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
