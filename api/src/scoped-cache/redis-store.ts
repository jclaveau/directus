/**
 * The scoped cache's index, held in Redis.
 *
 * Everything Redis-shaped about the index lives here: the Lua the two atomic steps
 * run as, the cursor loops a scan is made of, the chunk sizes a command list is cut
 * to, and the per-command error a pipeline answers with instead of rejecting. What
 * the rest of the module sees is `ScopedCacheStore` — members and counters — so the
 * purge reads the same whichever store answers it.
 */

import {
	useLogger,
} from '../logger/index.js';
import {
	useRedis,
} from '../redis/index.js';
import type { ChainableCommander, Redis } from 'ioredis';
import type {
	ScopedCacheIndexEntry,
	ScopedCacheStore,
	ScopedCacheUnlinkTally,
} from './store.js';

/**
 * How many members one command carries.
 *
 * `SADD`/`SREM` take their members as arguments, and both ioredis and Lua's
 * `unpack` have a stack ceiling well below the number of slices one read can be
 * pinned to. The expiry the call carries is the same value for every chunk, so
 * splitting changes nothing but how many calls it takes.
 */
const SCOPED_CACHE_INDEX_CHUNK_MEMBERS = 500;

/**
 * How many members one `SSCAN` of an index set is asked to look at per round trip.
 *
 * The set is read in pages rather than whole: a collection's bare set holds every
 * cached read that pinned no index value, and `SMEMBERS` on it would put the
 * whole thing in this process's memory — and hold Redis for the length of the
 * reply — to keep the handful the write actually matched.
 */
const SCOPED_CACHE_INDEX_SCAN_COUNT = 1000;

// How many keys a SCAN is asked to look at per round trip. `@keyv/redis` uses 1000
// for the namespace clears that run beside these, and the 250 this replaced bought
// nothing for 4x the round trips: SCAN filters server-side, so the pass costs the
// whole keyspace whatever the COUNT, and only the number of RTTs moves.
const SCOPED_CACHE_SCAN_COUNT = 1000;

// How many keys one delete command is allowed to carry. Redis runs commands one at a
// time, so a single command deleting every key of a full flush holds the server for
// its whole duration — a latency event for every client, not just the caller.
const SCOPED_CACHE_UNLINK_CHUNK = 1000;

/**
 * File a key under a tag set and give that set an expiry that only ever moves OUT.
 *
 * A bare `EXPIRE` overwrites, and a tag set is SHARED by every entry pinned to that
 * slice: lower `CACHE_TTL` at runtime and one short-lived write cuts short the set
 * indexing an entry cached for an hour, leaving that entry unreachable to every
 * purge for the rest of its life. Redis 7 has `EXPIRE … GT`, but GT reads a key
 * carrying no TTL as infinite: it refuses the very first expiry a fresh tag set
 * needs, and cannot tell that set from one deliberately left unbounded. So the
 * comparison runs as a script — atomic, one pipeline slot, and `EXISTS` telling
 * those two apart.
 *
 * A set that already carries NO expiry outlives every entry by construction, so it
 * keeps none — only a freshly created set takes one unconditionally.
 */
export const scopedCacheTagExpiryScript = `
local existed = redis.call('EXISTS', KEYS[1])
redis.call('SADD', KEYS[1], unpack(ARGV, 2))
local want = tonumber(ARGV[1])
if existed == 0 then
	redis.call('EXPIRE', KEYS[1], want)
	return 1
end
local ttl = redis.call('TTL', KEYS[1])
if ttl >= 0 and ttl < want then
	redis.call('EXPIRE', KEYS[1], want)
end
return 0
`;

type ScopedCacheTagExpiryCommand = {
	scopedCacheTagExpiry(
		tagKey: string,
		ttlSeconds: number,
		...members: string[]
	): ChainableCommander;
};

type ScopedCacheTagPipeline = ChainableCommander & ScopedCacheTagExpiryCommand;

const clientsCarryingScripts = new WeakSet<Redis>();

/**
 * The shared client, with the tag-expiry script registered as a command on it.
 *
 * `defineCommand` sends `EVALSHA` and replays the body only when Redis answers
 * `NOSCRIPT` — so the 316-byte script crosses the wire once per server rather than
 * once per tag. A read pinned to 200 slices files 402 of these in one pipeline, and
 * as `EVAL` that is 124 KB of Lua per fill against 193 KB sent in total.
 *
 * Registration is per client and idempotent, but `defineCommand` rebuilds the
 * command each time, so the set keeps it to the first call per connection.
 */
function useScriptedRedis(): Redis & ScopedCacheTagExpiryCommand {
	const redis = useRedis();

	if (! clientsCarryingScripts.has(redis)) {
		redis.defineCommand('scopedCacheTagExpiry', {
			numberOfKeys: 1,
			lua: scopedCacheTagExpiryScript,
		});

		clientsCarryingScripts.add(redis);
	}

	return redis as Redis & ScopedCacheTagExpiryCommand;
}

/**
 * Read a set of tag sets, drop them, and prune the slice index that names them — as
 * one step, so no other client can act between any two of those. A read filing its
 * key into one of those sets between the read and the drop would otherwise have that
 * set deleted underneath it, leaving a correct entry indexed by nothing.
 *
 * Members are gathered with a `SMEMBERS` per key and deduped in Lua rather than by
 * `SUNION`: the union has to be built before the sets are dropped anyway, and
 * `unpack`ing a key list into one call overflows Lua's stack.
 *
 * KEYS are the tag sets; ARGV is `sliceIndexKey, tagKey` pairs for the prunings. The
 * counter bumps are NOT in here — they are one pipeline of their own, sent first, so
 * they still land when the sweep behind them is refused.
 */
export const scopedCacheSweepScript = `
local seen = {}
local members = {}

for i = 1, #KEYS do
	local batch = redis.call('SMEMBERS', KEYS[i])

	for j = 1, #batch do
		local member = batch[j]

		if not seen[member] then
			seen[member] = true
			members[#members + 1] = member
		end
	end

	redis.call('UNLINK', KEYS[i])
end

for i = 1, #ARGV, 2 do
	redis.call('SREM', ARGV[i], ARGV[i + 1])
end

return members
`;

/**
 * How many tag sets one sweep call carries.
 *
 * Two bounds, same number. A key list is spread into the `eval` call, and a spread
 * long enough throws `RangeError` before Redis is reached
 * (https://github.com/jclaveau/directus/issues/397) — measured between 125k and 200k
 * arguments. And the script runs as one command, so a longer list is a longer stall
 * for every other client on that server.
 */
const SCOPED_CACHE_SWEEP_CHUNK_KEYS = 500;

/**
 * Delete index keys without stalling the server.
 *
 * `UNLINK` rather than `DEL`: these are SETs, so a delete is O(members) as well as
 * O(keys), and UNLINK does that reclaim on a background thread instead of on the one
 * thread that answers everyone else.
 *
 * Chunked rather than one command, because UNLINK still unlinks synchronously and
 * that part is O(keys). The chunks go in one pipeline — Redis can serve other
 * clients between two commands of a pipeline, but not inside one — so the cost is a
 * single round trip either way.
 */
async function unlinkScopedCacheKeys(
	keys: string[],
): Promise<ScopedCacheUnlinkTally> {
	// `unlink()` with no keys throws, and a flush with nothing to drop is normal.
	if (keys.length === 0) {
		return { dropped: 0, refused: 0 };
	}

	const pipeline = useRedis().pipeline();

	for (let at = 0; at < keys.length; at += SCOPED_CACHE_UNLINK_CHUNK) {
		// Array form, never a spread: this list is a whole-keyspace scan, so it is
		// the longest of them.
		pipeline.unlink(keys.slice(at, at + SCOPED_CACHE_UNLINK_CHUNK));
	}

	const results = await pipeline.exec();
	const tally: ScopedCacheUnlinkTally = { dropped: 0, refused: 0 };

	for (const [error, removed] of results ?? []) {
		if (error) {
			tally.refused += 1;
		}
		else {
			tally.dropped += Number(removed ?? 0);
		}
	}

	return tally;
}

const redisStore: ScopedCacheStore = {
	/**
	 * Scoped purging drives SCAN + multi-key DEL over a single node, so it only
	 * works on a standalone client. A cluster client would silently under-purge —
	 * keys on other nodes are never scanned — and leave stale slices. `useRedis()`
	 * always builds a standalone `Redis` in core, so this only bites a custom
	 * override.
	 */
	assertStoreSupported(): void {
		if (useRedis().isCluster) {
			throw new Error(
				'CACHE_AUTO_PURGE_MODE=scoped is not implemented for Redis cluster '
				+ 'clients (SCAN and multi-key DEL are single-node). Use a standalone '
				+ 'Redis or CACHE_AUTO_PURGE_MODE=full.',
			);
		}
	},

	async addIndexMembers(
		entries: readonly ScopedCacheIndexEntry[],
		ttlSeconds: number,
	): Promise<void> {
		if (entries.length === 0) {
			return;
		}

		const pipeline = useScriptedRedis().pipeline() as ScopedCacheTagPipeline;

		for (const { indexKey, members } of entries) {
			if (ttlSeconds > 0) {
				pipeline.scopedCacheTagExpiry(indexKey, ttlSeconds, ...members);
			}
			else {
				pipeline.sadd(indexKey, ...members);
			}
		}

		// ioredis resolves `[[err, result], …]` and only REJECTS on a connection-level
		// failure: a per-command refusal (maxmemory/noeviction on the `sadd`, a
		// WRONGTYPE) resolves as an entry error. Swallowing it would leave the entry
		// its caller is about to write indexed under nothing, so no purge could ever
		// reach it — surface it and let the caller skip the write.
		const results = await pipeline.exec();

		const failed = results?.find(([error]) => error !== null);

		if (failed) {
			throw failed[0];
		}
	},

	async* scanIndexMembers(
		indexKey: string,
		globPattern: string | null,
	): AsyncGenerator<string[]> {
		const redis = useRedis();
		let scanCursor = '0';

		do {
			const [next, indexedMembers] = globPattern === null
				? await redis.sscan(
					indexKey,
					scanCursor,
					'COUNT',
					SCOPED_CACHE_INDEX_SCAN_COUNT,
				)
				: await redis.sscan(
					indexKey,
					scanCursor,
					'MATCH',
					globPattern,
					'COUNT',
					SCOPED_CACHE_INDEX_SCAN_COUNT,
				);

			scanCursor = next;
			yield indexedMembers;
		}
		while (scanCursor !== '0');
	},

	async removeIndexMembers(
		byIndexKey: ReadonlyMap<string, ReadonlySet<string>>,
	): Promise<void> {
		const redisPipeline = useRedis().pipeline();

		for (const [indexKey, matchedMembers] of byIndexKey) {
			const indexedMembers = [...matchedMembers];

			for (
				let memberAt = 0;
				memberAt < indexedMembers.length;
				memberAt += SCOPED_CACHE_INDEX_CHUNK_MEMBERS
			) {
				redisPipeline.srem(
					indexKey,
					...indexedMembers.slice(
						memberAt,
						memberAt + SCOPED_CACHE_INDEX_CHUNK_MEMBERS,
					),
				);
			}
		}

		// A refused prune leaves members naming keys that are already gone, which the
		// next purge tests and finds nothing for. That costs a compare, never a stale
		// hit, so it is logged rather than thrown into the mutation that triggered it.
		const pipelineResults = await redisPipeline.exec();
		const failedResult = pipelineResults?.find(([error]) => error !== null);

		if (failedResult) {
			useLogger().warn(
				failedResult[0],
				`[scoped-cache] pruning the fingerprint index failed; its members expire `
				+ `with their set: ${failedResult[0]}`,
			);
		}
	},

	/**
	 * `SCAN ... MATCH` filters server-side AFTER iterating, so a pass costs the
	 * whole keyspace however few keys match — but only the matches cross the wire,
	 * which is why the prefix is worth having.
	 *
	 * A single-node SCAN only covers the whole keyspace on a standalone client; a
	 * cluster would miss keys on other nodes, which `assertStoreSupported` refuses
	 * at boot.
	 */
	async* scanIndexKeys(globPattern: string): AsyncGenerator<string[]> {
		const redis = useRedis();
		let cursor = '0';

		do {
			const [next, batch] = await redis.scan(
				cursor,
				'MATCH',
				globPattern,
				'COUNT',
				SCOPED_CACHE_SCAN_COUNT,
			);

			cursor = next;
			yield batch;
		}
		while (cursor !== '0');
	},

	async takeIndexMembers(indexKeys: readonly string[]): Promise<string[]> {
		const redis = useRedis();
		const takenMembers: string[] = [];

		for (
			let at = 0;
			at < indexKeys.length;
			at += SCOPED_CACHE_SWEEP_CHUNK_KEYS
		) {
			const chunk = indexKeys.slice(at, at + SCOPED_CACHE_SWEEP_CHUNK_KEYS);

			const swept = await redis.eval(
				scopedCacheSweepScript,
				chunk.length,
				...chunk,
			) as string[];

			for (const indexedMember of swept) {
				takenMembers.push(indexedMember);
			}
		}

		return takenMembers;
	},

	/**
	 * Batch by batch rather than collecting first: the list a full flush would
	 * collect is the one thing here that grows with the cache, and holding all of
	 * it to delete all of it puts the whole index in this process's heap for no
	 * gain — the deletes are per-batch round trips either way.
	 */
	async dropIndexKeysMatching(
		globPattern: string,
	): Promise<ScopedCacheUnlinkTally> {
		const tally = { dropped: 0, refused: 0 };

		for await (const batch of redisStore.scanIndexKeys(globPattern)) {
			const batchTally = await unlinkScopedCacheKeys(batch);

			tally.dropped += batchTally.dropped;
			tally.refused += batchTally.refused;
		}

		return tally;
	},

	async readCounterValues(
		counterKeys: readonly string[],
	): Promise<(string | null)[] | null> {
		return useRedis()
			.mget([...counterKeys])
			.catch((): null => null);
	},

	async bumpCounterValues(
		counterKeys: readonly string[],
		ttlSeconds: number,
	): Promise<void> {
		const pipeline = useRedis().pipeline();

		for (const counterKey of counterKeys) {
			pipeline.incr(counterKey);
			pipeline.expire(counterKey, ttlSeconds);
		}

		const results = await pipeline.exec();

		// `exec` rejects only on a connection-level failure, so an `INCR` refused on
		// its own — maxmemory with noeviction, a WRONGTYPE — resolves as an entry
		// error. The caller decides what that costs; it must not pass unseen.
		const refused = results?.find(([error]) => error !== null)?.[0];

		if (refused) {
			throw refused;
		}
	},

	onStoreReady(listener: () => void): void {
		// ioredis emits `ready` on the first connect too, so a caller registering at
		// boot is called once for the connection it is already on.
		useRedis().on('ready', listener);
	},
};

/** The scoped cache index as Redis holds it. */
export function redisScopedCacheStore(): ScopedCacheStore {
	return redisStore;
}
