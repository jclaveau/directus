import { useEnv } from '@directus/env';
import emitter from '../emitter.js';
import {
	resolvedCacheTtl,
} from '../cache-config.js';
import {
	queueCacheAnomaly,
	queueCachePurge,
} from '../cache-events.js';
import {
	useLogger,
} from '../logger/index.js';
import {
	redisConfigAvailable,
	useRedis,
} from '../redis/index.js';
import {
	type PendingScopedCachePurge,
	clearPendingScopedCachePurges,
	countFailedScopedCachePurgeRetry,
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
} from '../scoped-cache-pending-purges.js';
import {
	getMilliseconds,
} from '../utils/get-milliseconds.js';
import type { EventContext, SchemaOverview, ScopedCacheTag } from '@directus/types';
import type { Keyv } from 'keyv';
import {
	scopedCacheTagKey,
	scopedCacheTagLabel,
} from './tags.js';

const env = useEnv();

/**
 * Whether scoped (tag-based) cache purging is active. Requires the opt-in mode AND a
 * Redis cache store, since the tag→keys index lives in Redis sets. Any other config
 * falls back to full flush.
 */
export function scopedCachePurgeEnabled(): boolean {
	return (
		env['CACHE_AUTO_PURGE_MODE'] === 'scoped' &&
		env['CACHE_STORE'] === 'redis' &&
		redisConfigAvailable()
	);
}

/**
 * Fail fast at startup: scoped cache purging drives Redis SCAN + multi-key DEL over
 * a single node, so it only works on a standalone client. A cluster client would
 * silently under-purge (keys on other nodes never scanned) and leave stale slices.
 * `useRedis()` always builds a standalone `Redis` in core, so this only bites a
 * custom override — surface it at boot rather than as a mid-request stale HIT.
 */
export function assertScopedCacheRedisSupported(): void {
	if (scopedCachePurgeEnabled() && useRedis().isCluster) {
		throw new Error(
			'CACHE_AUTO_PURGE_MODE=scoped is not implemented for Redis cluster clients '
			+ '(SCAN and multi-key DEL are single-node). Use a standalone Redis or '
			+ 'CACHE_AUTO_PURGE_MODE=full.',
		);
	}
}

// The slice tag keys a collection currently owns, so a collection-wide purge reads
// them instead of walking the whole keyspace to find them again.
/**
 * A per-collection purge counter, bumped every time that collection's tags are
 * dropped. `*` is the wholesale entry, bumped by a flush that names no collection.
 */
function scopedCacheEpochKey(collection: string): string {
	return `${env['CACHE_NAMESPACE']}:epoch:${collection}`;
}

/**
 * Read the purge counters of the collections a read depends on.
 *
 * A read's tags reach the index only in `respond`, long after the rows were fetched:
 * a purge landing in between finds nothing to drop, and the fill then stores rows it
 * already superseded — stale for the whole TTL, and (its tag sets having just been
 * deleted) unreachable to every later purge. Comparing the counter captured before
 * the query against the one at fill time is what closes that window.
 */
export async function readScopedCacheEpochs(
	collections: Iterable<string>,
): Promise<Record<string, string | null>> {
	// Every read pays this round trip, so it is skipped wherever its answer cannot
	// matter: nothing is filled with the response cache off.
	if (
		!env['CACHE_ENABLED'] ||
		!scopedCachePurgeEnabled() ||
		!redisConfigAvailable()
	) {
		return {};
	}

	// `*` rides along so a wholesale flush invalidates an in-flight read too.
	const names = [...new Set([...collections, '*'])];

	// A read that cannot reach the counters still has to answer. Capturing nothing
	// leaves the fill unguarded, exactly as it is with no redis at all — the same
	// trade the response cache makes everywhere else.
	const values = await useRedis()
		.mget(names.map(scopedCacheEpochKey))
		.catch((): (string | null)[] => []);

	return Object.fromEntries(
		names.map((name, index) => [name, values[index] ?? null]),
	);
}

/**
 * Bump the counters of the collections a purge just dropped tags for. Expiring, so
 * a collection nothing writes to stops costing a key; a read whose counter expired
 * between capture and fill reads `null` on both sides and caches, which is right —
 * nothing purged it in between.
 */
async function bumpScopedCacheEpochs(
	collections: Iterable<string>,
): Promise<void> {
	if (!scopedCachePurgeEnabled() || !redisConfigAvailable()) {
		return;
	}

	const names = [...new Set(collections)];

	if (names.length === 0) {
		return;
	}

	// Best effort, and the whole of it: this runs BEFORE the sweep, so letting a
	// client that cannot take the command through would abort the purge itself —
	// trading every entry it was about to drop for the one racing fill the counter
	// would have refused.
	try {
		const pipeline = useRedis().pipeline();
		appendScopedCacheEpochBumps(pipeline, names);
		await pipeline.exec();
	}
	catch {
		// See above: the sweep behind this is what makes the cache correct.
	}
}

/**
 * Queue the bumps onto a pipeline the caller is already sending, so a purge pays no
 * round trip of its own for them. Redis runs a pipeline's commands in the order they
 * were queued, so a sweep appended after these still reads its members AFTER the
 * counters moved — which is the ordering the guard rests on.
 */
function appendScopedCacheEpochBumps(
	pipeline: ReturnType<ReturnType<typeof useRedis>['pipeline']>,
	collections: Iterable<string>,
): void {
	if (!scopedCachePurgeEnabled() || !redisConfigAvailable()) {
		return;
	}

	for (const name of new Set(collections)) {
		pipeline.incr(scopedCacheEpochKey(name));

		pipeline.expire(
			scopedCacheEpochKey(name),
			SCOPED_CACHE_EPOCH_TTL_SECONDS,
		);
	}
}

function scopedCacheCollectionSlicesKey(collection: string): string {
	return `${env['CACHE_NAMESPACE']}:slices:${collection}`;
}

/**
 * The collections a delete on `collection` also changes through the database's own
 * `ON DELETE` rules. It applies them itself, so nothing else ever purges them.
 *   - `CASCADE` deletes the rows, so the walk carries on into their own children.
 *   - `SET NULL` and `SET DEFAULT` leave the rows in place carrying a changed
 *     foreign key — a slice they have left — and stop there, since nothing below
 *     a surviving row changes.
 *   - a rule reaching back into `collection` reports it like any other: the rows
 *     the database changes there are ones the caller never named, so the snapshot
 *     taken from its keys does not cover them.
 *   - a DIRECT self-relation that only rewrites a foreign key is left out: the
 *     surviving children stay in place carrying a slice this walk cannot name. The
 *     delete purges those vacated slices precisely instead — see the collaborator's
 *     `vacatedSelfRelationTags`, unioned into the delete's snapshot.
 */
export function scopedCacheCollectionsChangedByOnDelete(
	schema: Pick<SchemaOverview, 'relations'>,
	collection: string,
): string[] {
	const changedCollections = new Set<string>();
	// Separate from the reported set: a collection reached by a non-propagating rule
	// first and a cascade later must still be walked into on the cascading path.
	// Seeded with the root, which terminates a collection cascading into itself.
	const walkedCollections = new Set<string>([collection]);
	const pendingCollections = [collection];

	while (pendingCollections.length > 0) {
		const parentCollection = pendingCollections.shift()!;

		for (const relation of schema.relations) {
			// A relation's `collection` holds the FK; `related_collection` is its parent.
			const onDeleteRule = relation.schema?.on_delete;
			const childCollection = relation.collection;

			if (
				relation.related_collection !== parentCollection
				|| onDeleteRule === undefined
				|| onDeleteRule === null
				// NO ACTION and RESTRICT make the database refuse the delete
				// instead, so they leave nothing to purge.
				|| ['CASCADE', 'SET NULL', 'SET DEFAULT'].includes(onDeleteRule) === false
			) {
				continue;
			}

			// Only a DIRECT self-relation is exempt, and only when it rewrites
			// rather than deletes: its survivors are handled by vacatedSelfRelationTags.
			if (
				parentCollection === collection
				&& childCollection === collection
				&& onDeleteRule !== 'CASCADE'
			) {
				continue;
			}

			changedCollections.add(childCollection);

			// CASCADE removes the rows, so their own children follow. The other rules
			// leave them in place, and nothing below a surviving row changes.
			if (onDeleteRule === 'CASCADE' && ! walkedCollections.has(childCollection)) {
				walkedCollections.add(childCollection);
				pendingCollections.push(childCollection);
			}
		}
	}

	return [...changedCollections];
}

/**
 * How much longer a tag set lives than the entries it indexes. Every write that
 * files a key into the set re-`EXPIRE`s it, so at 1 it would already outlive its
 * newest member; the doubling is slack, not arithmetic — for an entry orphaned by
 * a crash between the write and its purge, and for siblings written outside this
 * pipeline. A tag set holds keys, not payloads, so the slack is nearly free.
 */
const SCOPED_CACHE_TAG_TTL_FACTOR = 2;

// Long enough that no read outlives its own capture, short enough that a
// collection nobody writes to stops holding a key.
const SCOPED_CACHE_EPOCH_TTL_SECONDS = 24 * 60 * 60;

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

/**
 * Read a set of tag sets, drop them, and prune the slice index that names them — as
 * one step, so no other client can act between any two of those.
 *
 * The counter bumps ride along at the top, before anything is read, which is the
 * ordering `respond`'s post-fill comparison rests on: a read still in flight
 * either sees the new counter and declines, or had already filed its tags and is
 * swept here.
 *
 * Members are gathered with a `SMEMBERS` per key and deduped in Lua rather than
 * by `SUNION`, for two reasons: the union has to be built before the sets are
 * dropped anyway, and `unpack`ing an unbounded key list into one call overflows
 * Lua's stack (`LUAI_MAXCSTACK`) on a collection with enough slices.
 *
 * KEYS are the tag sets. ARGV is the epoch TTL, how many epoch keys follow, those
 * keys, and then `sliceIndexKey, tagKey` pairs for the prunings.
 */
export const scopedCacheSweepScript = `
local epochTtl = tonumber(ARGV[1])
local epochCount = tonumber(ARGV[2])

for i = 1, epochCount do
	local epochKey = ARGV[2 + i]
	redis.call('INCR', epochKey)
	redis.call('EXPIRE', epochKey, epochTtl)
end

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

	redis.call('DEL', KEYS[i])
end

for i = 3 + epochCount, #ARGV, 2 do
	redis.call('SREM', ARGV[i], ARGV[i + 1])
end

return members
`;

/**
 * Index a freshly-cached response key under every tag its data came from, so a later
 * mutation can drop just the matching entries instead of the whole namespace. Both
 * the payload key and its `__expires_at` sibling are tagged. When a cache TTL is
 * set, each tag set self-expires at `SCOPED_CACHE_TAG_TTL_FACTOR` times that TTL, as
 * a net for members orphaned by a crash between write and purge; with no TTL
 * (`CACHE_TTL` unset) the cached entries never expire either, so the tag sets are
 * left unbounded to match — a normal purge still drains them.
 */
export async function tagScopedCacheKeys(
	key: string,
	scopedCacheTags: Iterable<ScopedCacheTag>,
	extraSiblings: string[] = [],
): Promise<void> {
	if (!scopedCachePurgeEnabled()) {
		return;
	}

	const taggedKeys = new Set<string>();

	for (const tag of scopedCacheTags) {
		taggedKeys.add(scopedCacheTagKey(tag));
	}

	if (taggedKeys.size === 0) {
		return;
	}

	const redis = useRedis();

	const ttlSeconds = Math.ceil(getMilliseconds(resolvedCacheTtl(), 0) / 1000)
		* SCOPED_CACHE_TAG_TTL_FACTOR;

	const pipeline = redis.pipeline();
	const filedKeys = new Set<string>();

	for (const tag of scopedCacheTags) {
		const tagKey = scopedCacheTagKey(tag);

		if (filedKeys.has(tagKey)) {
			continue;
		}

		filedKeys.add(tagKey);

		// `extraSiblings` = other keys written with the entry a purge must also drop
		// — e.g. the dev-only `${key}__tags` sibling (respond.ts). Empty by default.
		const members = [key, `${key}__expires_at`, ...extraSiblings];

		if (ttlSeconds > 0) {
			pipeline.eval(
				scopedCacheTagExpiryScript,
				1,
				tagKey,
				ttlSeconds,
				...members,
			);
		}
		else {
			pipeline.sadd(tagKey, ...members);
		}

		// The bare tag is where a collection-wide purge starts, so filing it would
		// only name a key that purge already holds.
		if (tag.field === undefined) {
			continue;
		}

		const slicesKey = scopedCacheCollectionSlicesKey(tag.collection);

		// Same expiry as the tag sets it names, written in the same pipeline, so the
		// index cannot outlive — or predecease — what it points at.
		if (ttlSeconds > 0) {
			pipeline.eval(
				scopedCacheTagExpiryScript,
				1,
				slicesKey,
				ttlSeconds,
				tagKey,
			);
		}
		else {
			pipeline.sadd(slicesKey, tagKey);
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
}

/**
 * How many cache entries each scoped tag currently indexes — the blast radius of
 * purging that tag. Keyed by the tag's display string (`collection` or
 * `collection:field=value`, which maps 1:1 to the `<namespace>:tag:<…>` set key).
 */
export async function countScopedCacheTagMembers(
	displayTags: readonly string[],
): Promise<Record<string, number>> {
	if (!scopedCachePurgeEnabled() || displayTags.length === 0) {
		return {};
	}

	const redis = useRedis();
	const pipeline = redis.pipeline();

	for (const tag of displayTags) {
		pipeline.scard(scopedCacheTagKeyFromLabel(tag));
	}

	const results = await pipeline.exec();
	const counts: Record<string, number> = {};

	displayTags.forEach((tag, index) => {
		counts[tag] = Number(results?.[index]?.[1] ?? 0);
	});

	return counts;
}

/**
 * Delete the cache entries a set of tag keys point to, then drop the tag sets.
 * Shared by the scoped purge (specific value slices) and the collection-wide
 * fallback (every slice).
 *
 * Returns how many cache ENTRIES it actually deleted, which is neither how many keys
 * it deleted nor how many the tag sets named.
 *
 * Not the key count, because a tag set holds each entry alongside its `__expires_at`
 * sibling and any extra sibling (`__tags`), so counting members would report every
 * entry twice over. A sidecar is recognisable by its base key being in the set
 * beside it — the `sadd` writes them together — which stays right as siblings are
 * added.
 *
 * Not the membership count either, because nothing ever SREMs: a member that expired
 * by TTL stays named by the set until the set itself is dropped here. On the
 * workload this fork exists for — per-user keys, so high cardinality, TTLs shorter
 * than the gap between mutations — most of a set can be entries that were already
 * gone, and counting them would inflate every purge figure on the page. So the
 * store's own answer decides. Only an explicit `false` is evidence the key was
 * absent; a store that reports nothing leaves the count where it was rather than
 * silently collapsing it to zero.
 */
// The suffixes a cached response's siblings carry. They ride the same tag set as
// the payload key, so both the purge (which must not count them as evictions of
// their own) and the recovery report (which must not name them as stale entries)
// need the same answer to "whose sidecar is this?".
const SCOPED_CACHE_SIDECAR_SUFFIXES = ['__expires_at', '__tags'];

function scopedCacheSidecarOwner(member: string): string | null {
	const suffix = SCOPED_CACHE_SIDECAR_SUFFIXES
		.find((candidate) => member.endsWith(candidate));

	return suffix === undefined
		? null
		: member.slice(0, -suffix.length);
}

/** The collection a tag key names, bare tag or value slice alike. */
function scopedCacheCollectionOfTagKey(tagKey: string): string | null {
	const tagPrefix = `${env['CACHE_NAMESPACE']}:tag:`;

	if (!tagKey.startsWith(tagPrefix)) {
		return null;
	}

	const label = tagKey.slice(tagPrefix.length);
	const fieldAt = label.indexOf(':');

	return fieldAt === -1
		? label
		: label.slice(0, fieldAt);
}

async function purgeScopedCacheTagKeys(
	cache: Keyv,
	tagKeys: string[],
): Promise<number> {
	// `redis.del()` with no keys throws — a `cache.purge` filter (or an empty
	// collection scan) can leave nothing to purge.
	if (tagKeys.length === 0) {
		return 0;
	}

	const redis = useRedis();

	// Collect the slice-index prunings before the sweep runs, so the script can do
	// them in the same step. A collection name cannot hold a `:`, so the first one
	// after the prefix is where the field starts; a bare collection tag has none and
	// is not in any slice index.
	const tagPrefix = `${env['CACHE_NAMESPACE']}:tag:`;
	const sliceIndexPrunings: string[] = [];

	for (const tagKey of tagKeys) {
		const label = tagKey.startsWith(tagPrefix)
			? tagKey.slice(tagPrefix.length)
			: '';

		const fieldAt = label.indexOf(':');

		if (fieldAt === -1) {
			continue;
		}

		sliceIndexPrunings.push(
			scopedCacheCollectionSlicesKey(label.slice(0, fieldAt)),
			tagKey,
		);
	}

	const epochKeys = scopedCachePurgeEnabled() && redisConfigAvailable()
		? [
			...new Set(
				tagKeys
					.map(scopedCacheCollectionOfTagKey)
					.filter((collection): collection is string => collection !== null),
			),
		].map(scopedCacheEpochKey)
		: [];

	// One atomic step, not a pipeline: a pipeline only fixes the ORDER its own
	// commands run in, and any other client's command may still land between two of
	// them. A read filing its tags between the member read and the DEL below used to
	// have the set it had just written to deleted underneath it — leaving a correct
	// entry indexed by nothing, which no later purge could reach and which the
	// counter guard cannot catch, since that read captured after the bump and is
	// right to cache. Inside a script the interleaving cannot exist: a concurrent
	// SADD either precedes the whole sweep (its key is a member, and its entry is
	// deleted below) or follows it (its set is new, and the next purge finds it).
	const members = await redis.eval(
		scopedCacheSweepScript,
		tagKeys.length,
		...tagKeys,
		String(SCOPED_CACHE_EPOCH_TTL_SECONDS),
		String(epochKeys.length),
		...epochKeys,
		...sliceIndexPrunings,
	) as string[];

	const wasDeleted = await Promise.all(members.map((member) => {
		return cache.delete(member);
	}));

	const present = new Set(members);

	return members.filter((member, index) => {
		if (wasDeleted[index] === false) {
			return false;
		}

		const owner = scopedCacheSidecarOwner(member);

		return owner === null || present.has(owner) === false;
	}).length;
}

/**
 * Cursor-scan every Redis key matching `match`. A single-node SCAN only covers the
 * whole keyspace on a standalone client; a cluster would miss keys on other nodes.
 * Scoped mode is refused on a cluster at startup
 * (`assertScopedCacheRedisSupported`), so the client here is always standalone.
 */
async function scanScopedCacheTagKeys(match: string): Promise<string[]> {
	const redis = useRedis();
	const found: string[] = [];
	let cursor = '0';

	do {
		const [next, batch] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 250);
		cursor = next;
		found.push(...batch);
	}
	while (cursor !== '0');

	return found;
}

/**
 * Drop every scoped-tag index SET (`<namespace>:tag:*`). These are written direct
 * via ioredis `sadd`, outside any Keyv namespace, so a response `cache.clear()`
 * never reaches them — they would linger as orphan pointers until their `ttl*2`
 * self-expiry. The `Response cache` flush calls this alongside `cache.clear()` for a
 * clean wipe. Only the SET keys are dropped; the entries they pointed at are already
 * gone with the namespace clear.
 */
export async function dropScopedCacheTagIndex(): Promise<void> {
	if (!redisConfigAvailable()) {
		return;
	}

	// BEFORE the scan, like every other sweep: a read that captured the counter
	// earlier and files its tags between the DEL below and a bump made after it
	// would compare equal, keep its entry, and leave it indexed by a set this
	// function just deleted — reachable to no later purge. Bumping first is what
	// makes such a read decline. Unconditional, so a flush finding no tag set still
	// invalidates the reads in flight across the `cache.clear()` that preceded it.
	// Names no collection, so it moves the wholesale counter every read captures.
	await bumpScopedCacheEpochs(['*']);

	const tagKeys = [
		...await scanScopedCacheTagKeys(`${env['CACHE_NAMESPACE']}:tag:*`),
		...await scanScopedCacheTagKeys(`${env['CACHE_NAMESPACE']}:slices:*`),
	];

	if (tagKeys.length === 0) {
		return;
	}

	// Array form: this list is a whole-keyspace scan, so it is the longest of them.
	await useRedis().del(tagKeys);
}

/**
 * Purge every cached read of `collection` — its bare collection tag plus all its
 * value slices — without full-flushing the namespace. The fallback when a mutation's
 * scope values are unresolvable (e.g. an upsert mixing inserts and updates): which
 * slices changed is unknown, but only reads touching THIS collection can be stale,
 * so scope the flush to its tag sets and spare every other collection's entries.
 */
export async function purgeCollectionScopedCache(
	cache: Keyv,
	collection: string,
	scopedCachePurgeId?: string,
): Promise<void> {
	const bareKey = `${env['CACHE_NAMESPACE']}:tag:${collection}`;

	await bumpScopedCacheEpochs([collection]);

	// Read off the index each slice files itself into, rather than walking the whole
	// keyspace for keys that a collection owning none can never yield.
	const startedAt = Date.now();

	const sliceKeys = await useRedis().smembers(
		scopedCacheCollectionSlicesKey(collection),
	);

	const tagKeys = [bareKey, ...sliceKeys];

	const evicted = await purgeScopedCacheTagKeys(cache, tagKeys);

	// The expensive mode, and the one nothing else records: every slice of the
	// collection went, because which slices actually changed was unresolvable.
	// No tag list: every slice the index happened to name is derived rather than
	// chosen, and unbounded. `collection` plus the mode already state the reach.
	queueCachePurge({
		purgeId: scopedCachePurgeId,
		collection,
		mode: 'collection',
		scopedCacheTags: null,
		scopedCacheTagCount: tagKeys.length,
		evicted,
		durationMs: Date.now() - startedAt,
	});
}

/**
 * Run a purge, and on failure record it for a later retry instead of throwing.
 *
 * A purge is awaited by its mutation but runs after the transaction, so by the
 * time it can fail the write is durable. Propagating the error would answer 500
 * for a write that succeeded, and the client's natural response — retry — turns a
 * stale cache entry into a duplicate row on any non-idempotent mutation. The
 * entry is the smaller harm, so the request wins and the purge is finished later.
 *
 * Nothing is lost meanwhile: a cache read fails open (`cache.ts` catches and
 * treats a Redis error as a MISS), so while Redis is unreachable no stale entry
 * can be SERVED. The recorded purge only has to beat Redis coming back.
 *
 * Returns whether the purge ran, so the caller can skip the telemetry that would
 * otherwise report a purge that did not happen.
 */
async function purgeOrRecord(
	run: () => Promise<void>,
	pending: PendingScopedCachePurge,
): Promise<boolean> {
	try {
		await run();
		return true;
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[scoped-cache] purge failed and was recorded for retry: ${error}`,
		);

		await recordPendingScopedCachePurge(pending, error);
		return false;
	}
}

/**
 * Rebuild a tag key from the display label a pending purge stored. The label is
 * namespace-free on purpose, so this resolves against whatever `CACHE_NAMESPACE`
 * is at retry time rather than the one that was set when the purge failed.
 */
function scopedCacheTagKeyFromLabel(label: string): string {
	return `${env['CACHE_NAMESPACE']}:tag:${label}`;
}

// The drain in flight, so the next trigger queues behind it rather than beside it.
let pendingScopedCachePurgeDrain: Promise<number> = Promise.resolve(0);

/**
 * Finish the purges that failed after their mutation committed. Called at boot
 * and whenever the shared Redis client reports ready, which are the two moments a
 * previously unreachable Redis can have come back.
 *
 * Serialized, never overlapped: `ready` can fire while a drain is still running,
 * and two of them read the same rows and report the same stale entry to the
 * anomaly stream twice. Chaining rather than sharing the in-flight promise, so a
 * purge recorded mid-drain still gets its own pass instead of being answered by a
 * run that started before it existed.
 */
export function retryPendingScopedCachePurges(): Promise<number> {
	const drained = pendingScopedCachePurgeDrain
		.catch(() => 0)
		.then(() => drainPendingScopedCachePurges());

	pendingScopedCachePurgeDrain = drained;

	return drained;
}

/**
 * Retries the recorded targets, never the namespace: a failure records what it
 * could not drop, so recovery drops exactly that and every other slice stays
 * warm. Returns how many recorded rows it cleared — not how many targets they
 * collapsed into, since an outage records one slice once per write that touched
 * it and the operator reads the table, not the grouping.
 */
/**
 * Whether the response store can actually drop an entry right now.
 *
 * Keyv reports a store error by emitting `error` and answering `undefined`, so a
 * failed `delete` is indistinguishable from a successful one at the call site —
 * which is what let a drain clear its records while purging nothing. A write read
 * back is the one answer that cannot be swallowed.
 *
 * The probe rides the cache's own namespace and carries a short ttl, so a process
 * that dies between the write and the delete leaves nothing behind for long.
 */
async function scopedCacheStoreDropsEntries(cache: Keyv): Promise<boolean> {
	const probeKey = '__scoped_cache_recovery_probe';

	try {
		await cache.set(probeKey, 1, 30_000);

		if (await cache.get(probeKey) !== 1) {
			return false;
		}

		// Only once it is known to be there: a store that swallowed the write has
		// nothing to clean up, and the delete would be swallowed too.
		await cache.delete(probeKey);
		return true;
	}
	catch {
		// A store that throws rather than swallowing is just as unusable.
		return false;
	}
}

async function drainPendingScopedCachePurges(): Promise<number> {
	if (!redisConfigAvailable()) {
		return 0;
	}

	const pending = await listPendingScopedCachePurges();

	if (pending.length === 0) {
		return 0;
	}

	// Imported lazily so the module graph stays acyclic: `cache.js` imports this
	// module for `dropScopedCacheTagIndex`, so a static import back would close
	// the loop. Same reason `cache-config.ts` defers its database import.
	const { getCache } = await import('../cache.js');
	const { cache } = getCache();

	if (!cache) {
		return 0;
	}

	// The tags and the entries sit behind two different clients — ioredis carries the
	// tag sets, the response cache is a Keyv over node-redis — and only the first
	// one's `ready` starts this drain. The store rejects a command issued while it is
	// offline (`disableOfflineQueue`) and `@keyv/redis` swallows that into
	// `undefined`, so a drain in that window deletes no entry, reports every purge a
	// success and clears the records that are the only thing left pointing at them.
	//
	// Written and read back rather than asked: `isReady` is false both while the
	// client is offline AND before it has ever dialed, and node-redis dials on its
	// first command — so reading it would retire the boot drain, which is the pass
	// that exists for a process that restarted while Redis was away. A round-trip
	// answers the question that actually matters, and dials the client on the way.
	if (await scopedCacheStoreDropsEntries(cache) === false) {
		return 0;
	}

	let cleared = 0;

	for (const target of pending) {
		const tagKeys = target.scopedCacheTags.map(scopedCacheTagKeyFromLabel);

		try {
			// Guarded on its own: naming the stale entries is best-effort telemetry and
			// reads Postgres, so its failure must not abort the purge — the purge is
			// what makes the cache correct again, and a blocked one stays blocked for
			// every later retry too.
			try {
				await reportRecoveredScopedCacheEntries(tagKeys);
			}
			catch (error: any) {
				useLogger().warn(
					error,
					`[scoped-cache] could not name the entries a purge left stale: ${error}`,
				);
			}

			if (target.mode === 'namespace') {
				await cache.clear();
			}
			else if (target.mode === 'collection') {
				if (target.collection === null) {
					// Nothing here can purge it: `collection` mode IS a collection scan and
					// the column is nullable. Raising drops into the catch below, which
					// keeps the row and counts the attempt — the safe direction, since the
					// alternative silently deletes a record whose entries are still stale.
					throw new Error(
						`collection-mode pending purge ${target.ids} names no collection`,
					);
				}

				await purgeCollectionScopedCache(cache, target.collection);
			}
			else {
				await purgeScopedCacheTagKeys(cache, tagKeys);
			}

			await clearPendingScopedCachePurges(target.ids);
			cleared += target.ids.length;
		}
		catch (error: any) {
			// Left in place deliberately — the next ready/boot tries again. A purge is
			// idempotent, so retrying forever is safe, and giving up would leave the
			// entry stale with nothing else coming for it.
			await countFailedScopedCachePurgeRetry(target.ids, error);
		}
	}

	return cleared;
}

/**
 * Start finishing purges that failed after their mutation committed.
 *
 * Two triggers, because there are two ways a recorded purge becomes runnable
 * again: the process restarted (boot) and the client reconnected (`ready`).
 * ioredis emits `ready` on the first connect too, so the boot call only matters
 * when the client was already up before this listener existed.
 *
 * Not awaited by the caller — recovery is bounded by how much failed, and a boot
 * that blocked on it would be held up by the same Redis that is still down.
 */
export function startScopedCachePurgeRecovery(): void {
	if (!redisConfigAvailable()) {
		return;
	}

	const logger = useLogger();

	const recover = () => {
		retryPendingScopedCachePurges()
			.then((finished) => {
				if (finished > 0) {
					logger.info(`[scoped-cache] finished ${finished} pending purge(s)`);
				}
			})
			.catch((error: any) => {
				logger.warn(error, `[scoped-cache] pending purge retry failed: ${error}`);
			});
	};

	useRedis().on('ready', recover);

	// A purge can also fail with the link UP — `OOM command not allowed` under
	// maxmemory/noeviction, a WRONGTYPE, a LOADING replica — and then no `ready`
	// will ever fire again, leaving the recorded rows (and the stale entries they
	// name) until the next reconnect or a restart. A timer is the only trigger that
	// does not assume the failure was the connection. Unref'd so it cannot hold the
	// process open, and cheap when idle: the drain leaves after one indexed lookup
	// with nothing pending.
	const retryInterval = getMilliseconds(
		env['CACHE_SCOPED_PURGE_RETRY_INTERVAL'],
		0,
	);

	if (retryInterval > 0) {
		setInterval(recover, retryInterval).unref();
	}

	// And again when the response cache's own client comes back: it reconnects on its
	// own schedule, so the drain above can find it still offline and bail, leaving
	// this the only thing that finishes those records.
	void import('../cache.js').then(({ getCache }) => {
		const { cache } = getCache();

		const storeClient = (cache?.store as {
			client?: { on?: (event: string, listener: () => void) => void };
		} | undefined)?.client;

		storeClient?.on?.('ready', recover);
	});

	recover();
}

/**
 * Name the entries a failed purge left stale, on the way to finally dropping
 * them. Emitted HERE rather than at failure time because the anomaly stream is
 * itself Redis-backed — reporting when the purge failed would report nothing in
 * the one case worth reporting, a Redis outage.
 *
 * Best-effort: an entry with no descriptor (stats were off when it was filled)
 * is purged all the same, it just cannot be named on the admin page.
 */
async function reportRecoveredScopedCacheEntries(tagKeys: string[]): Promise<void> {
	if (tagKeys.length === 0) {
		return;
	}

	const { readCacheDescriptorForRedisKey } = await import('../cache-events.js');
	const redis = useRedis();
	const memberLists = await Promise.all(tagKeys.map((key) => redis.smembers(key)));

	// The sidecars ride the same tag set as the entry they belong to, so they are
	// the same stale entry counted two more times.
	const members = [...new Set(memberLists.flat())].filter((member) => {
		return scopedCacheSidecarOwner(member) === null;
	});

	for (const member of members) {
		const descriptor = await readCacheDescriptorForRedisKey(member);

		if (descriptor === null) {
			continue;
		}

		queueCacheAnomaly({
			cacheKey: descriptor.cacheKey,
			reason: 'redis_error',
			detail: 'served stale until a failed purge was retried',
		});
	}
}

/**
 * Purge cached responses affected by a mutation on `collection`. Outside scoped mode
 * the whole data cache is flushed (legacy `cache.clear()` behavior). In scoped mode
 * the bare collection tag (global reads) is always purged alongside the resolved
 * `scopedCacheTags` (the owner/partition slices the mutation touched), leaving every
 * other slice untouched. A `null` `scopedCacheTags` means "values couldn't be
 * resolved" → fall back to a collection-wide purge (bare tag + every slice) rather
 * than risk leaving a slice stale; still narrower than nuking the whole namespace.
 *
 * To purge EVERY entry of a collection, pass `null` — it dispatches to
 * `purgeCollectionScopedCache`, which reads the collection's own slice index and
 * drops the bare tag plus every slice key it names. A bare `[{ collection }]` in the
 * tag list is NOT that: this function deletes exactly the keys it is handed, and a
 * read pinned to a slice (an owner, or its primary key) carries no bare tag, so it
 * survives.
 *
 * `includeCollectionTag: false` drops the bare `{ collection }` tag from the purge —
 * for a cancelled mutation nothing in `collection` changed, so only the hook's own
 * declared (usually foreign) slices should drop, not this collection's global reads.
 */
export async function purgeScopedCache(
	cache: Keyv,
	collection: string,
	scopedCacheTags: ScopedCacheTag[] | null = [],
	context: EventContext | null = null,
	options: {
		includeCollectionTag?: boolean;
		// One mutation can need more than one purge operation — the coarse
		// collection fallback plus the tags a hook declared. Sharing an id across
		// them is what keeps `COUNT(DISTINCT purge_id)` reporting one purge per
		// mutation instead of one per operation. Absent, each operation gets its
		// own id, which is right when it IS its own purge.
		scopedCachePurgeId?: string;
	} = {},
): Promise<ScopedCacheTag[] | null> {
	// Returns the purged tags so a caller can surface them (dev-only debug header):
	// `null` = whole namespace flushed (non-scoped mode); bare `[{ collection }]` =
	// a collection-wide purge; otherwise the resolved slice tags.
	const startedAt = Date.now();

	if (!scopedCachePurgeEnabled()) {
		const cleared = await purgeOrRecord(
			() => cache.clear(),
			{ mode: 'namespace', collection: null, scopedCacheTags: [] },
		);

		if (!cleared) {
			return null;
		}

		// Not folded into the `flush` config-event marker, though both mean "the
		// whole cache went": that marker is a direct, unbuffered INSERT, which is
		// fine for an operator flushing by hand and ruinous here, where this fires
		// on every mutation. They stay distinct events on purpose — `flush` is an
		// operator acting, this is a mutation invalidating everything because
		// scoped mode is off.
		//
		// No tag sets and no member list to count here: the clear takes the whole
		// namespace, so the row records the reach and leaves the size unknown.
		// Zero would draw the most destructive event here as one that took nothing.
		queueCachePurge({
			purgeId: options.scopedCachePurgeId,
			collection: null,
			mode: 'namespace',
			scopedCacheTags: null,
			scopedCacheTagCount: 0,
			evicted: null,
			durationMs: Date.now() - startedAt,
		});

		return null;
	}

	if (scopedCacheTags === null) {
		// Records its own purge — it is the one that knows how many slices the
		// scan turned up.
		await purgeOrRecord(
			() => {
				return purgeCollectionScopedCache(
					cache,
					collection,
					options.scopedCachePurgeId,
				);
			},
			{ mode: 'collection', collection, scopedCacheTags: [] },
		);

		return [{ collection }];
	}

	const resolvedScopedCacheTags = (await emitter.emitFilter(
		'cache.purge',
		options.includeCollectionTag === false
			? [...scopedCacheTags]
			: [{ collection }, ...scopedCacheTags],
		{ collection },
		context,
	)) as ScopedCacheTag[];

	const tagKeys = [...new Set(resolvedScopedCacheTags.map(scopedCacheTagKey))];
	let evicted: number | null = null;

	const purged = await purgeOrRecord(
		async () => {
			evicted = await purgeScopedCacheTagKeys(cache, tagKeys);
		},
		{
			mode: 'slices',
			collection,
			scopedCacheTags: resolvedScopedCacheTags.map(scopedCacheTagLabel),
		},
	);

	if (!purged) {
		return resolvedScopedCacheTags;
	}

	// The tags a mutation actually resolved, in the same display form the entry
	// sidecar stores — so "this entry carries tag X, and tag X was purged at T"
	// is a join rather than a guess.
	queueCachePurge({
		purgeId: options.scopedCachePurgeId,
		collection,
		mode: 'slices',
		scopedCacheTags: resolvedScopedCacheTags.map(scopedCacheTagLabel),
		scopedCacheTagCount: tagKeys.length,
		evicted,
		// Awaited inside the mutation, so this time is ADDED to the write's own
		// latency — a slow purge slows the request that triggered it.
		durationMs: Date.now() - startedAt,
	});

	return resolvedScopedCacheTags;
}
