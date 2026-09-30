import { useLogger } from "../logger/index.js";
import { useRedis } from "../redis/lib/use-redis.js";
import { useCacheRedis } from "../redis/lib/use-cache-redis.js";
import "../redis/index.js";
import { _cache } from "../metrics/lib/instance.js";
import { escapeScopedCacheFingerprintGlob, escapeScopedCacheFingerprintPinKey, escapeScopedCacheFingerprintToken, indexOfUnescaped, parseScopedCacheFingerprint, renderScopedCacheFingerprint } from "./fingerprint.js";
import { useEnv } from "@directus/env";
import { randomUUID } from "node:crypto";

//#region src/scoped-cache/redis-store.ts
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
* How many sets, and how many bytes of members, one `scopedCacheIndexFile` call
* files at most.
*
* Every member carries the read's whole fingerprint, so a read bounded to a list
* of primary keys files the same kilobytes under each of its hundreds of home
* pins: one call for all of them is a megabyte-sized script holding Redis for
* milliseconds, the blocking `SCOPED_CACHE_UNLINK_CHUNK` keeps a delete from.
* A call always takes one set, however large its members.
*/
const SCOPED_CACHE_INDEX_FILE_SETS = 25;
const SCOPED_CACHE_INDEX_FILE_BYTES = 64 * 1024;
/**
* How many members one `SSCAN` of an index set is asked to look at per round trip.
*
* The set is read in pages rather than whole: a collection's bare set holds every
* cached read that pinned nothing, and one home pin's set every read filed under
* that value, and `SMEMBERS` on either would put the whole thing in this process's
* memory — and hold Redis for the length of the reply — to keep the handful the
* write actually matched.
*/
const SCOPED_CACHE_INDEX_SCAN_COUNT = 1e3;
/**
* How many sets one round of a row scan reads at once.
*
* A write reads one set per value its rows carry, so a batch of rows is hundreds of
* sets, most of them missing or small. They are sent together rather than one after
* another, and the bound keeps the replies in flight — up to a page of each — from
* growing with the batch.
*/
const SCOPED_CACHE_INDEX_SCAN_SETS = 100;
const SCOPED_CACHE_SCAN_COUNT = 1e3;
const SCOPED_CACHE_UNLINK_CHUNK = 1e3;
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
* how many members it takes followed by them.
*/
const scopedCacheIndexFileScript = `
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
redis.call('SADD', KEYS[1], unpack(KEYS, 2))
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
const scopedCacheEpochBumpScript = `
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
const scopedCacheIndexReapScript = `
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
* Name the index sets Redis still holds in their collection's index-key set,
* and give that set an expiry that only ever moves out, past the longest of
* theirs — or none, while one of them keeps none.
*
* The index-key set is how a collection-wide purge finds a collection's sets
* without a keyspace SCAN, so it must outlive every set it names: a set it
* lost holds entries no collection-wide purge reaches. Milliseconds rather
* than the index script's seconds, because `TTL` rounds: an index-key set
* 0.4 s short of the wanted expiry reads as not short, and would expire that
* long before a set filed beside it. Each set's expiry is read here, so a fill
* moving one out can only land before the read or after the move.
*
* KEYS[1] is the index-key set and the rest the set names. Answers how many it
* named.
*/
const scopedCacheCollectionIndexKeysRegisterScript = `
local live = {}
local want = 0
local unbounded = false

for i = 2, #KEYS do
	local left = redis.call('PTTL', KEYS[i])
	if left == -1 then
		unbounded = true
		live[#live + 1] = KEYS[i]
	elseif left >= 0 then
		want = math.max(want, left)
		live[#live + 1] = KEYS[i]
	end
end

if #live == 0 then
	return 0
end

local existed = redis.call('EXISTS', KEYS[1])
redis.call('SADD', KEYS[1], unpack(live))
if unbounded then
	redis.call('PERSIST', KEYS[1])
	return #live
end
local ttl = redis.call('PTTL', KEYS[1])
if existed == 0 or (ttl >= 0 and ttl < want) then
	redis.call('PEXPIRE', KEYS[1], want)
end

return #live
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
const scopedCacheCollectionIndexKeysPruneScript = `
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
/**
* The index generation as a reap reads it before its SCAN, seeded from `TIME` the
* way the purge counters are when there is none yet: a reap with no generation to
* name could never mark anything complete, and one seeded again never repeats a
* value a marker was written with.
*
* KEYS is the generation, in the shared database. No expiry: a marker is good for
* as long as the generation it names stands, and only a changed build moves it.
*/
const scopedCacheIndexGenerationReadScript = `
local now = redis.call('TIME')
local seed = now[1] .. string.format('%06d', tonumber(now[2]))

redis.call('SET', KEYS[1], seed, 'NX')

return redis.call('GET', KEYS[1])
`;
/**
* Write the completeness marker, only while the generation still reads what the
* reap read before its SCAN and no fill pause runs: a deploy moves the one and
* opens the other in a single step (`scopedCacheIndexBuildRecordScript`). A
* separate check and `SET` let it land in between, and the marker then names
* the generation it moved away from, over sets the new build never saw named.
* All three sit in the shared database.
*
* KEYS are the marker, the generation and the fill pause; ARGV the generation
* as the reap read it. Answers 1 when it wrote.
*/
const scopedCacheIndexCompleteMarkScript = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] or redis.call('EXISTS', KEYS[3]) == 1 then
	return 0
end

redis.call('SET', KEYS[1], ARGV[1])

return 1
`;
/**
* Record the build this process runs, and when it is not the one recorded, move
* the index generation, so the completeness marker no longer names it. A build
* older than the index-key sets, rolled back to and forward from, filed sets
* nothing names while the marker a later build wrote still vouched for them.
*
* A change also opens the fill pause, for at most ARGV[2] ms: the nodes
* of the build before go on filling through a rolling deploy, and neither
* build's purges reach every set the other files. Held in Redis rather than per
* process, so a replica booting on the recorded build joins the window already
* running instead of filling through it.
*
* KEYS are the recorded build, the generation and the fill pause, all in the
* shared database, which a FLUSHDB of the cache database leaves; ARGV the build
* and the pause in ms, 0 for none. Answers whether the build changed, 1 or 0,
* and the ms left of the pause, 0 when none runs.
*/
const scopedCacheIndexBuildRecordScript = `
local changed = 0

if redis.call('GET', KEYS[1]) ~= ARGV[1] then
	changed = 1

	redis.call('SET', KEYS[1], ARGV[1])

	local now = redis.call('TIME')
	local seed = now[1] .. string.format('%06d', tonumber(now[2]))

	redis.call('SET', KEYS[2], seed, 'NX')
	redis.call('INCR', KEYS[2])

	if tonumber(ARGV[2]) > 0 then
		redis.call('SET', KEYS[3], ARGV[1], 'PX', ARGV[2])
	end
end

local pauseLeft = redis.call('PTTL', KEYS[3])

if pauseLeft < 0 then
	pauseLeft = 0
end

return { changed, pauseLeft }
`;
/**
* One node's look at the fill pause, every few seconds while it runs: what is
* left of it, and whether this node is the one that watches for the build
* before to be gone. One node watches, so a deploy of many asks the processes
* of the build before once a tick, not once per node; the watch is held for
* ARGV[2] ms, renewed on every look, so a watcher that dies hands it on.
*
* KEYS are the fill pause and the watch; ARGV the node and the watch in ms.
* Answers the ms left of the pause, 0 when none runs, and whether this node
* watches, 1 or 0.
*/
const scopedCacheFillPauseWatchScript = `
local pauseLeft = redis.call('PTTL', KEYS[1])

if pauseLeft < 0 then
	return { 0, 0 }
end

local watching = 0

if redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[2])
	or redis.call('GET', KEYS[2]) == ARGV[1] then
	redis.call('PEXPIRE', KEYS[2], ARGV[2])
	watching = 1
end

return { pauseLeft, watching }
`;
/**
* End the fill pause the build ARGV[1] opened, and its watch. Left alone when
* a later deploy's pause replaced it: that one waits for this build to go.
*
* KEYS are the fill pause and the watch. Answers 1 when it ended the pause.
*/
const scopedCacheFillPauseEndScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
	return 0
end

redis.call('DEL', KEYS[1], KEYS[2])

return 1
`;
const clientsCarryingScripts = /* @__PURE__ */ new WeakSet();
/**
* `redis` with the index scripts registered as commands on it.
*
* `defineCommand` sends `EVALSHA` and replays the body only when Redis answers
* `NOSCRIPT` — so the index-filing script crosses the wire once per server rather
* than once per fill.
*
* Registration is per client and idempotent, but `defineCommand` rebuilds the
* command each time, so the set keeps it to the first call per connection.
*/
function withScopedCacheScripts(redis) {
	if (!clientsCarryingScripts.has(redis)) {
		redis.defineCommand("scopedCacheIndexFile", { lua: scopedCacheIndexFileScript });
		redis.defineCommand("scopedCacheEpochBump", { lua: scopedCacheEpochBumpScript });
		redis.defineCommand("scopedCacheIndexReap", {
			numberOfKeys: 2,
			lua: scopedCacheIndexReapScript
		});
		redis.defineCommand("scopedCacheCollectionIndexKeysRegister", { lua: scopedCacheCollectionIndexKeysRegisterScript });
		redis.defineCommand("scopedCacheCollectionIndexKeysPrune", { lua: scopedCacheCollectionIndexKeysPruneScript });
		redis.defineCommand("scopedCacheIndexGenerationRead", {
			numberOfKeys: 1,
			lua: scopedCacheIndexGenerationReadScript
		});
		redis.defineCommand("scopedCacheIndexCompleteMark", {
			numberOfKeys: 3,
			lua: scopedCacheIndexCompleteMarkScript
		});
		redis.defineCommand("scopedCacheIndexBuildRecord", {
			numberOfKeys: 3,
			lua: scopedCacheIndexBuildRecordScript
		});
		redis.defineCommand("scopedCacheFillPauseWatch", {
			numberOfKeys: 2,
			lua: scopedCacheFillPauseWatchScript
		});
		redis.defineCommand("scopedCacheFillPauseEnd", {
			numberOfKeys: 2,
			lua: scopedCacheFillPauseEndScript
		});
		clientsCarryingScripts.add(redis);
	}
	return redis;
}
/** The client of the cache database: the index, its entries, their counters. */
function useScriptedRedis() {
	return withScopedCacheScripts(useCacheRedis());
}
/**
* The client of the shared database: what says how far the index can be trusted
* rather than what it holds — the recorded build, the index generation, the
* completeness marker, the fill pause and its watch. A FLUSHDB of the cache
* database must leave those: taking the pause resumes the fills it holds back.
*/
function useScriptedSharedRedis() {
	return withScopedCacheScripts(useRedis());
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
const scopedCacheSweepMoveScript = `
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
async function unlinkScopedCacheKeys(keys) {
	if (keys.length === 0) return {
		dropped: 0,
		refused: 0
	};
	const pipeline = useCacheRedis().pipeline();
	for (let at = 0; at < keys.length; at += SCOPED_CACHE_UNLINK_CHUNK) pipeline.unlink(keys.slice(at, at + SCOPED_CACHE_UNLINK_CHUNK));
	const results = await pipeline.exec();
	const tally = {
		dropped: 0,
		refused: 0
	};
	for (const [error, removed] of results ?? []) if (error) tally.refused += 1;
	else tally.dropped += Number(removed ?? 0);
	return tally;
}
/**
* The pin naming nothing, whose set every write to the collection reads.
*/
const SCOPED_CACHE_BARE_PIN = "";
/**
* The segment a home pin's sets sit under, beside the index path's. An index path
* is a field path, which never carries a colon, so no index value's set is spelled
* like a home pin's.
*/
const SCOPED_CACHE_HOME_PIN = "pin:";
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
function scopedCacheIndexPrefix() {
	return `${env["CACHE_NAMESPACE"]}:scoped-cache-index:`;
}
/**
* The prefix as a SCAN pattern opens it. The namespace is the operator's to
* pick, and one holding a `*`, `?` or `[` would match other namespaces' sets —
* which a flush then unlinks.
*/
function scopedCacheIndexGlobPrefix() {
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
function scopedCacheIndexKey(collection, indexPin) {
	return `${scopedCacheIndexPrefix()}fingerprint:${collection}:${indexPin}`;
}
/**
* Where one sweep moves the sets it takes: outside `fingerprint:`, so no fill
* reaches them, and inside the prefix, so a full flush still drops one a failed
* sweep left behind. One per sweep call, so two sweeps of the same collection
* never move onto each other's keys.
*/
function scopedCacheSweptIndexKeyPrefix(collection) {
	return `${scopedCacheIndexPrefix()}swept:${collection}:${randomUUID()}:`;
}
/**
* The set naming every index set of one collection, so a collection-wide purge
* reads its sets from here instead of a SCAN of the whole keyspace — once a
* reap has vouched that it names them all (`collectionIndexKeysComplete`).
*
* Outside `fingerprint:` and `swept:` so neither family's glob reaches it, and
* inside the prefix so a full flush drops it with the sets it names. A name
* enters it in every fill of its set and in the reap, leaves it only while its
* set is missing or being moved aside, and its expiry is never shorter than a
* named set's.
*/
function scopedCacheCollectionIndexKeysKey(collection) {
	return `${scopedCacheIndexPrefix()}collection-index-keys:${collection}`;
}
/**
* The set naming every moved set not released yet, whichever collection's. No
* expiry: it holds only what a sweep is between moving and releasing, or what a
* dead one left for the recovery to release.
*/
function scopedCacheSweptIndexKeysKey() {
	return `${scopedCacheIndexPrefix()}swept-index-keys`;
}
/**
* A per-collection purge counter, bumped every time that collection's entries are
* dropped. `*` is the wholesale entry, bumped by a flush that names no collection.
* Kept outside `scoped-cache-index:`: a flush bumps `*` and then unlinks that
* whole segment, and the counter has to survive the flush it counts.
*/
function scopedCacheEpochKey(collection) {
	return `${env["CACHE_NAMESPACE"]}:scoped-cache-epoch:${collection}`;
}
/**
* The key saying the index-key sets name every set the index holds. It holds the
* index generation a reap read before its SCAN, and vouches for them only while
* the generation still reads the same (`collectionIndexKeysComplete`). No
* expiry, and nothing deletes it: only a changed build can leave a set nothing
* names, and that build moves the generation. In the shared database, as the
* generation: a FLUSHDB of the cache one takes every entry with the index-key
* sets naming them, and what fills after it names its sets as it files them.
*/
function scopedCacheCollectionIndexKeysCompleteKey() {
	return `${env["CACHE_NAMESPACE"]}:scoped-cache-collection-index-keys-complete`;
}
/**
* The counter a changed build moves, and the completeness marker names. In the
* shared database, so a FLUSHDB of the cache one leaves it with the marker, and
* apart from the purge counters: the wholesale one expires,
* and a marker naming it went back to a SCAN every day nothing flushed.
*/
function scopedCacheIndexGenerationKey() {
	return `${env["CACHE_NAMESPACE"]}:scoped-cache-index-generation`;
}
/**
* The build the last process to boot ran. In the shared database, as the
* generation.
*/
function scopedCacheIndexBuildKey() {
	return `${env["CACHE_NAMESPACE"]}:scoped-cache-index-build`;
}
/**
* Set while a changed build holds its fills (`scopedCacheIndexBuildRecordScript`).
* In the shared database, as the generation: neither a drop of the index nor a
* FLUSHDB of the cache database may end it.
*/
function scopedCacheFillPauseKey() {
	return `${env["CACHE_NAMESPACE"]}:scoped-cache-fill-pause`;
}
/**
* Names the node watching the fill pause, beside it
* (`scopedCacheFillPauseWatchScript`).
*/
function scopedCacheFillPauseWatchKey() {
	return `${env["CACHE_NAMESPACE"]}:scoped-cache-fill-pause-watch`;
}
/**
* The glob matching every set one collection's fingerprints are filed in — the
* bare one, every split the index path produced and every home pin's. What a
* collection-wide read SCANs the keyspace for while the index-key sets are not
* known to be complete.
*
* The trailing colon bounds it. The key is `fingerprint:<collection>:<indexPin>`,
* so a pattern ending at that one reaches a longer name only through a colon the
* longer name carries — `a` reaches `a:b` — which reads and purges wider, never
* narrower.
*/
function scopedCacheCollectionIndexGlob(collection) {
	const matched = escapeScopedCacheFingerprintGlob(collection);
	return `${scopedCacheIndexGlobPrefix()}fingerprint:${matched}:*`;
}
/**
* Whether the index-key sets can be trusted to name every set the index holds,
* or a collection-wide read has to SCAN the keyspace for them as it did before
* they existed.
*
* A fill names every set it files into, but some sets were filed with nothing
* naming them, by the build before the index-key sets. Only the reap names
* those, so the marker is written by a reap that walked the whole index, and
* holds the index generation as it was BEFORE that walk. A drop of this build
* unlinks only the index sets, never the index-key sets naming them, so the
* marker still tells the truth after it: a name whose set is gone reads empty.
* A FLUSHDB of the cache database leaves the marker too: it takes every entry
* with the sets naming them, and each later fill names the sets it files.
*
* A boot of a build other than the last one recorded moves the generation
* (`recordBuildIdentity`), so a build rolled back to and forward again leaves
* no marker naming it over the sets it filed. The nodes of an older build go on
* filing through a rolling deploy, so that boot also opens a fill pause during
* which no marker is written, and the reap at its close names what they filed.
* Accepted: a node of the older build outliving the pause files sets nothing
* names after that marker. The next reap names them; until then a
* collection-wide purge misses their entries.
*/
async function collectionIndexKeysComplete() {
	const [marker, generation] = await useRedis().mget([scopedCacheCollectionIndexKeysCompleteKey(), scopedCacheIndexGenerationKey()]);
	return marker !== null && marker === generation;
}
/**
* Say which way a collection-wide read found its sets. Read off the metrics
* this process holds rather than asked for, so a process with none never
* loads what creating them costs.
*/
function countIndexRead(collection, indexKeysComplete) {
	const readMode = indexKeysComplete ? "registry" : "scan";
	useLogger().debug(`[scoped-cache] ${collection} index sets read by ${readMode}`);
	_cache.metrics?.getScopedCacheIndexReadMetric()?.inc({ mode: readMode });
}
/**
* The sets one collection's fingerprints are filed in, a page at a time: the
* names its index-key set holds while `collectionIndexKeysComplete` vouches for
* them, a keyspace SCAN otherwise. `nameGlob` narrows either to the sets whose
* key matches it. A name read from the index-key set may outlive its set; the
* callers read an absent set as empty.
*/
async function* scanCollectionIndexKeyNames(collection, nameGlob = null) {
	const indexKeysComplete = await collectionIndexKeysComplete();
	countIndexRead(collection, indexKeysComplete);
	if (indexKeysComplete) {
		yield* scanCollectionIndexKeys(scopedCacheCollectionIndexKeysKey(collection), nameGlob);
		return;
	}
	yield* scanScopedCacheKeys(nameGlob ?? scopedCacheCollectionIndexGlob(collection));
}
/**
* The home pin sets among `homePinKeys` that the collection's index-key set
* names, once a reap has marked those complete, or all of them before.
*
* A filing names its set in the script that fills it, so under a complete mark
* a set left unnamed holds nothing, and a write carrying twenty fields reads
* the few its rows' values were filed under rather than twenty. A name may
* outlive its set, which reads empty.
*/
async function namedHomePinKeys(collection, homePinKeys) {
	if (homePinKeys.length === 0 || !await collectionIndexKeysComplete()) return homePinKeys;
	const redis = useScriptedRedis();
	const collectionIndexKeysKey = scopedCacheCollectionIndexKeysKey(collection);
	const chunkLookups = [];
	for (let keyAt = 0; keyAt < homePinKeys.length; keyAt += SCOPED_CACHE_INDEX_CHUNK_MEMBERS) chunkLookups.push(redis.smismember(collectionIndexKeysKey, ...homePinKeys.slice(keyAt, keyAt + SCOPED_CACHE_INDEX_CHUNK_MEMBERS)));
	const named = (await Promise.all(chunkLookups)).flat();
	return homePinKeys.filter((_homePinKey, keyAt) => named[keyAt] === 1);
}
/** The members of one set, a page at a time. */
async function* scanScopedCacheSetMembers(setKey) {
	let scanCursor = "0";
	do {
		const [next, members] = await useCacheRedis().sscan(setKey, scanCursor, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT);
		scanCursor = next;
		yield members;
	} while (scanCursor !== "0");
}
/**
* Every moved set the swept index-key set names under `sweptGlob`, or all of
* them, with the entry keys each names. Nothing is moved here: these sets were
* taken by a sweep before, and only need their entries dropped and then
* releasing. A name whose set is gone reads as empty and is released like the
* others, but is not counted as a set taken.
*/
async function* takeSweptIndexKeys(sweptGlob) {
	const redis = useCacheRedis();
	const sweptIndexKeysKey = scopedCacheSweptIndexKeysKey();
	let scanCursor = "0";
	do {
		const [next, sweptKeys] = sweptGlob === null ? await redis.sscan(sweptIndexKeysKey, scanCursor, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT) : await redis.sscan(sweptIndexKeysKey, scanCursor, "MATCH", sweptGlob, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT);
		scanCursor = next;
		const keys = [];
		let existingSets = 0;
		for (const sweptKey of sweptKeys) if (await collectSweptIndexKeys(sweptKey, keys) > 0) existingSets += 1;
		yield {
			indexKeys: existingSets,
			keys,
			sweptKeys
		};
	} while (scanCursor !== "0");
}
/**
* The sets one collection's index-key set names that still exist, a page at a time,
* dropping from it the names of those that are gone. `nameGlob` narrows the
* names read, and only those are pruned.
*/
async function* scanCollectionIndexKeys(collectionIndexKeysKey, nameGlob = null) {
	const redis = useScriptedRedis();
	let scanCursor = "0";
	do {
		const [next, indexKeys] = nameGlob === null ? await redis.sscan(collectionIndexKeysKey, scanCursor, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT) : await redis.sscan(collectionIndexKeysKey, scanCursor, "MATCH", nameGlob, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT);
		scanCursor = next;
		for (let at = 0; at < indexKeys.length; at += SCOPED_CACHE_SWEEP_CHUNK_KEYS) {
			const chunk = indexKeys.slice(at, at + SCOPED_CACHE_SWEEP_CHUNK_KEYS);
			yield await redis.scopedCacheCollectionIndexKeysPrune(chunk.length + 1, collectionIndexKeysKey, ...chunk);
		}
	} while (scanCursor !== "0");
}
/**
* The glob matching every set a sweep of one collection moved aside and has not
* released yet — bounded by its trailing colon the way the collection's own glob
* is.
*/
function scopedCacheSweptIndexGlob(collection) {
	const matched = escapeScopedCacheFingerprintGlob(collection);
	return `${scopedCacheIndexGlobPrefix()}swept:${matched}:*`;
}
/**
* Append every entry key a moved set names to `keys`, read in pages rather than
* whole. Appended one at a time rather than returned for a spread: one set can
* name more keys than a spread survives
* (https://github.com/jclaveau/directus/issues/397). Answers how many it
* appended.
*/
async function collectSweptIndexKeys(sweptKey, keys) {
	const keysBefore = keys.length;
	let scanCursor = "0";
	do {
		const [next, members] = await useCacheRedis().sscan(sweptKey, scanCursor, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT);
		scanCursor = next;
		for (const member of members) keys.push(parseScopedCacheIndexMember(member).key);
	} while (scanCursor !== "0");
	return keys.length - keysBefore;
}
/**
* The glob matching every home pin's set of one collection: what a declared pin
* has to read beside the index path's, since an entry filed under a home pin can
* hold a row of any index value. Matched against the collection's index-key set
* while it is known complete, against the keyspace otherwise.
*/
function scopedCacheHomePinIndexGlob(collection) {
	const matched = escapeScopedCacheFingerprintGlob(collection);
	return `${scopedCacheIndexGlobPrefix()}fingerprint:${matched}:${SCOPED_CACHE_HOME_PIN}*`;
}
function scopedCacheHomePinIndexKey(collection, field, pinnedValue) {
	return scopedCacheIndexKey(collection, `${SCOPED_CACHE_HOME_PIN}${escapeScopedCacheFingerprintPinKey(field)}=${escapeScopedCacheFingerprintToken(pinnedValue)}`);
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
* does not expose yet (https://github.com/jclaveau/directus/issues/579).
*
* A read pinning none of them keeps the field with the fewest values, costing the
* fewest filings, ties going to the lowest pin key so the choice never depends on
* the order the pins came in. Values are counted distinct: the serialiser drops a
* repeated one.
*
* A field pinned to no value is never chosen, since its entry would be filed
* nowhere.
*/
function scopedCacheHomePin(fingerprint, homePinFields) {
	const pinnedScope = fingerprint.pinnedScope ?? {};
	for (const field of homePinFields) {
		const pinnedValues = Object.hasOwn(pinnedScope, field) ? [...new Set(pinnedScope[field])] : [];
		if (pinnedValues.length > 0) return {
			field,
			pinnedValues
		};
	}
	let homePin = null;
	for (const [field, values] of Object.entries(pinnedScope)) {
		const pinnedValues = [...new Set(values)];
		const pinKey = escapeScopedCacheFingerprintPinKey(field);
		if (pinnedValues.length === 0) continue;
		const fewerValues = homePin === null || pinnedValues.length < homePin.pinnedValues.length;
		const lowerKey = homePin !== null && pinnedValues.length === homePin.pinnedValues.length && pinKey < homePin.pinKey;
		if (fewerValues || lowerKey) homePin = {
			field,
			pinKey,
			pinnedValues
		};
	}
	return homePin === null ? null : {
		field: homePin.field,
		pinnedValues: homePin.pinnedValues
	};
}
/**
* The keys of the sets one fingerprint is filed in: one per value it pins the
* primary key to, else one per value it pins the index path to, else one per
* value of its home pin, else the bare set.
*
* The key outranks the index path: its set holds one row's reads, where the
* index path's holds a whole tenant's, which a one-row write would read back.
* `homePinFields` leads with it.
*
* A read bounded to a list of values depends on each of them and is dropped by a
* write to any one, so it is filed under each — the same OR an `_in` already
* carries, kept as the only OR the layout has left.
*/
function scopedCacheFingerprintIndexKeys(fingerprint, indexPath, homePinFields) {
	const { collection } = fingerprint;
	const [keyField] = homePinFields;
	const pinnedScope = fingerprint.pinnedScope ?? {};
	const keyValues = keyField !== void 0 && Object.hasOwn(pinnedScope, keyField) ? [...new Set(pinnedScope[keyField])] : [];
	if (keyValues.length > 0) return keyValues.map((keyValue) => {
		return scopedCacheHomePinIndexKey(collection, keyField, keyValue);
	});
	const indexValues = indexPath === null ? void 0 : fingerprint.pinnedScope?.[indexPath];
	if (indexPath !== null && indexValues !== void 0 && indexValues.length > 0) return indexValues.map((pinnedValue) => {
		return scopedCacheIndexKey(collection, `${indexPath}=${escapeScopedCacheFingerprintToken(pinnedValue)}`);
	});
	const homePin = scopedCacheHomePin(fingerprint, homePinFields);
	if (homePin === null) return [scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN)];
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
function scopedCacheRowIndexKeys(collection, rowFingerprints, indexPath) {
	const indexKeys = new Set([scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN)]);
	if (indexPath === null) return [...indexKeys];
	for (const rowFingerprint of rowFingerprints) {
		const pinnedValues = rowFingerprint.pinnedScope?.[indexPath] ?? [];
		for (const pinnedValue of pinnedValues) indexKeys.add(scopedCacheIndexKey(collection, `${indexPath}=${escapeScopedCacheFingerprintToken(pinnedValue)}`));
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
function scopedCacheRowHomePinKeys(collection, rowFingerprints) {
	const homePinKeys = /* @__PURE__ */ new Set();
	for (const { pinnedScope = {} } of rowFingerprints) for (const [field, values] of Object.entries(pinnedScope)) for (const pinnedValue of values) homePinKeys.add(scopedCacheHomePinIndexKey(collection, field, pinnedValue));
	return [...homePinKeys];
}
/**
* The keys of every set a fingerprint can have been filed in, whichever home pin
* its filing chose: one per value it pins the index path to with one per value
* of each other field it pins, else one per field and value it pins, else the
* bare set.
*
* What a prune names rather than the filing's own keys, because the home pin is
* ranked off the schema (the primary key, then the declared scope fields) and a
* prune is handed none of it: a member read back cannot say which of its fields
* was chosen, and one filed by a build or a field order that ranked them another
* way was filed elsewhere. A set that never held the member costs an `SREM` of
* nothing.
*/
function scopedCacheFingerprintPrunedIndexKeys(fingerprint, indexPath) {
	const indexValues = indexPath === null ? void 0 : fingerprint.pinnedScope?.[indexPath];
	if (indexValues !== void 0 && indexValues.length > 0) {
		const { [indexPath]: _indexPathValues,...otherPins } = fingerprint.pinnedScope ?? {};
		return [...scopedCacheFingerprintIndexKeys(fingerprint, indexPath, []), ...scopedCacheRowHomePinKeys(fingerprint.collection, [{
			...fingerprint,
			pinnedScope: otherPins
		}])];
	}
	const homePinKeys = scopedCacheRowHomePinKeys(fingerprint.collection, [fingerprint]);
	return homePinKeys.length > 0 ? homePinKeys : [scopedCacheIndexKey(fingerprint.collection, SCOPED_CACHE_BARE_PIN)];
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
function renderScopedCacheIndexMember(fingerprint, key) {
	return `${renderScopedCacheFingerprint(fingerprint)}|${key}`;
}
function parseScopedCacheIndexMember(member) {
	const splitAt = indexOfUnescaped(member, "|");
	if (splitAt === -1) return {
		fingerprint: parseScopedCacheFingerprint(member),
		key: ""
	};
	return {
		fingerprint: parseScopedCacheFingerprint(member.slice(0, splitAt)),
		key: member.slice(splitAt + 1)
	};
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
* a single `SSCAN` did. A member met twice within a round — one entry filed
* under two of the sets read — is answered once. Only within a round: a scan
* remembering every member it met would hold the whole of a large set, which
* the paging exists to avoid, and a member answered again costs a repeated
* delete, which the purge counts once.
*/
async function* scanScopedCacheIndexKeys(indexKeys) {
	const redis = useCacheRedis();
	for (let setAt = 0; setAt < indexKeys.length; setAt += SCOPED_CACHE_INDEX_SCAN_SETS) {
		let pendingScans = indexKeys.slice(setAt, setAt + SCOPED_CACHE_INDEX_SCAN_SETS).map((indexKey) => {
			return {
				indexKey,
				scanCursor: "0"
			};
		});
		while (pendingScans.length > 0) {
			const scanReplies = await Promise.all(pendingScans.map(({ indexKey, scanCursor }) => {
				return redis.sscan(indexKey, scanCursor, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT);
			}));
			const entries = [];
			const unfinishedScans = [];
			const scannedMembers = /* @__PURE__ */ new Set();
			for (const [replyAt, [next, members]] of scanReplies.entries()) {
				const { indexKey } = pendingScans[replyAt];
				if (next !== "0") unfinishedScans.push({
					indexKey,
					scanCursor: next
				});
				for (const member of members) {
					if (scannedMembers.has(member)) continue;
					scannedMembers.add(member);
					const { fingerprint, key } = parseScopedCacheIndexMember(member);
					entries.push({
						fingerprint,
						key,
						location: {
							indexKey,
							member
						}
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
async function* scanScopedCacheKeys(globPattern) {
	const redis = useCacheRedis();
	let cursor = "0";
	do {
		const [next, batch] = await redis.scan(cursor, "MATCH", globPattern, "COUNT", SCOPED_CACHE_SCAN_COUNT);
		cursor = next;
		yield batch;
	} while (cursor !== "0");
}
/**
* Reap one page of an index set, a chunk per call so no script holds Redis for
* a whole page. Grouped by collection because each group bumps its own counter;
* every member of a set is filed under the set's collection, so one set is one
* group in practice.
*/
async function reapIndexMembers(indexKey, members, rawKeyOf, epochTtlSeconds) {
	const argumentsByCollection = /* @__PURE__ */ new Map();
	for (const member of members) {
		const { fingerprint, key } = parseScopedCacheIndexMember(member);
		if (key === "") continue;
		const memberArguments = argumentsByCollection.get(fingerprint.collection) ?? [];
		memberArguments.push(member, rawKeyOf(key));
		argumentsByCollection.set(fingerprint.collection, memberArguments);
	}
	const chunkArguments = SCOPED_CACHE_INDEX_CHUNK_MEMBERS * 2;
	let reapedMembers = 0;
	for (const [collection, memberArguments] of argumentsByCollection) for (let at = 0; at < memberArguments.length; at += chunkArguments) reapedMembers += await useScriptedRedis().scopedCacheIndexReap(indexKey, scopedCacheEpochKey(collection), epochTtlSeconds, ...memberArguments.slice(at, at + chunkArguments));
	return reapedMembers;
}
/**
* Name the sets one SCAN page found in their collections' index-key sets, one
* script per collection and chunk, which reads each set's own expiry.
*/
async function registerCollectionIndexKeys(indexKeysByCollection) {
	for (const [collection, indexKeys] of indexKeysByCollection) for (let at = 0; at < indexKeys.length; at += SCOPED_CACHE_INDEX_CHUNK_MEMBERS) {
		const chunkKeys = indexKeys.slice(at, at + SCOPED_CACHE_INDEX_CHUNK_MEMBERS);
		await useScriptedRedis().scopedCacheCollectionIndexKeysRegister(chunkKeys.length + 1, scopedCacheCollectionIndexKeysKey(collection), ...chunkKeys);
	}
}
const redisStore = {
	assertStoreSupported() {
		if (useCacheRedis().isCluster) throw new Error("CACHE_AUTO_PURGE_MODE=scoped is not implemented for Redis cluster clients (SCAN and multi-key DEL are single-node). Use a standalone Redis or CACHE_AUTO_PURGE_MODE=full.");
	},
	async fileIndexedEntries(filings, ttlSeconds) {
		if (filings.length === 0) return;
		const pipeline = useScriptedRedis().pipeline();
		const callsByCollectionKey = /* @__PURE__ */ new Map();
		for (const { fingerprint, keys, indexPath, homePinFields } of filings) {
			const members = keys.map((key) => {
				return renderScopedCacheIndexMember(fingerprint, key);
			});
			const filingBytes = members.reduce((total, member) => {
				return total + Buffer.byteLength(member);
			}, 0);
			const collectionIndexKeysKey = scopedCacheCollectionIndexKeysKey(fingerprint.collection);
			const collectionCalls = callsByCollectionKey.get(collectionIndexKeysKey) ?? [];
			callsByCollectionKey.set(collectionIndexKeysKey, collectionCalls);
			for (const indexKey of scopedCacheFingerprintIndexKeys(fingerprint, indexPath, homePinFields)) {
				let fileCall = collectionCalls.at(-1);
				const callIsFull = fileCall !== void 0 && (fileCall.indexKeys.length >= SCOPED_CACHE_INDEX_FILE_SETS || fileCall.memberBytes + filingBytes > SCOPED_CACHE_INDEX_FILE_BYTES || fileCall.filingArguments.length + members.length > SCOPED_CACHE_INDEX_CHUNK_MEMBERS * 2);
				if (fileCall === void 0 || callIsFull) {
					fileCall = {
						indexKeys: [],
						filingArguments: [],
						memberBytes: 0
					};
					collectionCalls.push(fileCall);
				}
				fileCall.indexKeys.push(indexKey);
				fileCall.filingArguments.push(members.length, ...members);
				fileCall.memberBytes += filingBytes;
			}
		}
		for (const [collectionIndexKeysKey, collectionCalls] of callsByCollectionKey) for (const { indexKeys, filingArguments } of collectionCalls) pipeline.scopedCacheIndexFile(indexKeys.length + 1, collectionIndexKeysKey, ...indexKeys, ttlSeconds, ...filingArguments);
		const failed = (await pipeline.exec())?.find(([error]) => error !== null);
		if (failed) throw failed[0];
	},
	async *scanRowIndexedEntries(collection, rowFingerprints, indexPath) {
		yield* scanScopedCacheIndexKeys([...scopedCacheRowIndexKeys(collection, rowFingerprints, indexPath), ...await namedHomePinKeys(collection, scopedCacheRowHomePinKeys(collection, rowFingerprints))]);
	},
	async *scanDeclaredIndexedEntries(collection, declared, indexPath) {
		if (indexPath !== null && declared.every((fingerprint) => {
			return fingerprint.pinnedScope?.[indexPath] !== void 0;
		})) {
			yield* scanScopedCacheIndexKeys(scopedCacheRowIndexKeys(collection, declared, indexPath));
			for await (const homePinKeys of scanCollectionIndexKeyNames(collection, scopedCacheHomePinIndexGlob(collection))) yield* scanScopedCacheIndexKeys(homePinKeys);
			return;
		}
		yield* redisStore.scanCollectionIndexedEntries(collection);
	},
	async *scanCollectionIndexedEntries(collection) {
		for await (const indexKeys of scanCollectionIndexKeyNames(collection)) yield* scanScopedCacheIndexKeys(indexKeys);
	},
	async removeIndexedEntries(entries, indexPath) {
		const membersByIndexKey = /* @__PURE__ */ new Map();
		for (const { fingerprint, location } of entries) {
			const { indexKey: foundIn, member } = location;
			const indexKeys = new Set([foundIn, ...scopedCacheFingerprintPrunedIndexKeys(fingerprint, indexPath)]);
			for (const indexKey of indexKeys) {
				const members = membersByIndexKey.get(indexKey) ?? [];
				members.push(member);
				membersByIndexKey.set(indexKey, members);
			}
		}
		if (membersByIndexKey.size === 0) return;
		const redisPipeline = useCacheRedis().pipeline();
		for (const [indexKey, members] of membersByIndexKey) for (let memberAt = 0; memberAt < members.length; memberAt += SCOPED_CACHE_INDEX_CHUNK_MEMBERS) redisPipeline.srem(indexKey, ...members.slice(memberAt, memberAt + SCOPED_CACHE_INDEX_CHUNK_MEMBERS));
		const failedResult = (await redisPipeline.exec())?.find(([error]) => error !== null);
		if (failedResult) useLogger().warn(failedResult[0], `[scoped-cache] pruning the fingerprint index failed; its members expire with their set: ${failedResult[0]}`);
	},
	async *takeCollectionIndexedKeys(collection) {
		const redis = useCacheRedis();
		yield* takeSweptIndexKeys(scopedCacheSweptIndexGlob(collection));
		const collectionIndexKeysKey = scopedCacheCollectionIndexKeysKey(collection);
		const indexKeysComplete = await collectionIndexKeysComplete();
		countIndexRead(collection, indexKeysComplete);
		const indexKeyPages = indexKeysComplete ? scanScopedCacheSetMembers(collectionIndexKeysKey) : scanScopedCacheKeys(scopedCacheCollectionIndexGlob(collection));
		for await (const indexKeys of indexKeyPages) {
			const keys = [];
			const movedKeys = [];
			for (let at = 0; at < indexKeys.length; at += SCOPED_CACHE_SWEEP_CHUNK_KEYS) {
				const chunk = indexKeys.slice(at, at + SCOPED_CACHE_SWEEP_CHUNK_KEYS);
				const sweptKeys = await redis.eval(scopedCacheSweepMoveScript, chunk.length + 2, collectionIndexKeysKey, scopedCacheSweptIndexKeysKey(), ...chunk, scopedCacheSweptIndexKeyPrefix(collection));
				for (const sweptKey of sweptKeys) {
					movedKeys.push(sweptKey);
					await collectSweptIndexKeys(sweptKey, keys);
				}
			}
			yield {
				indexKeys: movedKeys.length,
				keys,
				sweptKeys: movedKeys
			};
		}
	},
	takeStrandedSweptIndexKeys() {
		return takeSweptIndexKeys(null);
	},
	async releaseSweptIndexKeys(sweptKeys) {
		const tally = await unlinkScopedCacheKeys(sweptKeys);
		if (sweptKeys.length === 0 || tally.refused > 0) return tally;
		const pipeline = useCacheRedis().pipeline();
		for (let at = 0; at < sweptKeys.length; at += SCOPED_CACHE_UNLINK_CHUNK) pipeline.srem(scopedCacheSweptIndexKeysKey(), sweptKeys.slice(at, at + SCOPED_CACHE_UNLINK_CHUNK));
		await pipeline.exec();
		return tally;
	},
	async reapIndexedEntries(rawKeyOf, epochTtlSeconds) {
		const tally = {
			indexKeys: 0,
			reaped: 0,
			strandedSweptKeys: 0
		};
		const collectionIndexKeysPrefix = scopedCacheCollectionIndexKeysKey("");
		const indexKeyPrefix = `${scopedCacheIndexPrefix()}fingerprint:`;
		const sweptKeyPrefix = `${scopedCacheIndexPrefix()}swept:`;
		const generationRead = await useScriptedSharedRedis().scopedCacheIndexGenerationRead(scopedCacheIndexGenerationKey());
		for await (const foundKeys of scanScopedCacheKeys(`${scopedCacheIndexGlobPrefix()}*`)) {
			const indexKeys = foundKeys.filter((foundKey) => {
				return foundKey.startsWith(indexKeyPrefix);
			});
			for (const collectionIndexKeysKey of foundKeys) {
				if (!collectionIndexKeysKey.startsWith(collectionIndexKeysPrefix)) continue;
				for await (const _livePage of scanCollectionIndexKeys(collectionIndexKeysKey));
			}
			const sweptKeys = foundKeys.filter((foundKey) => {
				return foundKey.startsWith(sweptKeyPrefix);
			});
			if (sweptKeys.length > 0) tally.strandedSweptKeys += await useCacheRedis().sadd(scopedCacheSweptIndexKeysKey(), sweptKeys);
			tally.indexKeys += indexKeys.length;
			const pageKeysByCollection = /* @__PURE__ */ new Map();
			for (const indexKey of indexKeys) {
				let scanCursor = "0";
				let setCollection = null;
				do {
					const [next, members] = await useCacheRedis().sscan(indexKey, scanCursor, "COUNT", SCOPED_CACHE_INDEX_SCAN_COUNT);
					scanCursor = next;
					if (setCollection === null && members.length > 0) setCollection = parseScopedCacheIndexMember(members[0]).fingerprint.collection;
					tally.reaped += await reapIndexMembers(indexKey, members, rawKeyOf, epochTtlSeconds);
				} while (scanCursor !== "0");
				if (setCollection !== null) {
					const collectionKeys = pageKeysByCollection.get(setCollection) ?? [];
					collectionKeys.push(indexKey);
					pageKeysByCollection.set(setCollection, collectionKeys);
				}
			}
			await registerCollectionIndexKeys(pageKeysByCollection);
		}
		const markedComplete = await useScriptedSharedRedis().scopedCacheIndexCompleteMark(scopedCacheCollectionIndexKeysCompleteKey(), scopedCacheIndexGenerationKey(), scopedCacheFillPauseKey(), generationRead) === 1;
		useLogger().info(markedComplete ? `[scoped-cache] index-key sets marked complete at generation ${generationRead}` : `[scoped-cache] index-key sets not marked complete: a deploy since generation ${generationRead}, or a deploy's fill pause runs`);
		return tally;
	},
	async dropIndex() {
		const tally = {
			dropped: 0,
			refused: 0
		};
		const collectionIndexKeysPrefix = scopedCacheCollectionIndexKeysKey("");
		const sweptIndexKeysKey = scopedCacheSweptIndexKeysKey();
		for await (const foundKeys of scanScopedCacheKeys(`${scopedCacheIndexGlobPrefix()}*`)) {
			const batchTally = await unlinkScopedCacheKeys(foundKeys.filter((foundKey) => {
				return foundKey !== sweptIndexKeysKey && !foundKey.startsWith(collectionIndexKeysPrefix);
			}));
			tally.dropped += batchTally.dropped;
			tally.refused += batchTally.refused;
		}
		return tally;
	},
	async readPurgeEpochs(epochKeys) {
		return useCacheRedis().mget([...epochKeys]).catch(() => null);
	},
	async bumpPurgeEpochs(epochKeys, ttlSeconds) {
		await useScriptedRedis().scopedCacheEpochBump(epochKeys.length, ...epochKeys, ttlSeconds);
	},
	indexKeysComplete() {
		return collectionIndexKeysComplete();
	},
	async recordBuildIdentity(buildIdentity, fillPauseMs) {
		const [changed, fillPauseLeftMs] = await useScriptedSharedRedis().scopedCacheIndexBuildRecord(scopedCacheIndexBuildKey(), scopedCacheIndexGenerationKey(), scopedCacheFillPauseKey(), buildIdentity, fillPauseMs);
		return {
			buildChanged: changed === 1,
			fillPauseLeftMs
		};
	},
	async watchFillPause(watcherNodeId, watchMs) {
		const [fillPauseLeftMs, watching] = await useScriptedSharedRedis().scopedCacheFillPauseWatch(scopedCacheFillPauseKey(), scopedCacheFillPauseWatchKey(), watcherNodeId, watchMs);
		return {
			fillPauseLeftMs,
			watching: watching === 1
		};
	},
	async endFillPause(buildIdentity) {
		return await useScriptedSharedRedis().scopedCacheFillPauseEnd(scopedCacheFillPauseKey(), scopedCacheFillPauseWatchKey(), buildIdentity) === 1;
	},
	onStoreReady(listener) {
		const redis = useCacheRedis();
		if (redis.status === "ready") listener();
		redis.on("ready", listener);
	}
};
/** The scoped cache index as Redis holds it. */
function redisScopedCacheStore() {
	return redisStore;
}

//#endregion
export { parseScopedCacheIndexMember, redisScopedCacheStore, renderScopedCacheIndexMember, scopedCacheCollectionIndexKeysPruneScript, scopedCacheCollectionIndexKeysRegisterScript, scopedCacheEpochBumpScript, scopedCacheEpochKey, scopedCacheFillPauseEndScript, scopedCacheFillPauseWatchScript, scopedCacheFingerprintIndexKeys, scopedCacheHomePin, scopedCacheIndexBuildRecordScript, scopedCacheIndexCompleteMarkScript, scopedCacheIndexFileScript, scopedCacheIndexGenerationReadScript, scopedCacheIndexReapScript, scopedCacheRowHomePinKeys, scopedCacheRowIndexKeys, scopedCacheSweepMoveScript };