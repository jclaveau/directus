/**
 * Where the scoped cache keeps its fingerprint index.
 *
 * Not the cached responses — those live in the response cache, behind `Keyv`,
 * whose store is the `CACHE_STORE` the rest of Directus configures. What is behind
 * this interface is the index a purge walks: one set per query case a read was
 * bound to, holding the keys that case answers for, and the per-collection purge
 * counters a fill rechecks before it stores.
 *
 * Redis is the only store that holds them today, and every command that touches
 * them goes through here, so a second one — an in-process map, a directory of
 * files — is one more implementation rather than a second set of call sites. The
 * operations are named for what the index needs, never for the command that
 * answers them: a member is added, scanned, removed or taken, a key is scanned or
 * dropped, a counter is read or bumped.
 *
 * What an implementation owes the caller, per operation, is in each docblock — it
 * is the part a purge's correctness rests on, and the part a new store is most
 * likely to get wrong.
 */

import { redisScopedCacheStore } from './redis-store.js';

/** One index set and the members a fill files into it. */
export interface ScopedCacheIndexEntry {
	indexKey: string;
	members: readonly string[];
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
	 * File members under their index sets, and hold each set for `ttlSeconds` — an
	 * expiry that only ever moves OUT, since a set is shared by every entry pinned
	 * to that case and the shortest-lived of them must not cut it short. A
	 * `ttlSeconds` of 0 leaves the sets unbounded, as the entries then are.
	 *
	 * THROWS when the store refuses any of it: the caller is about to write the
	 * entry these members point at, and an entry indexed by nothing is reachable
	 * to no purge for the rest of its life.
	 */
	addIndexMembers(
		entries: readonly ScopedCacheIndexEntry[],
		ttlSeconds: number,
	): Promise<void>;

	/**
	 * Read one index set, a page at a time. `globPattern` filters store-side when
	 * the caller knows the shape it wants; `null` reads the whole set.
	 *
	 * Paged rather than whole: a collection's bare set holds every cached read
	 * that pinned no value, and holding all of it in this process to keep the
	 * handful a write matched is what the pages exist to avoid.
	 */
	scanIndexMembers(
		indexKey: string,
		globPattern: string | null,
	): AsyncGenerator<string[]>;

	/**
	 * Drop the members a purge matched from the sets they were found in.
	 *
	 * Best effort, and LOGGED rather than thrown: a member left behind names a key
	 * that is already gone, which costs the next purge a compare and can never
	 * serve a stale hit.
	 */
	removeIndexMembers(
		byIndexKey: ReadonlyMap<string, ReadonlySet<string>>,
	): Promise<void>;

	/** The index keys under `globPattern`, a page at a time. */
	scanIndexKeys(globPattern: string): AsyncGenerator<string[]>;

	/**
	 * Read the members of these index sets and drop the sets, as ONE step.
	 *
	 * Atomicity is the point: a fill filing its key into one of these sets between
	 * a read and a separate drop would have its set deleted underneath it, leaving
	 * a correct entry indexed by nothing.
	 */
	takeIndexMembers(indexKeys: readonly string[]): Promise<string[]>;

	/** Drop every index key under `globPattern`, reporting what it cost. */
	dropIndexKeysMatching(globPattern: string): Promise<ScopedCacheUnlinkTally>;

	/**
	 * The purge counters of these keys, in the order asked, or `null` when the
	 * store could not answer at all — which the caller reads as "no capture
	 * taken", leaving the fill unguarded exactly as it is with no store.
	 */
	readCounterValues(
		counterKeys: readonly string[],
	): Promise<(string | null)[] | null>;

	/**
	 * Bump these purge counters and hold each for `ttlSeconds`.
	 *
	 * THROWS when the store refuses any of it, so the caller can say that the
	 * guard stopped guarding. It cannot stop the sweep behind it — that is what
	 * makes the cache correct — but it must not be silent either.
	 */
	bumpCounterValues(
		counterKeys: readonly string[],
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
