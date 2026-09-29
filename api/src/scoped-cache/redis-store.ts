/**
 * The scoped cache's index, held in Redis.
 *
 * Everything Redis-shaped about the index lives here: how a set is named and what
 * segment it sits under, how a member is framed, the globs a keyspace scan is
 * narrowed by, the Lua the atomic steps run as, the cursor loops a scan is made
 * of, the chunk sizes a command list is cut to, and the per-command error a pipeline
 * answers with instead of rejecting. All of it is written to fit what Redis can
 * filter on — a key is a key, a member is a string, and both are selected by glob
 * — so none of it is a shape another store would inherit.
 *
 * What the rest of the module sees is `ScopedCacheStore`: fingerprints and cache
 * keys, so the purge reads the same whichever store answers it.
 */

import { useEnv } from '@directus/env';
import { randomUUID } from 'node:crypto';
import {
	useLogger,
} from '../logger/index.js';
import {
	useCacheRedis,
} from '../redis/index.js';
import type { ChainableCommander, Redis } from 'ioredis';
import {
	escapeScopedCacheFingerprintGlob,
	escapeScopedCacheFingerprintPinKey,
	escapeScopedCacheFingerprintToken,
	indexOfUnescaped,
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	type ScopedCacheFingerprint,
} from './fingerprint.js';
import type {
	ScopedCacheIndexedEntry,
	ScopedCacheIndexFiling,
	ScopedCacheIndexTake,
	ScopedCacheReapTally,
	ScopedCacheStore,
	ScopedCacheUnlinkTally,
} from './store.js';

const env = useEnv();

/**
 * How many members one command carries.
 *
 * `SADD`/`SREM` take their members as arguments, and both ioredis and Lua's
 * `unpack` have a stack ceiling well below the number of index sets one read can be
 * filed under. The expiry the call carries is the same value for every chunk, so
 * splitting changes nothing but how many calls it takes.
 */
const SCOPED_CACHE_INDEX_CHUNK_MEMBERS = 500;

/**
 * How many members one `SSCAN` of an index set is asked to look at per round trip.
 *
 * The set is read in pages rather than whole: a collection's bare set holds every
 * cached read that pinned nothing, and one home pin's set every read filed under
 * that value, and `SMEMBERS` on either would put the whole thing in this process's
 * memory — and hold Redis for the length of the reply — to keep the handful the
 * write actually matched.
 */
const SCOPED_CACHE_INDEX_SCAN_COUNT = 1000;

/**
 * How many sets one round of a row scan reads at once.
 *
 * A write reads one set per value its rows carry, so a batch of rows is hundreds of
 * sets, most of them missing or small. They are sent together rather than one after
 * another, and the bound keeps the replies in flight — up to a page of each — from
 * growing with the batch.
 */
const SCOPED_CACHE_INDEX_SCAN_SETS = 100;

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
 * File members into one collection's fingerprint index sets, give each set an
 * expiry that only ever moves OUT, and name in the collection's index-key set
 * every set this call files into.
 *
 * A bare `EXPIRE` overwrites, and an index set is SHARED by every entry filed into
 * it: lower `CACHE_TTL` at runtime and one short-lived write cuts short the set
 * indexing an entry cached for an hour, leaving that entry unreachable to every
 * purge for the rest of its life. Redis 7 has `EXPIRE … GT`, but GT reads a key
 * carrying no TTL as infinite: it refuses the very first expiry a fresh index set
 * needs, and cannot tell that set from one deliberately left unbounded. So the
 * comparison runs here, with `TTL` telling those two apart. A set that already
 * carries NO expiry outlives every entry by construction, so it keeps none.
 *
 * Every set of the call is named, not only the ones it creates: a set can exist
 * while its name is gone — a flush dropping the index-key set after a fill
 * recreated the set, a flush that failed partway, a node of an older build
 * pushing a set's expiry past the index-key set's, an eviction — and a
 * collection-wide purge reads only the index-key set. The names are already
 * this call's keys, so naming them all sends nothing more; a set this call
 * does not file into stays unnamed until the reap finds it.
 *
 * Named before any set is filed, and the index-key set's expiry moved before
 * any set's: a script that fails partway then leaves a name ahead of its set,
 * which a prune drops, never a set nothing names. The index-key set outlives
 * every set it names: its expiry moves out to this call's, and past each set
 * kept longer, or it keeps none while one of them does. `TTL` rounds to the
 * second, so a set kept at least this call's expiry counts one second more.
 *
 * KEYS[1] is the index-key set and the rest the index sets. ARGV[1] is the
 * expiry in seconds, `0` for none — the entries then never expire, so neither
 * may a set filed while a TTL was in force — then for each index set in order
 * how many members it takes followed by them. Answers with how many names it
 * added.
 */
export const scopedCacheIndexFileScript = `
local want = tonumber(ARGV[1])
local unbounded = want <= 0
local longest = want * 1000
local lefts = {}

for i = 2, #KEYS do
	local left = redis.call('TTL', KEYS[i])
	lefts[i] = left
	if left == -1 then
		unbounded = true
	elseif left >= want then
		longest = math.max(longest, (left + 1) * 1000)
	end
end

local held = redis.call('PTTL', KEYS[1])
local named = redis.call('SADD', KEYS[1], unpack(KEYS, 2))
if unbounded then
	if held >= 0 then
		redis.call('PERSIST', KEYS[1])
	end
elseif held == -2 or (held >= 0 and held < longest) then
	redis.call('PEXPIRE', KEYS[1], longest)
end

local at = 2
for i = 2, #KEYS do
	local count = tonumber(ARGV[at])
	if count > 0 then
		redis.call('SADD', KEYS[i], unpack(ARGV, at + 1, at + count))
	end
	at = at + count + 1
	if want <= 0 then
		if lefts[i] >= 0 then
			redis.call('PERSIST', KEYS[i])
		end
	elseif lefts[i] == -2 or (lefts[i] >= 0 and lefts[i] < want) then
		redis.call('EXPIRE', KEYS[i], want)
	end
end

return named
`;

/**
 * Bump purge counters, creating a missing one at the server's clock in
 * microseconds rather than at `0`.
 *
 * A counter recreated at `1` repeats the value it may have held before it expired
 * or was evicted: a read that took `1` before its query, then a purge recreating
 * the counter at `1`, compares equal after the fill and keeps rows that purge
 * superseded. A seed from `TIME` never repeats a value read before: matching one
 * would take a bump per microsecond for the counter's whole life. Redis's own
 * clock, so a skewed API node cannot seed one in the past, and one script, so the
 * counter cannot expire between the seed and its `INCR`.
 *
 * Sixteen digits, under 2^53, so `earlierScopedCacheEpoch` still compares them as
 * numbers exactly.
 *
 * KEYS are the counters, ARGV[1] how many seconds each is held.
 */
export const scopedCacheEpochBumpScript = `
local now = redis.call('TIME')
local seed = now[1] .. string.format('%06d', tonumber(now[2]))

for i = 1, #KEYS do
	redis.call('SET', KEYS[i], seed, 'NX')
	redis.call('INCR', KEYS[i])
	redis.call('EXPIRE', KEYS[i], ARGV[1])
end

return #KEYS
`;

/**
 * Remove the members of one index set whose entry Redis no longer holds, and bump
 * the purge counter of the collection the set belongs to when it removes any.
 *
 * One script, because the check and the removal must not be split by a fill: a
 * fill files its members BEFORE it writes its entry, so one caught between the
 * two looks expired here. With the bump in the same step, that fill either took
 * its counter before this ran — and finds it moved after its write, so it evicts
 * the entry this just unnamed — or took it after, and files its members after
 * this removed them.
 *
 * The counter is seeded the way `scopedCacheEpochBumpScript` seeds it, for the
 * same reason. `SREM` never creates a set, so one a sweep moved away meanwhile
 * stays gone.
 *
 * KEYS are the set and the counter, ARGV[1] how many seconds the counter is
 * held, then each member followed by the raw key of the entry it names.
 */
export const scopedCacheIndexReapScript = `
local gone = {}

for i = 2, #ARGV, 2 do
	if redis.call('EXISTS', ARGV[i + 1]) == 0 then
		gone[#gone + 1] = ARGV[i]
	end
end

if #gone == 0 then
	return 0
end

local now = redis.call('TIME')
local seed = now[1] .. string.format('%06d', tonumber(now[2]))

redis.call('SET', KEYS[2], seed, 'NX')
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[1])
redis.call('SREM', KEYS[1], unpack(gone))

return #gone
`;

/**
 * Name index sets in their collection's index-key set, and give that set an
 * expiry that only ever moves out, past `ARGV[1]` milliseconds — or none, for
 * `-1`.
 *
 * The index-key set is how a collection-wide purge finds a collection's sets
 * without a keyspace SCAN, so it must outlive every set it names: a set it
 * lost holds entries no collection-wide purge reaches. Milliseconds rather
 * than the index script's seconds, because `TTL` rounds: an index-key set
 * 0.4 s short of the wanted expiry reads as not short, and would expire that
 * long before a set filed beside it.
 *
 * KEYS[1] is the index-key set, ARGV[1] the expiry and the rest the set names.
 */
export const scopedCacheCollectionIndexKeysRegisterScript = `
local existed = redis.call('EXISTS', KEYS[1])
redis.call('SADD', KEYS[1], unpack(ARGV, 2))
local want = tonumber(ARGV[1])
if want < 0 then
	redis.call('PERSIST', KEYS[1])
	return existed
end
local ttl = redis.call('PTTL', KEYS[1])
if existed == 0 or (ttl >= 0 and ttl < want) then
	redis.call('PEXPIRE', KEYS[1], want)
end
return existed
`;

/**
 * Drop from an index-key set the names whose set Redis no longer holds, and
 * answer with the ones it still does.
 *
 * One script, because a name may only leave the index-key set while its set
 * is missing: a check and a separate `SREM` let a fill recreate the set in
 * between, and the removal then leaves a set holding members that no
 * index-key set names. Inside one script, a fill either lands first — the set
 * exists, the name stays — or after, and names its set again itself, since it
 * names every set it files into.
 *
 * KEYS[1] is the index-key set and the rest the names to check.
 */
export const scopedCacheCollectionIndexKeysPruneScript = `
local live = {}
local gone = {}

for i = 2, #KEYS do
	if redis.call('EXISTS', KEYS[i]) == 1 then
		live[#live + 1] = KEYS[i]
	else
		gone[#gone + 1] = KEYS[i]
	end
end

if #gone > 0 then
	redis.call('SREM', KEYS[1], unpack(gone))
end

return live
`;

type ScopedCacheIndexFileCommand = {
	scopedCacheIndexFile(
		keyCount: number,
		...keysThenFilings: Array<string | number>
	): ChainableCommander;
};

type ScopedCacheCollectionIndexKeysRegisterCommand<Answer> = {
	scopedCacheCollectionIndexKeysRegister(
		collectionIndexKeysKey: string,
		expiryMilliseconds: number,
		...indexKeys: string[]
	): Answer;
};

type ScopedCacheIndexPipeline = ChainableCommander & ScopedCacheIndexFileCommand;

/** The index sets one `scopedCacheIndexFile` call files, with their members. */
type ScopedCacheIndexFileCall = {
	indexKeys: string[];
	filingArguments: Array<string | number>;
};

type ScopedCacheCollectionIndexKeysPruneCommand = {
	scopedCacheCollectionIndexKeysPrune(
		keyCount: number,
		collectionIndexKeysKey: string,
		...indexKeys: string[]
	): Promise<string[]>;
};

type ScopedCacheEpochBumpCommand = {
	scopedCacheEpochBump(
		epochKeyCount: number,
		...epochKeysThenTtl: Array<string | number>
	): Promise<number>;
};

type ScopedCacheIndexReapCommand = {
	scopedCacheIndexReap(
		indexKey: string,
		epochKey: string,
		epochTtlSeconds: number,
		...membersAndRawKeys: string[]
	): Promise<number>;
};

type ScopedCacheScriptedRedis = Redis
	& ScopedCacheIndexFileCommand
	& ScopedCacheEpochBumpCommand
	& ScopedCacheIndexReapCommand
	& ScopedCacheCollectionIndexKeysPruneCommand
	& ScopedCacheCollectionIndexKeysRegisterCommand<Promise<number>>;

const clientsCarryingScripts = new WeakSet<Redis>();

/**
 * The shared client, with the index-filing and counter-bump scripts registered as
 * commands on it.
 *
 * `defineCommand` sends `EVALSHA` and replays the body only when Redis answers
 * `NOSCRIPT` — so the index-filing script crosses the wire once per server rather
 * than once per fill.
 *
 * Registration is per client and idempotent, but `defineCommand` rebuilds the
 * command each time, so the set keeps it to the first call per connection.
 */
function useScriptedRedis(): ScopedCacheScriptedRedis {
	const redis = useCacheRedis();

	if (! clientsCarryingScripts.has(redis)) {
		redis.defineCommand('scopedCacheIndexFile', {
			lua: scopedCacheIndexFileScript,
		});

		redis.defineCommand('scopedCacheEpochBump', {
			lua: scopedCacheEpochBumpScript,
		});

		redis.defineCommand('scopedCacheIndexReap', {
			numberOfKeys: 2,
			lua: scopedCacheIndexReapScript,
		});

		redis.defineCommand('scopedCacheCollectionIndexKeysRegister', {
			numberOfKeys: 1,
			lua: scopedCacheCollectionIndexKeysRegisterScript,
		});

		redis.defineCommand('scopedCacheCollectionIndexKeysPrune', {
			lua: scopedCacheCollectionIndexKeysPruneScript,
		});

		clientsCarryingScripts.add(redis);
	}

	return redis as ScopedCacheScriptedRedis;
}

/**
 * Move a batch of fingerprint index sets aside, each under a key no fill writes to,
 * so the sweep reads what they held while every later filing lands in a fresh set.
 * A read filing its key into a set between a read of it and a separate drop would
 * otherwise have that set deleted underneath it, leaving a correct entry indexed by
 * nothing.
 *
 * `RENAME` rather than reading the sets in here: a rename is O(1) whatever the set
 * holds, and a script is one command — one reading a set whole holds Redis for
 * every client until the last member is copied, and a collection's bare set holds
 * every read of it that pinned no index value. The moved sets are read afterwards
 * in pages, outside any script.
 *
 * The name leaves the collection's index-key set in the same step, and the
 * moved set is named in the swept index-key set, so no moment exists where a
 * set holding members is named by neither: the recovery of a sweep that dies
 * here reads the swept index-key set, and a fill recreating the set afterwards
 * names it again itself.
 *
 * KEYS are the collection's index-key set, the swept index-key set, then the
 * index sets; ARGV[1] is the prefix each is moved under. Answers with the keys
 * it moved to: a set that expired since the index-key set named it has nothing
 * to move, and `RENAME` refuses a missing key.
 *
 * No expiry of its own: `RENAME` carries the set's, and a set's expiry only ever
 * moves out past every entry filed in it. So a set a failed sweep leaves behind
 * outlives every entry it names, and the next sweep of the collection still finds
 * it — a shorter hold would leave those entries cached and named by nothing.
 *
 * The counter bumps are NOT in here — they are a script of their own, sent first,
 * so they still land when the sweep behind them is refused.
 */
export const scopedCacheSweepMoveScript = `
local moved = {}

for i = 3, #KEYS do
	if redis.call('EXISTS', KEYS[i]) == 1 then
		local sweptKey = ARGV[1] .. (i - 2)
		redis.call('RENAME', KEYS[i], sweptKey)
		redis.call('SADD', KEYS[2], sweptKey)
		moved[#moved + 1] = sweptKey
	end
	redis.call('SREM', KEYS[1], KEYS[i])
end

return moved
`;

/**
 * How many index sets one sweep call carries.
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

	const pipeline = useCacheRedis().pipeline();

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

/**
 * The pin naming nothing, whose set every write to the collection reads.
 */
const SCOPED_CACHE_BARE_PIN = '';

/**
 * The segment a home pin's sets sit under, beside the index path's. An index path
 * is a field path, which never carries a colon, so no index value's set is spelled
 * like a home pin's.
 */
const SCOPED_CACHE_HOME_PIN = 'pin:';

/**
 * The segment every key the scoped cache writes sits under, so the full-flush scan
 * can ask Redis for exactly them. `<namespace>:` alone is shared with the
 * cache-stats stream, its per-entry tombstones and whatever family lands there
 * next, and a pattern wide enough to cover the index dragged all of those over the
 * wire to be filtered out here (https://github.com/jclaveau/directus/issues/468).
 * Named after the feature rather than `index`, because a flush unlinks the whole
 * segment: under a noun that broad, whatever a later feature parks there goes with
 * it. `<namespace>:stats` is the family that must not — it is the only place Redis
 * holds cache state no table can rebuild — and it stays outside.
 */
function scopedCacheIndexPrefix(): string {
	return `${env['CACHE_NAMESPACE']}:scoped-cache-index:`;
}

/**
 * The prefix as a SCAN pattern opens it. The namespace is the operator's to
 * pick, and one holding a `*`, `?` or `[` would match other namespaces' sets —
 * which a flush then unlinks.
 */
function scopedCacheIndexGlobPrefix(): string {
	return escapeScopedCacheFingerprintGlob(scopedCacheIndexPrefix());
}

/**
 * The key of the set a fingerprint is filed in, and of the set a write reads back.
 *
 * One set per collection would work and is what correctness asks for: every
 * fingerprint of that collection is tested against every row written to it. It is
 * the SIZE that does not work — a collection holding a million cached reads is a
 * million members to walk per written row. So the set is split by the one pin a
 * read of a scoped collection almost always carries, and a write always knows: the
 * row's value at the index path. A write then reads its own set and the bare one,
 * and never sees a fingerprint filed under somebody else's value.
 *
 * The split is an optimisation, never a bound: a fingerprint pinning nothing at
 * that path is filed under its home pin (`scopedCacheHomePin`), and one pinning
 * nothing at all goes bare, which every write to the collection reads.
 *
 * `indexPin` is what the split is keyed by — `<path>=<value>`,
 * `pin:<pinKey>=<value>` for a home pin, or empty for the bare set. It never
 * leaves this file: a caller asks the store for the entries it has to test, not
 * for the sets holding them.
 */
function scopedCacheIndexKey(collection: string, indexPin: string): string {
	return `${scopedCacheIndexPrefix()}fingerprint:${collection}:${indexPin}`;
}

/**
 * Where one sweep moves the sets it takes: outside `fingerprint:`, so no fill
 * reaches them, and inside the prefix, so a full flush still drops one a failed
 * sweep left behind. One per sweep call, so two sweeps of the same collection
 * never move onto each other's keys.
 */
function scopedCacheSweptIndexKeyPrefix(collection: string): string {
	return `${scopedCacheIndexPrefix()}swept:${collection}:${randomUUID()}:`;
}

/**
 * The set naming every index set of one collection, so a collection-wide purge
 * reads its sets from here instead of a SCAN of the whole keyspace.
 *
 * Outside `fingerprint:` and `swept:` so neither family's glob reaches it, and
 * inside the prefix so a full flush drops it with the sets it names. A name
 * enters it in every fill of its set and in the reap, leaves it only while its
 * set is missing or being moved aside, and its expiry is never shorter than a
 * named set's.
 */
function scopedCacheCollectionIndexKeysKey(collection: string): string {
	return `${scopedCacheIndexPrefix()}collection-index-keys:${collection}`;
}

/**
 * The set naming every moved set not released yet, whichever collection's. No
 * expiry: it holds only what a sweep is between moving and releasing, or what a
 * dead one left for the recovery to release.
 */
function scopedCacheSweptIndexKeysKey(): string {
	return `${scopedCacheIndexPrefix()}swept-index-keys`;
}

/**
 * Every moved set the swept index-key set names under `sweptGlob`, or all of
 * them, with the entry keys each names. Nothing is moved here: these sets were
 * taken by a sweep before, and only need their entries dropped and then
 * releasing. A name whose set is gone reads as empty and is released like the
 * others.
 */
async function* takeSweptIndexKeys(
	sweptGlob: string | null,
): AsyncGenerator<ScopedCacheIndexTake> {
	const redis = useCacheRedis();
	const sweptIndexKeysKey = scopedCacheSweptIndexKeysKey();
	let scanCursor = '0';

	do {
		const [next, sweptKeys] = sweptGlob === null
			? await redis.sscan(
				sweptIndexKeysKey,
				scanCursor,
				'COUNT',
				SCOPED_CACHE_INDEX_SCAN_COUNT,
			)
			: await redis.sscan(
				sweptIndexKeysKey,
				scanCursor,
				'MATCH',
				sweptGlob,
				'COUNT',
				SCOPED_CACHE_INDEX_SCAN_COUNT,
			);

		scanCursor = next;
		const keys: string[] = [];

		for (const sweptKey of sweptKeys) {
			await collectSweptIndexKeys(sweptKey, keys);
		}

		yield { indexKeys: sweptKeys.length, keys, sweptKeys };
	}
	while (scanCursor !== '0');
}

/**
 * The sets one collection's index-key set names that still exist, a page at a time,
 * dropping from it the names of those that are gone. `nameGlob` narrows the
 * names read, and only those are pruned.
 */
async function* scanCollectionIndexKeys(
	collectionIndexKeysKey: string,
	nameGlob: string | null = null,
): AsyncGenerator<string[]> {
	const redis = useScriptedRedis();
	let scanCursor = '0';

	do {
		const [next, indexKeys] = nameGlob === null
			? await redis.sscan(
				collectionIndexKeysKey,
				scanCursor,
				'COUNT',
				SCOPED_CACHE_INDEX_SCAN_COUNT,
			)
			: await redis.sscan(
				collectionIndexKeysKey,
				scanCursor,
				'MATCH',
				nameGlob,
				'COUNT',
				SCOPED_CACHE_INDEX_SCAN_COUNT,
			);

		scanCursor = next;

		for (
			let at = 0;
			at < indexKeys.length;
			at += SCOPED_CACHE_SWEEP_CHUNK_KEYS
		) {
			const chunk = indexKeys.slice(at, at + SCOPED_CACHE_SWEEP_CHUNK_KEYS);

			yield await redis.scopedCacheCollectionIndexKeysPrune(
				chunk.length + 1,
				collectionIndexKeysKey,
				...chunk,
			);
		}
	}
	while (scanCursor !== '0');
}

/**
 * The glob matching every set a sweep of one collection moved aside and has not
 * released yet — bounded by its trailing colon the way the collection's own glob
 * is.
 */
export function scopedCacheSweptIndexGlob(collection: string): string {
	const matched = escapeScopedCacheFingerprintGlob(collection);

	return `${scopedCacheIndexGlobPrefix()}swept:${matched}:*`;
}

/**
 * Append every entry key a moved set names to `keys`, read in pages rather than
 * whole. Appended one at a time rather than returned for a spread: one set can
 * name more keys than a spread survives
 * (https://github.com/jclaveau/directus/issues/397).
 */
async function collectSweptIndexKeys(
	sweptKey: string,
	keys: string[],
): Promise<void> {
	let scanCursor = '0';

	do {
		const [next, members] = await useCacheRedis().sscan(
			sweptKey,
			scanCursor,
			'COUNT',
			SCOPED_CACHE_INDEX_SCAN_COUNT,
		);

		scanCursor = next;

		// The fingerprint half is read past rather than parsed: this purge drops
		// the key whichever query case filed it.
		for (const member of members) {
			keys.push(parseScopedCacheIndexMember(member).key);
		}
	}
	while (scanCursor !== '0');
}

/**
 * The glob matching every home pin's set of one collection: what a declared pin
 * has to read beside the index path's, since an entry filed under a home pin can
 * hold a row of any index value. Matched against the collection's index-key set, not
 * the keyspace.
 */
export function scopedCacheHomePinIndexGlob(collection: string): string {
	const matched = escapeScopedCacheFingerprintGlob(collection);

	return `${scopedCacheIndexGlobPrefix()}fingerprint:${matched}:`
		+ `${SCOPED_CACHE_HOME_PIN}*`;
}

function scopedCacheHomePinIndexKey(
	collection: string,
	field: string,
	pinnedValue: string,
): string {
	const pinKey = escapeScopedCacheFingerprintPinKey(field);
	const valueToken = escapeScopedCacheFingerprintToken(pinnedValue);

	return scopedCacheIndexKey(
		collection,
		`${SCOPED_CACHE_HOME_PIN}${pinKey}=${valueToken}`,
	);
}

/**
 * The one pinned field a fingerprint off the index path is filed under, with the
 * values it pins there, or `null` when it pins nothing.
 *
 * Any one of its pins would do: a row drops the entry only by carrying one of its
 * values on EVERY field it pins, so on this one too, and a write reads the set of
 * each value its rows carry. So the choice is about set SIZE alone.
 * `homePinFields` ranks it: the first of them the read pins is the home. It is the
 * primary key, then the collection's `scoped_cache_fields` in their declared
 * order, so an admin controls the home by that order: a field every row shares
 * (`enabled=true`) listed first gathers the collection's reads into one set a
 * one-row write then reads whole, one per tenant listed first does not. The key
 * leads because it holds one row's value, so its set holds that row's reads and
 * no other's. A field declared unique would rank next to it, which the schema
 * does not expose yet (#579).
 *
 * A read pinning none of them keeps the field with the fewest values, costing the
 * fewest filings, ties going to the lowest pin key so the choice never depends on
 * the order the pins came in. Values are counted distinct: the serialiser drops a
 * repeated one.
 *
 * A field pinned to no value is never chosen, since its entry would be filed
 * nowhere.
 */
export function scopedCacheHomePin(
	fingerprint: ScopedCacheFingerprint,
	homePinFields: readonly string[],
): { field: string; pinnedValues: string[] } | null {
	const pinnedScope = fingerprint.pinnedScope ?? {};

	for (const field of homePinFields) {
		const pinnedValues = Object.hasOwn(pinnedScope, field)
			? [...new Set(pinnedScope[field])]
			: [];

		if (pinnedValues.length > 0) {
			return { field, pinnedValues };
		}
	}

	let homePin: { field: string; pinKey: string; pinnedValues: string[] } | null
		= null;

	for (const [field, values] of Object.entries(pinnedScope)) {
		const pinnedValues = [...new Set(values)];
		const pinKey = escapeScopedCacheFingerprintPinKey(field);

		if (pinnedValues.length === 0) {
			continue;
		}

		const fewerValues = homePin === null
			|| pinnedValues.length < homePin.pinnedValues.length;

		const lowerKey = homePin !== null
			&& pinnedValues.length === homePin.pinnedValues.length
			&& pinKey < homePin.pinKey;

		if (fewerValues || lowerKey) {
			homePin = { field, pinKey, pinnedValues };
		}
	}

	return homePin === null
		? null
		: { field: homePin.field, pinnedValues: homePin.pinnedValues };
}

/**
 * The keys of the sets one fingerprint is filed in: one per value it pins the
 * index path to, else one per value of its home pin, else the bare set.
 *
 * A read bounded to a list of values depends on each of them and is dropped by a
 * write to any one, so it is filed under each — the same OR an `_in` already
 * carries, kept as the only OR the layout has left.
 */
export function scopedCacheFingerprintIndexKeys(
	fingerprint: ScopedCacheFingerprint,
	indexPath: string | null,
	homePinFields: readonly string[],
): string[] {
	const { collection } = fingerprint;

	const indexValues = indexPath === null
		? undefined
		: fingerprint.pinnedScope?.[indexPath];

	if (indexPath !== null && indexValues !== undefined && indexValues.length > 0) {
		return indexValues.map((pinnedValue) => {
			return scopedCacheIndexKey(
				collection,
				`${indexPath}=${escapeScopedCacheFingerprintToken(pinnedValue)}`,
			);
		});
	}

	const homePin = scopedCacheHomePin(fingerprint, homePinFields);

	if (homePin === null) {
		return [scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN)];
	}

	return homePin.pinnedValues.map((pinnedValue) => {
		return scopedCacheHomePinIndexKey(collection, homePin.field, pinnedValue);
	});
}

/**
 * The keys of the sets a write reads back for the index path: the bare one, and
 * the one each of its rows' values at the index path names.
 *
 * The row is read as a fingerprint of its own, so the value it pins there is
 * looked up the same way a cached read's is. Every snapshotted row pins the index
 * path: `scopedCacheIndexPath` only walks hops the snapshot joins through, and the
 * snapshot reads the committed row, so an ancestor that is gone pins as null
 * rather than not at all. The collection is the written one rather than the
 * rows', so an empty write still names the bare set.
 */
export function scopedCacheRowIndexKeys(
	collection: string,
	rowFingerprints: readonly ScopedCacheFingerprint[],
	indexPath: string | null,
): string[] {
	const indexKeys = new Set<string>([
		scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN),
	]);

	if (indexPath === null) {
		return [...indexKeys];
	}

	for (const rowFingerprint of rowFingerprints) {
		const pinnedValues = rowFingerprint.pinnedScope?.[indexPath] ?? [];

		for (const pinnedValue of pinnedValues) {
			indexKeys.add(scopedCacheIndexKey(
				collection,
				`${indexPath}=${escapeScopedCacheFingerprintToken(pinnedValue)}`,
			));
		}
	}

	return [...indexKeys];
}

/**
 * The keys of the home pins' sets a write reads back: one per field and value its
 * rows carry.
 *
 * Whichever field an entry's home pin is, a row dropping it carries one of that
 * field's values, so its set is among these. The index path's own values are
 * named too: no entry is filed under them while the path stands, and one filed
 * before the collection had that path still is.
 */
export function scopedCacheRowHomePinKeys(
	collection: string,
	rowFingerprints: readonly ScopedCacheFingerprint[],
): string[] {
	const homePinKeys = new Set<string>();

	for (const { pinnedScope = {} } of rowFingerprints) {
		for (const [field, values] of Object.entries(pinnedScope)) {
			for (const pinnedValue of values) {
				homePinKeys.add(
					scopedCacheHomePinIndexKey(collection, field, pinnedValue),
				);
			}
		}
	}

	return [...homePinKeys];
}

/**
 * The keys of every set a fingerprint can have been filed in, whichever home pin
 * its filing chose: one per value it pins the index path to, else one per field
 * and value it pins, else the bare set.
 *
 * What a prune names rather than the filing's own keys, because the home pin is
 * ranked off the schema (the primary key, then the declared scope fields) and a
 * prune is handed none of it: a member read back cannot say which of its fields
 * was chosen, and one filed by a build or a field order that ranked them another
 * way was filed elsewhere. A set that never held the member costs an `SREM` of
 * nothing.
 */
export function scopedCacheFingerprintPrunedIndexKeys(
	fingerprint: ScopedCacheFingerprint,
	indexPath: string | null,
): string[] {
	const indexValues = indexPath === null
		? undefined
		: fingerprint.pinnedScope?.[indexPath];

	if (indexValues !== undefined && indexValues.length > 0) {
		return scopedCacheFingerprintIndexKeys(fingerprint, indexPath, []);
	}

	const homePinKeys = scopedCacheRowHomePinKeys(
		fingerprint.collection,
		[fingerprint],
	);

	return homePinKeys.length > 0
		? homePinKeys
		: [scopedCacheIndexKey(fingerprint.collection, SCOPED_CACHE_BARE_PIN)];
}

/**
 * A set member: the serialised fingerprint that has to match, and the cache key it
 * protects.
 *
 * Both in one member so the match needs nothing but the set itself, and so a key
 * cached under two different query cases is two members rather than one entry
 * whose query cases have been merged into an OR.
 *
 * `|` splits them, and a fingerprint escapes every `|` it carries, so the split is
 * on the first UNESCAPED one however the cache key is spelled: an escaped `\|`
 * still holds the raw character. This is the one place a
 * fingerprint leaves Node as a string; `parseScopedCacheIndexMember` is the one
 * place it comes back.
 */
export function renderScopedCacheIndexMember(
	fingerprint: ScopedCacheFingerprint,
	key: string,
): string {
	return `${renderScopedCacheFingerprint(fingerprint)}|${key}`;
}

export function parseScopedCacheIndexMember(
	member: string,
): { fingerprint: ScopedCacheFingerprint; key: string } {
	const splitAt = indexOfUnescaped(member, '|');

	if (splitAt === -1) {
		return { fingerprint: parseScopedCacheFingerprint(member), key: '' };
	}

	return {
		fingerprint: parseScopedCacheFingerprint(member.slice(0, splitAt)),
		key: member.slice(splitAt + 1),
	};
}

/** Where a member was found, so a matched entry can be dropped from it. */
interface ScopedCacheMemberLocation {
	indexKey: string;
	member: string;
}

/**
 * Read a list of sets whole, a page of each at a time, and answer with the entries
 * they hold.
 *
 * No `MATCH`: a pattern filters after the page is walked, so it shrinks the reply
 * and not the work, and each pattern is one more pass over the set. The sets a
 * write reads are already the ones its values name, and the caller's own test
 * decides.
 *
 * A round's sets are sent together: ioredis writes each command as it is issued,
 * so the round costs one round trip, and a refused one rejects the round the way
 * a single `SSCAN` did. A member met twice — a set rehashed under the cursor, or
 * one entry filed under two of the sets read — is answered once.
 */
async function* scanScopedCacheIndexKeys(
	indexKeys: readonly string[],
): AsyncGenerator<ScopedCacheIndexedEntry[]> {
	const redis = useCacheRedis();
	const scannedMembers = new Set<string>();

	for (let at = 0; at < indexKeys.length; at += SCOPED_CACHE_INDEX_SCAN_SETS) {
		let pendingScans = indexKeys
			.slice(at, at + SCOPED_CACHE_INDEX_SCAN_SETS)
			.map((indexKey) => {
				return { indexKey, scanCursor: '0' };
			});

		while (pendingScans.length > 0) {
			const scanReplies = await Promise.all(
				pendingScans.map(({ indexKey, scanCursor }) => {
					return redis.sscan(
						indexKey,
						scanCursor,
						'COUNT',
						SCOPED_CACHE_INDEX_SCAN_COUNT,
					);
				}),
			);

			const entries: ScopedCacheIndexedEntry[] = [];
			const unfinishedScans: typeof pendingScans = [];

			for (const [replyAt, [next, members]] of scanReplies.entries()) {
				const { indexKey } = pendingScans[replyAt]!;

				if (next !== '0') {
					unfinishedScans.push({ indexKey, scanCursor: next });
				}

				for (const member of members) {
					if (scannedMembers.has(member)) {
						continue;
					}

					scannedMembers.add(member);

					const { fingerprint, key } = parseScopedCacheIndexMember(member);

					entries.push({
						fingerprint,
						key,
						location: { indexKey, member } satisfies ScopedCacheMemberLocation,
					});
				}
			}

			yield entries;
			pendingScans = unfinishedScans;
		}
	}
}

/**
 * The keys under `globPattern`, a page at a time.
 *
 * `SCAN ... MATCH` filters server-side AFTER iterating, so a pass costs the whole
 * keyspace however few keys match — but only the matches cross the wire, which is
 * why the prefix is worth having.
 *
 * A single-node SCAN only covers the whole keyspace on a standalone client; a
 * cluster would miss keys on other nodes, which `assertStoreSupported` refuses at
 * boot.
 */
async function* scanScopedCacheKeys(
	globPattern: string,
): AsyncGenerator<string[]> {
	const redis = useCacheRedis();
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
}

/**
 * Reap one page of an index set, a chunk per call so no script holds Redis for
 * a whole page. Grouped by collection because each group bumps its own counter;
 * every member of a set is filed under the set's collection, so one set is one
 * group in practice.
 */
async function reapIndexMembers(
	indexKey: string,
	members: readonly string[],
	rawKeyOf: (key: string) => string,
	epochKeyOf: (collection: string) => string,
	epochTtlSeconds: number,
): Promise<number> {
	const argumentsByCollection = new Map<string, string[]>();

	for (const member of members) {
		const { fingerprint, key } = parseScopedCacheIndexMember(member);

		// A member naming no key names nothing to check.
		if (key === '') {
			continue;
		}

		const memberArguments =
			argumentsByCollection.get(fingerprint.collection) ?? [];

		memberArguments.push(member, rawKeyOf(key));
		argumentsByCollection.set(fingerprint.collection, memberArguments);
	}

	const chunkArguments = SCOPED_CACHE_INDEX_CHUNK_MEMBERS * 2;
	let reapedMembers = 0;

	for (const [collection, memberArguments] of argumentsByCollection) {
		for (let at = 0; at < memberArguments.length; at += chunkArguments) {
			reapedMembers += await useScriptedRedis().scopedCacheIndexReap(
				indexKey,
				epochKeyOf(collection),
				epochTtlSeconds,
				...memberArguments.slice(at, at + chunkArguments),
			);
		}
	}

	return reapedMembers;
}

/**
 * Name one set in its collection's index-key set with the set's own expiry,
 * which the index-key set then keeps at least. Not one script with the read: a
 * fill moving the set's expiry out in between moves the index-key set's past
 * it too.
 */
async function registerCollectionIndexKeys(
	collection: string,
	indexKey: string,
): Promise<void> {
	const redis = useScriptedRedis();
	const indexExpiry = await redis.pttl(indexKey);

	// Gone since it was read: nothing left to name.
	if (indexExpiry === -2) {
		return;
	}

	await redis.scopedCacheCollectionIndexKeysRegister(
		scopedCacheCollectionIndexKeysKey(collection),
		indexExpiry,
		indexKey,
	);
}

const redisStore: ScopedCacheStore = {
	/**
	 * Scoped purging drives SCAN + multi-key DEL over a single node, so it only
	 * works on a standalone client. A cluster client would silently under-purge —
	 * keys on other nodes are never scanned — and leave stale entries.
	 * `useCacheRedis()` always builds a standalone `Redis` in core, so this only
	 * bites a custom override.
	 */
	assertStoreSupported(): void {
		if (useCacheRedis().isCluster) {
			throw new Error(
				'CACHE_AUTO_PURGE_MODE=scoped is not implemented for Redis cluster '
				+ 'clients (SCAN and multi-key DEL are single-node). Use a standalone '
				+ 'Redis or CACHE_AUTO_PURGE_MODE=full.',
			);
		}
	},

	async fileIndexedEntries(
		filings: readonly ScopedCacheIndexFiling[],
		ttlSeconds: number,
	): Promise<void> {
		if (filings.length === 0) {
			return;
		}

		const pipeline = useScriptedRedis().pipeline() as ScopedCacheIndexPipeline;
		const callsByCollectionKey = new Map<string, ScopedCacheIndexFileCall[]>();

		for (const { fingerprint, keys, indexPath, homePinFields } of filings) {
			const members = keys.map((key) => {
				return renderScopedCacheIndexMember(fingerprint, key);
			});

			const collectionIndexKeysKey = scopedCacheCollectionIndexKeysKey(
				fingerprint.collection,
			);

			const collectionCalls = callsByCollectionKey.get(collectionIndexKeysKey)
				?? [];

			callsByCollectionKey.set(collectionIndexKeysKey, collectionCalls);

			for (const indexKey of scopedCacheFingerprintIndexKeys(
				fingerprint,
				indexPath,
				homePinFields,
			)) {
				let fileCall = collectionCalls.at(-1);

				const callIsFull = fileCall !== undefined && (
					fileCall.indexKeys.length >= SCOPED_CACHE_INDEX_CHUNK_MEMBERS
					|| fileCall.filingArguments.length + members.length
					> SCOPED_CACHE_INDEX_CHUNK_MEMBERS * 2
				);

				if (fileCall === undefined || callIsFull) {
					fileCall = { indexKeys: [], filingArguments: [] };
					collectionCalls.push(fileCall);
				}

				fileCall.indexKeys.push(indexKey);
				fileCall.filingArguments.push(members.length, ...members);
			}
		}

		// One call per collection files its sets and names them, so a set's name
		// crosses the wire once per fill, as the set's own key.
		for (const [collectionIndexKeysKey, collectionCalls] of callsByCollectionKey) {
			for (const { indexKeys, filingArguments } of collectionCalls) {
				pipeline.scopedCacheIndexFile(
					indexKeys.length + 1,
					collectionIndexKeysKey,
					...indexKeys,
					ttlSeconds,
					...filingArguments,
				);
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

	scanRowIndexedEntries(
		collection: string,
		rowFingerprints: readonly ScopedCacheFingerprint[],
		indexPath: string | null,
	): AsyncGenerator<ScopedCacheIndexedEntry[]> {
		// Every set an entry some row can drop is filed in: its index value's, its
		// home pin's, or the bare one. The bare set also still holds what the
		// layout before home pins filed there, read whole now.
		return scanScopedCacheIndexKeys([
			...scopedCacheRowIndexKeys(collection, rowFingerprints, indexPath),
			...scopedCacheRowHomePinKeys(collection, rowFingerprints),
		]);
	},

	async* scanDeclaredIndexedEntries(
		collection: string,
		declared: readonly ScopedCacheFingerprint[],
		indexPath: string | null,
	): AsyncGenerator<ScopedCacheIndexedEntry[]> {
		// The declared pins' own sets when the pin IS what the index is split by —
		// the same two a write of those values would read — plus every home pin's,
		// whose entries never pinned the index path and so leave room for any value
		// of it. Every set the collection owns otherwise, since a pin off the index
		// path says nothing about which split holds it. No glob narrowing of the
		// members either way: a declared pin matches entries by what they do NOT pin
		// as much as by what they do, and a pattern can only select on what is
		// written.
		const pinsIndexPath = indexPath !== null && declared.every((fingerprint) => {
			return fingerprint.pinnedScope?.[indexPath] !== undefined;
		});

		if (pinsIndexPath) {
			yield* scanScopedCacheIndexKeys(
				scopedCacheRowIndexKeys(collection, declared, indexPath),
			);

			for await (const homePinKeys of scanCollectionIndexKeys(
				scopedCacheCollectionIndexKeysKey(collection),
				scopedCacheHomePinIndexGlob(collection),
			)) {
				yield* scanScopedCacheIndexKeys(homePinKeys);
			}

			return;
		}

		yield* redisStore.scanCollectionIndexedEntries(collection);
	},

	async* scanCollectionIndexedEntries(
		collection: string,
	): AsyncGenerator<ScopedCacheIndexedEntry[]> {
		for await (const indexKeys of scanCollectionIndexKeys(
			scopedCacheCollectionIndexKeysKey(collection),
		)) {
			yield* scanScopedCacheIndexKeys(indexKeys);
		}
	},

	async removeIndexedEntries(
		entries: readonly ScopedCacheIndexedEntry[],
		indexPath: string | null,
	): Promise<void> {
		const membersByIndexKey = new Map<string, string[]>();

		for (const { fingerprint, location } of entries) {
			const { indexKey: foundIn, member } = location as ScopedCacheMemberLocation;

			// Every set `fileIndexedEntries` can have put this member in, not the one
			// it was read from: a read bounded to a list of values is filed under each
			// of them — at the index path or at its home pin — and a write carrying
			// one of those values reads that value's set alone. Pruning only there leaves
			// the member in the others, naming a key this purge has just dropped, and
			// no later write to those values can remove it — it is tested again on
			// each of them until its set expires.
			//
			// The set it WAS read from stands beside them, because the two agree only
			// while the collection's index path is what it was when the entry was
			// filed: a path since changed would otherwise leave the member exactly
			// where it was found. A set named here that never held the member costs
			// an `SREM` of nothing.
			const indexKeys = new Set([
				foundIn,
				...scopedCacheFingerprintPrunedIndexKeys(fingerprint, indexPath),
			]);

			for (const indexKey of indexKeys) {
				const members = membersByIndexKey.get(indexKey) ?? [];

				members.push(member);
				membersByIndexKey.set(indexKey, members);
			}
		}

		if (membersByIndexKey.size === 0) {
			return;
		}

		const redisPipeline = useCacheRedis().pipeline();

		for (const [indexKey, members] of membersByIndexKey) {
			for (
				let memberAt = 0;
				memberAt < members.length;
				memberAt += SCOPED_CACHE_INDEX_CHUNK_MEMBERS
			) {
				redisPipeline.srem(
					indexKey,
					...members.slice(
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

	async* takeCollectionIndexedKeys(
		collection: string,
	): AsyncGenerator<ScopedCacheIndexTake> {
		const redis = useCacheRedis();

		// First, what an earlier sweep moved aside and never released: its entries
		// may still be cached, and no write's own sets name them any more. Before
		// this sweep's own move, so it does not read its sets twice.
		yield* takeSweptIndexKeys(scopedCacheSweptIndexGlob(collection));

		const collectionIndexKeysKey = scopedCacheCollectionIndexKeysKey(collection);
		let scanCursor = '0';

		// SSCAN returns every name that stays in the index-key set for the whole
		// read, so the ones this moves out as it goes skip none. A name added
		// meanwhile is a fill that started after the purge counters moved, which its
		// own guard evicts — the same bound the keyspace SCAN this replaced gave.
		do {
			const [next, indexKeys] = await redis.sscan(
				collectionIndexKeysKey,
				scanCursor,
				'COUNT',
				SCOPED_CACHE_INDEX_SCAN_COUNT,
			);

			scanCursor = next;
			const keys: string[] = [];
			const movedKeys: string[] = [];

			for (
				let at = 0;
				at < indexKeys.length;
				at += SCOPED_CACHE_SWEEP_CHUNK_KEYS
			) {
				const chunk = indexKeys.slice(at, at + SCOPED_CACHE_SWEEP_CHUNK_KEYS);

				const sweptKeys = await redis.eval(
					scopedCacheSweepMoveScript,
					chunk.length + 2,
					collectionIndexKeysKey,
					scopedCacheSweptIndexKeysKey(),
					...chunk,
					scopedCacheSweptIndexKeyPrefix(collection),
				) as string[];

				for (const sweptKey of sweptKeys) {
					movedKeys.push(sweptKey);
					await collectSweptIndexKeys(sweptKey, keys);
				}
			}

			// A name whose set is already gone moves nothing, and counting it would
			// report more sets purged than were.
			yield { indexKeys: movedKeys.length, keys, sweptKeys: movedKeys };
		}
		while (scanCursor !== '0');
	},

	takeStrandedSweptIndexKeys(): AsyncGenerator<ScopedCacheIndexTake> {
		return takeSweptIndexKeys(null);
	},

	/**
	 * The sets first, their names after: a name outliving its set costs the next
	 * recovery an empty read, while a set outliving its name holds entries nothing
	 * would find again. So a refused delete keeps every name for the recovery.
	 */
	async releaseSweptIndexKeys(
		sweptKeys: string[],
	): Promise<ScopedCacheUnlinkTally> {
		const tally = await unlinkScopedCacheKeys(sweptKeys);

		if (sweptKeys.length === 0 || tally.refused > 0) {
			return tally;
		}

		const pipeline = useCacheRedis().pipeline();

		for (let at = 0; at < sweptKeys.length; at += SCOPED_CACHE_UNLINK_CHUNK) {
			pipeline.srem(
				scopedCacheSweptIndexKeysKey(),
				sweptKeys.slice(at, at + SCOPED_CACHE_UNLINK_CHUNK),
			);
		}

		// A refused SREM leaves a name without a set, which the recovery reads as
		// empty and releases again.
		await pipeline.exec();

		return tally;
	},

	/**
	 * Only the sets under `fingerprint:`: a moved set is read whole by the sweep
	 * or the recovery that releases it, and pruning it first would hide from them
	 * what they are about to drop.
	 *
	 * The one keyspace SCAN left on a schedule rather than a purge, and so the one
	 * place that can find a set no index-key set names — one filed by a node
	 * still running the build before the index-key set, during a rolling deploy.
	 * Each set it reads is named in its collection's index-key set again, and
	 * each index-key set it meets loses the names of the sets that are gone.
	 *
	 * A moved set it meets is named in the swept index-key set, which the
	 * recovery reads instead of the keyspace: a node on that older build moves
	 * its sets aside without naming them, and one dying mid-sweep strands them
	 * where no recovery looks. A set a live sweep released between the SCAN and
	 * the SADD leaves a name without a set, which the recovery reads as empty.
	 */
	async reapIndexedEntries(
		rawKeyOf: (key: string) => string,
		epochKeyOf: (collection: string) => string,
		epochTtlSeconds: number,
	): Promise<ScopedCacheReapTally> {
		const tally: ScopedCacheReapTally = {
			indexKeys: 0,
			reaped: 0,
			strandedSweptKeys: 0,
		};

		const collectionIndexKeysPrefix = scopedCacheCollectionIndexKeysKey('');
		const indexKeyPrefix = `${scopedCacheIndexPrefix()}fingerprint:`;
		const sweptKeyPrefix = `${scopedCacheIndexPrefix()}swept:`;

		// The whole prefix rather than `fingerprint:*` alone, so the index-key
		// sets come back from the same pass: MATCH filters after the walk, so the
		// wider pattern costs only the replies, not a second walk.
		for await (const foundKeys of scanScopedCacheKeys(
			`${scopedCacheIndexGlobPrefix()}*`,
		)) {
			const indexKeys = foundKeys.filter((foundKey) => {
				return foundKey.startsWith(indexKeyPrefix);
			});

			for (const collectionIndexKeysKey of foundKeys) {
				if (! collectionIndexKeysKey.startsWith(collectionIndexKeysPrefix)) {
					continue;
				}

				// Draining the pages is the prune: each drops the gone names it read.
				for await (
					const _livePage of scanCollectionIndexKeys(collectionIndexKeysKey)
				) {
					continue;
				}
			}

			const sweptKeys = foundKeys.filter((foundKey) => {
				return foundKey.startsWith(sweptKeyPrefix);
			});

			// SADD counts only the names it added: the ones a sweep of this build
			// named already are not stranded.
			if (sweptKeys.length > 0) {
				tally.strandedSweptKeys += await useCacheRedis().sadd(
					scopedCacheSweptIndexKeysKey(),
					sweptKeys,
				);
			}

			tally.indexKeys += indexKeys.length;

			for (const indexKey of indexKeys) {
				let scanCursor = '0';
				let setCollection: string | null = null;

				// SSCAN still returns every member that stays in the set for the
				// whole scan, so removing the ones it already returned skips none.
				do {
					const [next, members] = await useCacheRedis().sscan(
						indexKey,
						scanCursor,
						'COUNT',
						SCOPED_CACHE_INDEX_SCAN_COUNT,
					);

					scanCursor = next;

					if (setCollection === null && members.length > 0) {
						setCollection = parseScopedCacheIndexMember(members[0]!)
							.fingerprint
							.collection;
					}

					tally.reaped += await reapIndexMembers(
						indexKey,
						members,
						rawKeyOf,
						epochKeyOf,
						epochTtlSeconds,
					);
				}
				while (scanCursor !== '0');

				if (setCollection !== null) {
					await registerCollectionIndexKeys(setCollection, indexKey);
				}
			}
		}

		return tally;
	},

	/**
	 * Batch by batch rather than collecting first: the list a full flush would
	 * collect is the one thing here that grows with the cache, and holding all of
	 * it to delete all of it puts the whole index in this process's heap for no
	 * gain — the deletes are per-batch round trips either way.
	 *
	 * The keys the pre-scoped-cache-index layout left behind are not swept here:
	 * they went once, in `20260911A-drop-the-pre-scoped-cache-index-layout`.
	 */
	async dropIndex(): Promise<ScopedCacheUnlinkTally> {
		const tally = { dropped: 0, refused: 0 };

		for await (const batch of scanScopedCacheKeys(
			`${scopedCacheIndexGlobPrefix()}*`,
		)) {
			const batchTally = await unlinkScopedCacheKeys(batch);

			tally.dropped += batchTally.dropped;
			tally.refused += batchTally.refused;
		}

		return tally;
	},

	async readPurgeEpochs(
		epochKeys: readonly string[],
	): Promise<(string | null)[] | null> {
		return useCacheRedis()
			.mget([...epochKeys])
			.catch((): null => null);
	},

	async bumpPurgeEpochs(
		epochKeys: readonly string[],
		ttlSeconds: number,
	): Promise<void> {
		// Rejects on a counter the script could not move — maxmemory with
		// noeviction, a WRONGTYPE — which the caller must not let pass unseen.
		await useScriptedRedis().scopedCacheEpochBump(
			epochKeys.length,
			...epochKeys,
			ttlSeconds,
		);
	},

	onStoreReady(listener: () => void): void {
		const redis = useCacheRedis();

		// The boot talks to Redis before the recovery registers, so the first
		// connection's `ready` has usually fired already and would never reach it.
		if (redis.status === 'ready') {
			listener();
		}

		redis.on('ready', listener);
	},
};

/** The scoped cache index as Redis holds it. */
export function redisScopedCacheStore(): ScopedCacheStore {
	return redisStore;
}
