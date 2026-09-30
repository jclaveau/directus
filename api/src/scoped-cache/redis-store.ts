/**
 * The scoped cache's index, held in Redis.
 *
 * Everything Redis-shaped about the index lives here: how a set is named and what
 * segment it sits under, how a member is framed, the globs a scan is narrowed by,
 * the Lua the atomic steps run as, the cursor loops a scan is made of, the
 * chunk sizes a command list is cut to, and the per-command error a pipeline
 * answers with instead of rejecting. All of it is written to fit what Redis can
 * filter on — a key is a key, a member is a string, and both are selected by glob
 * — so none of it is a shape another store would inherit.
 *
 * What the rest of the module sees is `ScopedCacheStore`: fingerprints and cache
 * keys, so the purge reads the same whichever store answers it.
 */

import { useEnv } from '@directus/env';
import { randomUUID } from 'node:crypto';
import { cacheSettingOr } from '../cache-settings.js';
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
	SCOPED_CACHE_FINGERPRINT_VIEW,
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
 * cached read that pinned no index value, and `SMEMBERS` on it would put the
 * whole thing in this process's memory — and hold Redis for the length of the
 * reply — to keep the handful the write actually matched.
 */
function scopedCacheIndexScanCount(): number {
	return cacheSettingOr('scoped_index_scan_count', 1000);
}

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
 * File members into a fingerprint index set and give that set an expiry that only
 * ever moves OUT.
 *
 * A bare `EXPIRE` overwrites, and an index set is SHARED by every entry filed into
 * it: lower `CACHE_TTL` at runtime and one short-lived write cuts short the set
 * indexing an entry cached for an hour, leaving that entry unreachable to every
 * purge for the rest of its life. Redis 7 has `EXPIRE … GT`, but GT reads a key
 * carrying no TTL as infinite: it refuses the very first expiry a fresh index set
 * needs, and cannot tell that set from one deliberately left unbounded. So the
 * comparison runs as a script — atomic, one pipeline slot, and `EXISTS` telling
 * those two apart.
 *
 * A set that already carries NO expiry outlives every entry by construction, so it
 * keeps none — only a freshly created set takes one unconditionally.
 */
export const scopedCacheIndexExpiryScript = `
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

type ScopedCacheIndexExpiryCommand = {
	scopedCacheIndexExpiry(
		indexKey: string,
		ttlSeconds: number,
		...members: string[]
	): ChainableCommander;
};

type ScopedCacheIndexPipeline = ChainableCommander & ScopedCacheIndexExpiryCommand;

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
	& ScopedCacheIndexExpiryCommand
	& ScopedCacheEpochBumpCommand
	& ScopedCacheIndexReapCommand;

const clientsCarryingScripts = new WeakSet<Redis>();

/**
 * The shared client, with the index-expiry and counter-bump scripts registered as
 * commands on it.
 *
 * `defineCommand` sends `EVALSHA` and replays the body only when Redis answers
 * `NOSCRIPT` — so the 316-byte index-expiry script crosses the wire once per server
 * rather than once per index set. A read filed under 200 index sets sends 402 in
 * one pipeline, and as `EVAL` that is 124 KB of Lua per fill against 193 KB sent
 * in total.
 *
 * Registration is per client and idempotent, but `defineCommand` rebuilds the
 * command each time, so the set keeps it to the first call per connection.
 */
function useScriptedRedis(): ScopedCacheScriptedRedis {
	const redis = useCacheRedis();

	if (! clientsCarryingScripts.has(redis)) {
		redis.defineCommand('scopedCacheIndexExpiry', {
			numberOfKeys: 1,
			lua: scopedCacheIndexExpiryScript,
		});

		redis.defineCommand('scopedCacheEpochBump', {
			lua: scopedCacheEpochBumpScript,
		});

		redis.defineCommand('scopedCacheIndexReap', {
			numberOfKeys: 2,
			lua: scopedCacheIndexReapScript,
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
 * KEYS are the index sets and ARGV[1] the prefix each is moved under. Answers with
 * the keys it moved to: a set that expired since the scan found it has nothing to
 * move, and `RENAME` refuses a missing key.
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

for i = 1, #KEYS do
	if redis.call('EXISTS', KEYS[i]) == 1 then
		local sweptKey = ARGV[1] .. i
		redis.call('RENAME', KEYS[i], sweptKey)
		moved[#moved + 1] = sweptKey
	end
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
 * that path goes bare, and the bare set is read by every write to the collection.
 *
 * `indexPin` is what the split is keyed by — `<path>=<value>`, or empty for the
 * bare set. It never leaves this file: a caller asks the store for the entries it
 * has to test, not for the sets holding them.
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
 * Every moved set `sweptGlob` matches, with the entry keys each names. Nothing
 * is moved here: these sets were taken by a sweep before, and only need their
 * entries dropped and then releasing.
 */
async function* takeSweptIndexKeys(
	sweptGlob: string,
): AsyncGenerator<ScopedCacheIndexTake> {
	for await (const sweptKeys of scanScopedCacheKeys(sweptGlob)) {
		const keys: string[] = [];

		for (const sweptKey of sweptKeys) {
			await collectSweptIndexKeys(sweptKey, keys);
		}

		yield { indexKeys: sweptKeys.length, keys, sweptKeys };
	}
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
			scopedCacheIndexScanCount(),
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
 * The glob matching every set one collection's fingerprints are filed in — the
 * bare one and every split the index path produced.
 *
 * What a collection-wide read asks for, and the reason it needs no registry of the
 * sets a collection owns: a registry would be a second write on every fill, which
 * is the cost the split exists to avoid.
 *
 * The trailing colon bounds it. The key is `fingerprint:<collection>:<indexPin>`,
 * so a pattern ending at that one reaches a longer name only through a colon the
 * longer name carries — `a` reaches `a:b` — which reads and purges wider, never
 * narrower.
 */
export function scopedCacheCollectionIndexGlob(collection: string): string {
	const matched = escapeScopedCacheFingerprintGlob(collection);

	return `${scopedCacheIndexGlobPrefix()}fingerprint:${matched}:*`;
}

/**
 * The keys of the sets one fingerprint is filed in: one per value it pins the
 * index path to.
 *
 * A read bounded to a list of values depends on each of them and is dropped by a
 * write to any one, so it is filed under each — the same OR an `_in` already
 * carries, kept as the only OR the layout has left.
 */
export function scopedCacheFingerprintIndexKeys(
	fingerprint: ScopedCacheFingerprint,
	indexPath: string | null,
): string[] {
	const { collection } = fingerprint;

	if (indexPath === null) {
		return [scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN)];
	}

	const pinnedValues = fingerprint.pinnedScope?.[indexPath];

	if (pinnedValues === undefined || pinnedValues.length === 0) {
		return [scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN)];
	}

	return pinnedValues.map((pinnedValue) => {
		return scopedCacheIndexKey(
			collection,
			`${indexPath}=${escapeScopedCacheFingerprintToken(pinnedValue)}`,
		);
	});
}

/**
 * The keys of the sets a write reads back: the bare one, and the one each of its
 * rows' values at the index path names.
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
 * The patterns the rows can drop something under, or `null` to read the sets
 * whole.
 *
 * `SSCAN … MATCH` filters server-side, so a member matching none of these never
 * crosses the wire — and the caller's own test still decides, since a glob over a
 * serialised fingerprint can say a pin is absent but not that the whole query
 * case holds.
 */
export function scopedCacheRowIndexGlobs(
	collection: string,
	rowFingerprints: readonly ScopedCacheFingerprint[],
): string[] | null {
	const renderedCollection = escapeScopedCacheFingerprintToken(collection);

	// A member filed before the collection was escaped spells it raw, and no
	// pattern names both spellings: the sets are read whole instead.
	if (renderedCollection !== collection) {
		return null;
	}

	const collectionToken = escapeScopedCacheFingerprintGlob(renderedCollection);

	const globPatterns = new Set<string>([
		// Pins nothing at all, and pins nothing but its fields — the two ways a
		// fingerprint every row matches comes out of the serialiser.
		`${collectionToken}:&|*`,
		`${collectionToken}:&${SCOPED_CACHE_FINGERPRINT_VIEW}=,*`,
	]);

	for (const { pinnedScope = {} } of rowFingerprints) {
		for (const [field, values] of Object.entries(pinnedScope)) {
			const pinKey = escapeScopedCacheFingerprintGlob(
				escapeScopedCacheFingerprintPinKey(field),
			);

			for (const value of values) {
				const valueToken = escapeScopedCacheFingerprintGlob(
					escapeScopedCacheFingerprintToken(value),
				);

				globPatterns.add(`${collectionToken}:*&${pinKey}=*,${valueToken},*`);
			}

			// Every pattern is a pass over the set, so past a point narrowing costs
			// more round trips than the members it saves sending: the sets are then
			// read whole and every member tested here instead.
			if (globPatterns.size > cacheSettingOr('scoped_max_index_globs', 64)) {
				return null;
			}
		}
	}

	return [...globPatterns];
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
 * Read a list of sets, member by member, and answer with the entries they hold.
 *
 * `globPatterns` is a list of passes, since `SSCAN` takes one pattern: a member
 * matching several is yielded once, so the caller tests and drops it once.
 */
async function* scanScopedCacheIndexKeys(
	indexKeys: readonly string[],
	globPatterns: readonly string[] | null,
): AsyncGenerator<ScopedCacheIndexedEntry[]> {
	const redis = useCacheRedis();

	for (const indexKey of indexKeys) {
		const scannedMembers = new Set<string>();

		for (const globPattern of globPatterns ?? [null]) {
			let scanCursor = '0';

			do {
				const [next, members] = globPattern === null
					? await redis.sscan(
						indexKey,
						scanCursor,
						'COUNT',
						scopedCacheIndexScanCount(),
					)
					: await redis.sscan(
						indexKey,
						scanCursor,
						'MATCH',
						globPattern,
						'COUNT',
						scopedCacheIndexScanCount(),
					);

				scanCursor = next;
				const entries: ScopedCacheIndexedEntry[] = [];

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

				yield entries;
			}
			while (scanCursor !== '0');
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

		for (const { fingerprint, keys, indexPath } of filings) {
			const members = keys.map((key) => {
				return renderScopedCacheIndexMember(fingerprint, key);
			});

			for (const indexKey of scopedCacheFingerprintIndexKeys(
				fingerprint,
				indexPath,
			)) {
				if (ttlSeconds > 0) {
					pipeline.scopedCacheIndexExpiry(indexKey, ttlSeconds, ...members);
				}
				else {
					pipeline.sadd(indexKey, ...members);

					// The entries it names never expire now, so neither may the set: one
					// filed while a TTL was in force keeps that expiry otherwise, and
					// drops out from under them.
					pipeline.persist(indexKey);
				}
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
		return scanScopedCacheIndexKeys(
			scopedCacheRowIndexKeys(collection, rowFingerprints, indexPath),
			scopedCacheRowIndexGlobs(collection, rowFingerprints),
		);
	},

	async* scanDeclaredIndexedEntries(
		collection: string,
		declared: readonly ScopedCacheFingerprint[],
		indexPath: string | null,
	): AsyncGenerator<ScopedCacheIndexedEntry[]> {
		// The declared pins' own sets when the pin IS what the index is split by —
		// the same two a write of those values would read — and every set the
		// collection owns otherwise, since a pin off the index path says nothing
		// about which split holds it. No glob narrowing either way: a declared pin
		// matches entries by what they do NOT pin as much as by what they do, and a
		// pattern can only select on what is written.
		const pinsIndexPath = indexPath !== null && declared.every((fingerprint) => {
			return fingerprint.pinnedScope?.[indexPath] !== undefined;
		});

		if (pinsIndexPath) {
			yield* scanScopedCacheIndexKeys(
				scopedCacheRowIndexKeys(collection, declared, indexPath),
				null,
			);

			return;
		}

		yield* redisStore.scanCollectionIndexedEntries(collection);
	},

	async* scanCollectionIndexedEntries(
		collection: string,
	): AsyncGenerator<ScopedCacheIndexedEntry[]> {
		for await (const indexKeys of scanScopedCacheKeys(
			scopedCacheCollectionIndexGlob(collection),
		)) {
			yield* scanScopedCacheIndexKeys(indexKeys, null);
		}
	},

	async removeIndexedEntries(
		entries: readonly ScopedCacheIndexedEntry[],
		indexPath: string | null,
	): Promise<void> {
		const membersByIndexKey = new Map<string, string[]>();

		for (const { fingerprint, location } of entries) {
			const { indexKey: foundIn, member } = location as ScopedCacheMemberLocation;

			// Every set `fileIndexedEntries` put this member in, not the one it was
			// read from: a read bounded to a list of values is filed under each of
			// them, and a write carrying one of those values reads that value's split
			// alone. Pruning only there leaves the member in the others, naming a key
			// this purge has just dropped, and no later write to those values can
			// remove it — it is tested again on each of them until its set expires.
			//
			// The set it WAS read from stands beside them, because the two agree only
			// while the collection's index path is what it was when the entry was
			// filed: a path since changed would otherwise leave the member exactly
			// where it was found. With no path to name them by there is nothing to
			// add — `scopedCacheFingerprintIndexKeys` answers bare for every
			// fingerprint then, which says the caller does not know the split, not
			// that the member is in the bare set.
			const indexKeys = new Set(
				indexPath === null
					? [foundIn]
					: [foundIn, ...scopedCacheFingerprintIndexKeys(fingerprint, indexPath)],
			);

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

		for await (const indexKeys of scanScopedCacheKeys(
			scopedCacheCollectionIndexGlob(collection),
		)) {
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
					chunk.length,
					...chunk,
					scopedCacheSweptIndexKeyPrefix(collection),
				) as string[];

				for (const sweptKey of sweptKeys) {
					movedKeys.push(sweptKey);
					await collectSweptIndexKeys(sweptKey, keys);
				}
			}

			yield { indexKeys: indexKeys.length, keys, sweptKeys: movedKeys };
		}
	},

	takeStrandedSweptIndexKeys(): AsyncGenerator<ScopedCacheIndexTake> {
		return takeSweptIndexKeys(`${scopedCacheIndexGlobPrefix()}swept:*`);
	},

	releaseSweptIndexKeys(
		sweptKeys: string[],
	): Promise<ScopedCacheUnlinkTally> {
		return unlinkScopedCacheKeys(sweptKeys);
	},

	/**
	 * Only the sets under `fingerprint:`: a moved set is read whole by the sweep
	 * or the recovery that releases it, and pruning it first would hide from them
	 * what they are about to drop.
	 */
	async reapIndexedEntries(
		rawKeyOf: (key: string) => string,
		epochKeyOf: (collection: string) => string,
		epochTtlSeconds: number,
	): Promise<ScopedCacheReapTally> {
		const tally: ScopedCacheReapTally = { indexKeys: 0, reaped: 0 };

		for await (const indexKeys of scanScopedCacheKeys(
			`${scopedCacheIndexGlobPrefix()}fingerprint:*`,
		)) {
			tally.indexKeys += indexKeys.length;

			for (const indexKey of indexKeys) {
				let scanCursor = '0';

				// SSCAN still returns every member that stays in the set for the
				// whole scan, so removing the ones it already returned skips none.
				do {
					const [next, members] = await useCacheRedis().sscan(
						indexKey,
						scanCursor,
						'COUNT',
						scopedCacheIndexScanCount(),
					);

					scanCursor = next;

					tally.reaped += await reapIndexMembers(
						indexKey,
						members,
						rawKeyOf,
						epochKeyOf,
						epochTtlSeconds,
					);
				}
				while (scanCursor !== '0');
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
