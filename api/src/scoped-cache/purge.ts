import { useEnv } from '@directus/env';
import { randomUUID } from 'node:crypto';
import emitter from '../emitter.js';
import {
	resolvedCacheTtl,
} from '../cache-config.js';
import {
	cacheExpiresAtKey,
	cacheSidecarOwner,
} from '../cache-sidecars.js';
import {
	queueCacheAnomaly,
	queueCachePurge,
} from '../cache-events.js';
import { cacheStoreDropsEntries } from '../cache-store-probe.js';
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
import type { ChainableCommander, Redis } from 'ioredis';
import type { EventContext, SchemaOverview, ScopedCacheTag } from '@directus/types';
import type { Keyv } from 'keyv';
import { dropCacheEntries } from '../cache-drop.js';
import {
	scopedCachePurgeEnabled,
} from './config.js';
import {
	parseScopedCacheIndexMember,
	renderScopedCacheIndexMember,
	scopedCacheCollectionIndexGlob,
	scopedCacheFingerprintIndexKeys,
	scopedCacheRowIndexKeys,
} from './fingerprint-index.js';
import {
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	scopedCacheFingerprintHolds,
	scopedCacheFingerprintOf,
	scopedCacheFingerprintPurgedBy,
	scopedCacheRowIndexGlobs,
	scopedCacheTagsOfFingerprints,
	type ScopedCacheFingerprint,
} from './fingerprint.js';
import {
	bumpScopedCacheEpochs,
} from './fill-guard.js';
import {
	scopedCacheIndexPrefix,
	scopedCacheTagKey,
	scopedCacheTagKeyPrefix,
	scopedCacheTagLabel,
} from './tags.js';

const env = useEnv();

// The slice tag keys a collection currently owns, so a collection-wide purge reads
// them instead of walking the whole keyspace to find them again.
function scopedCacheCollectionSlicesKey(collection: string): string {
	return `${scopedCacheIndexPrefix()}slices:${collection}`;
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
 *     surviving children stay in place, and the delete snapshots them by key like
 *     an update's rows instead — see the collaborator's `selfRelationSurvivorKeys`.
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

			// Only a DIRECT self-relation is exempt, and only when it rewrites rather
			// than deletes: its survivors are snapshotted by key like an update's rows
			// (`selfRelationSurvivorKeys`), so their slices purge precisely.
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

/**
 * How many tag keys one slice-index call files at once.
 *
 * The members are spread into the call and `unpack`ed inside the script, and both
 * of those have a stack ceiling well below the number of slices one read can be
 * pinned to. The expiry the call carries is the same value for every chunk, so
 * splitting changes nothing but how many calls it takes.
 */
const SCOPED_CACHE_INDEX_CHUNK_MEMBERS = 500;


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
 * arguments, and stack-dependent, so the cap has to be well under any runner's.
 * And a script blocks the whole server while it runs, so the batch also bounds how
 * long one purge can hold Redis away from everything else.
 *
 * Chunking costs the race nothing: each chunk is atomic on its own, and a fill into
 * a set in a later chunk is read and swept by that chunk, while a fill into a set
 * already swept makes a fresh set the next purge finds.
 */
const SCOPED_CACHE_SWEEP_CHUNK_KEYS = 500;

/**
 * Index a freshly-cached response key under every tag its data came from, so a later
 * mutation can drop just the matching entries instead of the whole namespace. Both
 * the payload key and its `__expires_at` sibling are tagged. When a cache TTL is
 * set, each tag set self-expires at `SCOPED_CACHE_TAG_TTL_FACTOR` times that TTL, as
 * a net for members orphaned by a crash between write and purge; with no TTL
 * (`CACHE_TTL` unset) the cached entries never expire either, so the tag sets are
 * left unbounded to match — a normal purge still drains them.
 */
export async function indexScopedCacheEntry(
	key: string,
	fingerprints: readonly ScopedCacheFingerprint[],
	extraSiblings: string[] = [],
	indexPaths: ReadonlyMap<string, string | null> = new Map(),
): Promise<void> {
	if (!scopedCachePurgeEnabled() || fingerprints.length === 0) {
		return;
	}

	// The legacy index still speaks one pin at a time, so the fingerprints are read
	// back flat for it — the only place the AND is dropped on the way in.
	const legacyScopedCacheTags = scopedCacheTagsOfFingerprints(fingerprints);

	const redis = useScriptedRedis();

	const ttlSeconds = Math.ceil(getMilliseconds(resolvedCacheTtl(), 0) / 1000)
		* SCOPED_CACHE_TAG_TTL_FACTOR;

	const pipeline = redis.pipeline() as ScopedCacheTagPipeline;
	const filedKeys = new Set<string>();

	// One entry per collection, not per slice: a read pinned to 200 slices of the
	// same collection files 200 tag keys into ONE index set, and sending that as 200
	// calls costs 200 EXISTS and 200 TTL for a set whose expiry lands on the same
	// value every time. Gathered here and sent below, after the tag sets they name.
	const indexedTagKeys = new Map<string, string[]>();

	for (const tag of legacyScopedCacheTags) {
		const tagKey = scopedCacheTagKey(tag);

		if (filedKeys.has(tagKey)) {
			continue;
		}

		filedKeys.add(tagKey);

		// `extraSiblings` = other keys written with the entry a purge must also drop
		// — e.g. the dev-only `${key}__tags` sibling (respond.ts). Empty by default.
		const members = [key, cacheExpiresAtKey(key), ...extraSiblings];

		if (ttlSeconds > 0) {
			pipeline.scopedCacheTagExpiry(tagKey, ttlSeconds, ...members);
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
		const indexed = indexedTagKeys.get(slicesKey);

		if (indexed === undefined) {
			indexedTagKeys.set(slicesKey, [tagKey]);
		}
		else {
			indexed.push(tagKey);
		}
	}

	// Same expiry as the tag sets they name, written in the same pipeline, so the
	// index cannot outlive — or predecease — what it points at.
	for (const [slicesKey, tagKeys] of indexedTagKeys) {
		for (let at = 0; at < tagKeys.length; at += SCOPED_CACHE_INDEX_CHUNK_MEMBERS) {
			const chunk = tagKeys.slice(at, at + SCOPED_CACHE_INDEX_CHUNK_MEMBERS);

			if (ttlSeconds > 0) {
				pipeline.scopedCacheTagExpiry(slicesKey, ttlSeconds, ...chunk);
			}
			else {
				pipeline.sadd(slicesKey, ...chunk);
			}
		}
	}

	// Filed in the same pipeline as the tag sets above, and holding the same
	// members: a purge that knows the rows it wrote matches fingerprints here and
	// drops only the entries whose whole query case the row satisfies, while one
	// that knows nothing but a tag — a hook's own `purgeBy`, a collection-wide
	// fallback — still sweeps the sets above. Both index the same entry, so
	// whichever a purge reaches it by, the entry goes.
	for (const fingerprint of fingerprints) {
		const fingerprintCollection = fingerprint.collection;
		const indexPath = indexPaths.get(fingerprintCollection) ?? null;

		const indexedMembers = [key, cacheExpiresAtKey(key), ...extraSiblings].map(
			(indexedMember) => renderScopedCacheIndexMember(fingerprint, indexedMember),
		);

		for (const indexKey of scopedCacheFingerprintIndexKeys(
			fingerprint,
			indexPath,
		)) {
			if (ttlSeconds > 0) {
				pipeline.scopedCacheTagExpiry(indexKey, ttlSeconds, ...indexedMembers);
			}
			else {
				pipeline.sadd(indexKey, ...indexedMembers);
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
}

/**
 * How many cache entries each scoped tag currently indexes — the blast radius of
 * purging that tag. Keyed by the tag's display string (`collection` or
 * `collection:field=value`, which maps 1:1 to the
 * `<namespace>:scoped-cache-index:tag:<…>` set key).
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
 * Drop the cache keys a swept index named, and report how many ENTRIES went — which
 * is neither how many keys were deleted nor how many the index named.
 *
 * Not the key count, because an index set holds each entry alongside its
 * `__expires_at` sibling and any extra sibling (`__tags`), so counting keys would
 * report every entry twice over. A sidecar is recognisable by its base key being in
 * the set beside it — the `sadd` writes them together — which stays right as
 * siblings are added.
 *
 * Not the membership count either, because nothing ever SREMs on the way out: a
 * member that expired by TTL stays named by the set until the set itself is dropped.
 * On the workload this fork exists for — per-user keys, so high cardinality, TTLs
 * shorter than the gap between mutations — most of a set can be entries that were
 * already gone, and counting them would inflate every purge figure on the page. So
 * what the store freed decides; `dropCacheEntries` is where that answer comes from.
 */
async function dropSweptScopedCacheEntries(
	cache: Keyv,
	members: readonly string[],
): Promise<number> {
	const present = new Set(members);

	const entries = members.filter((member) => {
		const owner = cacheSidecarOwner(member);

		return owner === null || present.has(owner) === false;
	});

	const entryKeys = new Set(entries);

	const [evicted] = await Promise.all([
		dropCacheEntries(cache, entries),
		dropCacheEntries(cache, members.filter((member) => {
			return entryKeys.has(member) === false;
		})),
	]);

	return evicted;
}

/**
 * How many members one `SSCAN` of an index set is asked to look at per round trip.
 *
 * The set is read in pages rather than whole: a collection's bare set holds every
 * cached read that pinned no index value, and `SMEMBERS` on it would put the
 * whole thing in this process's memory — and hold Redis for the length of the
 * reply — to keep the handful the write actually matched.
 */
const SCOPED_CACHE_INDEX_SCAN_COUNT = 1000;

/**
 * Drop the entries whose whole query case the written rows satisfy, and nothing
 * else.
 *
 * This is the purge #531 exists for. A tag purge asks "is this entry filed under a
 * slice I wrote", and an entry bounded to `owner=alpha AND method=spaced` answers
 * yes to every write carrying `method=spaced`. This one asks the read's own
 * question — does one of the rows I wrote satisfy everything this entry depends on
 * — so the answer is no for every owner but alpha.
 *
 * The index sets it reads are picked by the rows: the bare set, which every write
 * to the collection reads, and the one each row's index value names. A
 * fingerprint filed under a different index value is never even looked at.
 *
 * Matched members are SREMed from the set they were found in: nothing else prunes
 * them, and a purged entry left named by the index would be re-tested by every
 * later write to that index value for as long as the set lives. A member of a
 * SECOND set — an entry bounded to a list of index values — is left behind for
 * its own set's expiry, since finding it would cost a scan of every set to save a
 * string compare.
 */
async function purgeScopedCacheFingerprintIndex(
	cache: Keyv,
	collection: string,
	rowFingerprints: readonly ScopedCacheFingerprint[],
	changed: readonly string[] | null,
	indexPath: string | null,
	includeCollectionTag: boolean,
): Promise<number> {
	if (rowFingerprints.length === 0) {
		return 0;
	}

	// Before anything is read, for the reason the tag sweep bumps them first: a
	// read in flight has to decline rather than cache under an index this purge is
	// about to prune.
	await bumpScopedCacheEpochs([collection]);

	const { evicted } = await purgeScopedCacheIndexWhere(
		cache,
		scopedCacheRowIndexKeys(collection, rowFingerprints, indexPath),
		// The patterns the rows can drop something under, or `null` to read the sets
		// whole. A member matching none of them cannot be purged by these rows, so
		// letting Redis skip it saves sending it; the test still decides.
		scopedCacheRowIndexGlobs(collection, rowFingerprints),
		(fingerprint) => {
			// A fingerprint pinning nothing is what the bare collection tag covers,
			// so a mutation keeping that tag warm keeps these entries too — the
			// global reads a write that opted out of the collection tag means to
			// leave standing.
			if (
				includeCollectionTag === false
				&& Object.keys(fingerprint.pinnedScope).length === 0
			) {
				return false;
			}

			return scopedCacheFingerprintPurgedBy(
				fingerprint,
				rowFingerprints,
				changed,
			);
		},
	);

	return evicted;
}

/**
 * Drop every entry of a collection that a declared pin could have changed.
 *
 * What a hook's own `purgeBy` resolves to, and the one purge driven by no rows: it
 * holds a pin, not a row, so `scopedCacheFingerprintHolds` is the test rather than
 * `scopedCacheFingerprintPurgedBy`.
 *
 * The sets it reads are the declared pins' own when the pin IS what the index is
 * split by — the same two a write of those values would read — and every set the
 * collection owns otherwise, since a pin off the index path says nothing about
 * which split holds it. No glob narrowing either way: a declared pin matches
 * entries by what they do NOT pin as much as by what they do, and a pattern can
 * only select on what is written.
 */
async function purgeScopedCacheDeclaredPins(
	cache: Keyv,
	collection: string,
	declared: readonly ScopedCacheFingerprint[],
	indexPath: string | null,
): Promise<ScopedCachePurgeSweep> {
	const pinsIndexPath = indexPath !== null && declared.every((fingerprint) => {
		return fingerprint.pinnedScope[indexPath] !== undefined;
	});

	const indexKeys = pinsIndexPath
		? scopedCacheRowIndexKeys(collection, declared, indexPath)
		: await scopedCacheCollectionIndexKeys(collection);

	return purgeScopedCacheIndexWhere(cache, indexKeys, null, (fingerprint) => {
		return declared.some((declaredFingerprint) => {
			// A declared pin naming no field is the bare collection tag, and it keeps
			// the reach it always had: the reads that could not be narrowed. Read as a
			// constraint it holds of every entry, which is the collection purge — a
			// different operation, with its own mode and its own record.
			if (Object.keys(declaredFingerprint.pinnedScope).length === 0) {
				return Object.keys(fingerprint.pinnedScope).length === 0;
			}

			// And the converse: an entry pinning nothing holds every pin vacuously,
			// so a declared pin would reach the global reads that no value narrows.
			// Only the bare declared fingerprint above may, which is what a mutation
			// keeping its collection tag sends and a declaring cancel does not — it
			// states that one slice moved, not that the collection did (#292).
			if (Object.keys(fingerprint.pinnedScope).length === 0) {
				return false;
			}

			return scopedCacheFingerprintHolds(fingerprint, declaredFingerprint);
		});
	});
}

/**
 * Purge the tags a mutation could not resolve off the rows it wrote — a hook's own
 * `purgeBy`, and whatever the `cache.purge` filter added to the list.
 *
 * Grouped by the collection each tag names, because a hook is free to declare a tag
 * on another collection entirely and the index is per collection. Only the
 * mutation's own collection has a known index path; a foreign one is read whole,
 * which is what not knowing how it is split costs.
 */
async function purgeScopedCacheDeclaredTags(
	cache: Keyv,
	collection: string,
	declaredTags: readonly ScopedCacheTag[],
	indexPath: string | null,
): Promise<number> {
	if (declaredTags.length === 0) {
		return 0;
	}

	const declaredByCollection = new Map<string, ScopedCacheFingerprint[]>();

	for (const declaredTag of declaredTags) {
		const declared = declaredByCollection.get(declaredTag.collection) ?? [];

		declared.push(
			scopedCacheFingerprintOf(declaredTag.collection, [declaredTag]),
		);

		declaredByCollection.set(declaredTag.collection, declared);
	}

	// Before anything is read, and in a call of its own rather than inside the
	// scans: a purge that is refused still has to leave the counters moved, so a
	// read in flight declines instead of caching under an index this purge was about
	// to prune and will prune on retry.
	await bumpScopedCacheEpochs([...declaredByCollection.keys()]);

	let evicted = 0;

	for (const [declaredCollection, declared] of declaredByCollection) {
		const declaredIndexPath = declaredCollection === collection
			? indexPath
			: null;

		const sweep = await purgeScopedCacheDeclaredPins(
			cache,
			declaredCollection,
			declared,
			declaredIndexPath,
		);

		evicted += sweep.evicted;
	}

	return evicted;
}

/** Every set one collection's fingerprints are filed in, read off the keyspace. */
async function scopedCacheCollectionIndexKeys(
	collection: string,
): Promise<string[]> {
	const indexKeys: string[] = [];

	for await (const batch of scanScopedCacheKeys(
		scopedCacheCollectionIndexGlob(collection),
	)) {
		// One at a time rather than spread: a SCAN is free to answer with more than
		// its COUNT, and a spread long enough throws before the array is touched
		// (https://github.com/jclaveau/directus/issues/397).
		for (const indexKey of batch) {
			indexKeys.push(indexKey);
		}
	}

	return indexKeys;
}

/**
 * What an index purge freed, and the entries it named on the way there — which the
 * recovery drain reports as having served stale, and nothing else reads.
 */
type ScopedCachePurgeSweep = {
	evicted: number;
	matchedKeys: string[];
};

/**
 * Read a set of index sets, keep the members whose fingerprint `purges` accepts,
 * and drop the cache entries they name.
 *
 * Matched members are SREMed from the set they were found in: nothing else prunes
 * them, and a purged entry left named by the index would be re-tested by every
 * later write to that index value for as long as the set lives. A member of a
 * SECOND set — an entry bounded to a list of index values — is left behind for
 * its own set's expiry, since finding it would cost a scan of every set to save a
 * string compare.
 *
 * The counter bump is the caller's: what has to precede the reads here is one move
 * per collection, and only the caller knows which collections it is about to touch.
 */
async function purgeScopedCacheIndexWhere(
	cache: Keyv,
	indexKeys: readonly string[],
	globPatterns: readonly string[] | null,
	purges: (fingerprint: ScopedCacheFingerprint) => boolean,
): Promise<ScopedCachePurgeSweep> {
	const redisClient = useRedis();
	const matchedByIndexKey = new Map<string, Set<string>>();
	const matchedKeys: string[] = [];
	const seenKeys = new Set<string>();

	for (const indexKey of indexKeys) {

		// A member can match several patterns — one per pair it shares with the
		// rows — and the passes overlap, so it is tested and SREMed once.
		const testedMembers = new Set<string>();

		for (const globPattern of globPatterns ?? [null]) {
			let scanCursor = '0';

			do {
				const [next, indexedMembers] = globPattern === null
					? await redisClient.sscan(
						indexKey,
						scanCursor,
						'COUNT',
						SCOPED_CACHE_INDEX_SCAN_COUNT,
					)
					: await redisClient.sscan(
						indexKey,
						scanCursor,
						'MATCH',
						globPattern,
						'COUNT',
						SCOPED_CACHE_INDEX_SCAN_COUNT,
					);

				scanCursor = next;

				for (const indexedMember of indexedMembers) {
					if (testedMembers.has(indexedMember)) {
						continue;
					}

					testedMembers.add(indexedMember);

					const { fingerprint, key } =
						parseScopedCacheIndexMember(indexedMember);

					if (purges(fingerprint) === false) {
						continue;
					}

					const matchedMembers = matchedByIndexKey.get(indexKey) ?? new Set();
					matchedMembers.add(indexedMember);
					matchedByIndexKey.set(indexKey, matchedMembers);

					if (key !== '' && seenKeys.has(key) === false) {
						seenKeys.add(key);
						matchedKeys.push(key);
					}
				}
			} while (scanCursor !== '0');
		}
	}

	if (matchedKeys.length === 0) {
		return { evicted: 0, matchedKeys };
	}

	const [evicted] = await Promise.all([
		dropSweptScopedCacheEntries(cache, matchedKeys),
		pruneScopedCacheIndex(redisClient, matchedByIndexKey),
	]);

	return { evicted, matchedKeys };
}


async function pruneScopedCacheIndex(
	redisClient: Redis,
	matchedByIndexKey: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<void> {
	const redisPipeline = redisClient.pipeline();

	for (const [indexKey, matchedMembers] of matchedByIndexKey) {
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
 *
 * Reports what Redis said it removed and how many commands it refused, rather than
 * what it was handed: a pipeline answers per command, so a chunk that failed is a
 * chunk still there, and a count on its own cannot be told from an index that was
 * already empty.
 */
export interface ScopedCacheUnlinkTally {
	dropped: number;
	refused: number;
}

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

/**
 * Unlink every key under a prefix, a scan batch at a time.
 *
 * Batch by batch rather than collecting first: the list a full flush would collect
 * is the one thing here that grows with the cache, and holding all of it to delete
 * all of it puts the whole index in this process's heap for no gain — the deletes
 * are per-batch round trips either way.
 */
async function unlinkScopedCacheKeysMatching(
	match: string,
): Promise<ScopedCacheUnlinkTally> {
	const tally = { dropped: 0, refused: 0 };

	for await (const batch of scanScopedCacheKeys(match)) {
		const batchTally = await unlinkScopedCacheKeys(batch);

		tally.dropped += batchTally.dropped;
		tally.refused += batchTally.refused;
	}

	return tally;
}

/**
 * Cursor-scan every key under a prefix.
 *
 * `SCAN ... MATCH` filters server-side AFTER iterating, so a pass costs the whole
 * keyspace however few keys match — but only the matches cross the wire, which is
 * why the prefix is worth having.
 *
 * A single-node SCAN only covers the whole keyspace on a standalone client; a
 * cluster would miss keys on other nodes. Scoped mode is refused on a cluster at
 * startup (`assertScopedCacheRedisSupported`), so the client is always standalone.
 */
async function* scanScopedCacheKeys(match: string): AsyncGenerator<string[]> {
	const redis = useRedis();
	let cursor = '0';

	do {
		const [next, batch] = await redis.scan(
			cursor,
			'MATCH',
			match,
			'COUNT',
			SCOPED_CACHE_SCAN_COUNT,
		);

		cursor = next;
		yield batch;
	}
	while (cursor !== '0');
}

/**
 * Drop every scoped-cache index key: the tag SETs
 * (`<namespace>:scoped-cache-index:tag:*`) and the per-collection slice indexes
 * (`<namespace>:scoped-cache-index:slices:*`). These are
 * written direct via ioredis `sadd`, outside any Keyv namespace, so a response
 * `cache.clear()` never reaches them — they would linger as orphan pointers until
 * their `ttl*2` self-expiry, or forever when `CACHE_TTL` is unset and they are
 * deliberately unbounded. The `Response cache` flush calls this alongside
 * `cache.clear()` for a clean wipe. Only the SET keys are dropped; the entries
 * they pointed at are already gone with the namespace clear.
 *
 * Reports how many keys Redis removed and how many commands it refused, so the
 * flush that called it can say what it cost, and say so honestly when the index is
 * still there (https://github.com/jclaveau/directus/issues/468).
 *
 * Runs AFTER `clearResponseCache`, always: that is where the wholesale counter
 * moves, and a read that captured it earlier and files its tags between the unlink
 * below and a move made after it would compare equal, keep its entry, and leave it
 * indexed by a set this function just deleted — reachable to no later purge.
 */
export async function dropScopedCacheIndex(): Promise<ScopedCacheUnlinkTally> {
	if (!redisConfigAvailable()) {
		return { dropped: 0, refused: 0 };
	}

	// The keys the pre-scoped-cache-index layout left behind are not swept here:
	// they went once, in `20260911A-drop-the-pre-scoped-cache-index-layout`.
	return unlinkScopedCacheKeysMatching(`${scopedCacheIndexPrefix()}*`);
}

/**
 * Drop every cached response, the way a read in flight can notice. The wholesale
 * counter — the one every read captures, named for no collection — moves BEFORE
 * the clear, as every purge's counters move before its sweep: a fill that rechecks
 * after the move declines, and one that rechecked before it had written its entry
 * before the clear, which takes it. A clear that moved the counter after itself
 * left a fill rechecking in between kept — stale for its TTL, and once the index
 * drop that follows unlinked its tag sets, reachable to no later purge. Moved
 * whether or not the clear finds anything, since the reads in flight are what it
 * is for.
 *
 * The entries only, so a flush that reports the index drop apart from the clear
 * can; `flushResponseCache` is the two together.
 */
export async function clearResponseCache(cache: Keyv | null): Promise<void> {
	await bumpScopedCacheEpochs(['*']);
	await cache?.clear();
}

/**
 * The flush a system service runs after a change that invalidates every read — a
 * permission, policy, role, access or user change, a field or collection edit, a
 * manual sort. Nothing sweeps the tag index after a raw `clear()`, and its sets
 * would point at keys that no longer exist until their own expiry, or forever when
 * `CACHE_TTL` is unset.
 *
 * Never throws: every caller runs it in a `finally` after its write committed, and
 * Keyv already swallows the clear's own failure, so a scan Redis refuses must not
 * be the one thing that turns a committed change into a failed request. The
 * counter moved and the entries went, or will when Redis is back; sets left
 * behind name keys that are gone and expire on their own.
 */
export async function flushResponseCache(cache: Keyv | null): Promise<void> {
	await clearResponseCache(cache);

	// Gated here, not in the drop: the flush command drops the index whatever the
	// mode, so a store switched out of scoped purging leaves no sets behind — while
	// this runs on every permission, field or collection change, and a scan that
	// walks the whole keyspace for an index that cannot exist is a cost per write.
	if (!scopedCachePurgeEnabled()) {
		return;
	}

	try {
		await dropScopedCacheIndex();
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[scoped-cache] could not drop the tag index after a flush: ${error}`,
		);
	}
}

/**
 * Drop every fingerprint the collection owns, whatever it is bound to, and the sets
 * that named them.
 *
 * The fallback, so it asks no question: a purge reaching here has no rows to match
 * against — an upsert mixing inserts and updates, a write whose rows could not be
 * read back — and cannot tell a stale entry from a warm one. Every other
 * collection's entries still stand, which is the whole of what it is scoped to.
 *
 * Reports the entries it freed and the sets it dropped apart: the first is how wide
 * the purge reached, the second is how split the collection's index was, and only
 * the first is comparable to a row-driven purge's figure.
 */
async function purgeScopedCacheCollectionIndex(
	cache: Keyv,
	collection: string,
): Promise<{ evicted: number; indexKeys: number }> {
	const redis = useRedis();
	const keys: string[] = [];
	const seenKeys = new Set<string>();
	let indexKeys = 0;

	for await (const batch of scanScopedCacheKeys(
		scopedCacheCollectionIndexGlob(collection),
	)) {
		indexKeys += batch.length;

		for (let at = 0; at < batch.length; at += SCOPED_CACHE_SWEEP_CHUNK_KEYS) {
			const chunk = batch.slice(at, at + SCOPED_CACHE_SWEEP_CHUNK_KEYS);

			// The same script the tag sweep runs, and for the same reason: a read
			// filing its key into one of these sets between the read and the drop
			// would otherwise have its set deleted underneath it. No prunings — a
			// fingerprint set is named by nothing but this scan.
			const swept = await redis.eval(
				scopedCacheSweepScript,
				chunk.length,
				...chunk,
			) as string[];

			for (const indexedMember of swept) {
				// The fingerprint half is read past rather than parsed: this purge
				// drops the key whichever query case filed it, so the two members an
				// entry cached under two cases has collapse to one key here.
				const { key } = parseScopedCacheIndexMember(indexedMember);

				if (seenKeys.has(key) === false) {
					seenKeys.add(key);
					keys.push(key);
				}
			}
		}
	}

	return { evicted: await dropSweptScopedCacheEntries(cache, keys), indexKeys };
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
	options: {
		scopedCachePurgeId?: string | undefined;
		// A retried purge is nothing's latency: no write waits on the drain.
		retried?: boolean;
	} = {},
): Promise<void> {
	// Not the sweep's own bump repeated: this one has to precede the slice-index
	// read below, which the sweep never sees. A read filing a NEW slice between that
	// read and the sweep is missed by this purge either way — bumped first, it
	// declines to cache instead of surviving under a slice nothing swept.
	await bumpScopedCacheEpochs([collection]);

	const startedAt = Date.now();

	const { evicted, indexKeys } = await purgeScopedCacheCollectionIndex(
		cache,
		collection,
	);

	// The expensive mode, and the one nothing else records: every slice of the
	// collection went, because which slices actually changed was unresolvable.
	// No tag list: every slice the index happened to name is derived rather than
	// chosen, and unbounded. `collection` plus the mode already state the reach.
	queueCachePurge({
		purgeId: options.scopedCachePurgeId,
		collection,
		mode: 'collection',
		scopedCacheTags: null,
		scopedCacheTagCount: indexKeys,
		evicted,
		durationMs: options.retried === true
			? null
			: Date.now() - startedAt,
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
	return `${scopedCacheTagKeyPrefix()}${label}`;
}

/**
 * What a recorded purge target resolves to: the fingerprints to retry it with,
 * grouped by the collection each names, plus the collections whose record is a
 * display label from before this table held fingerprints.
 *
 * A rendered fingerprint always ends on its `&` terminator and a label never
 * does, which is what tells the two apart. A label cannot be replayed against
 * the fingerprint index — it names a slice the index no longer files anything
 * under — so its collection is purged whole instead: wider than the record asked
 * for, which is the direction a recovery is allowed to miss in.
 */
function recordedScopedCachePurgeTargets(recorded: readonly string[]): {
	declaredByCollection: Map<string, ScopedCacheFingerprint[]>;
	labelledCollections: Set<string>;
} {
	const declaredByCollection = new Map<string, ScopedCacheFingerprint[]>();
	const labelledCollections = new Set<string>();

	for (const target of recorded) {
		if (target.endsWith('&') === false) {
			const fieldAt = target.indexOf(':');

			labelledCollections.add(
				fieldAt === -1
					? target
					: target.slice(0, fieldAt),
			);

			continue;
		}

		const fingerprint = parseScopedCacheFingerprint(target);
		const declared = declaredByCollection.get(fingerprint.collection) ?? [];

		declared.push(fingerprint);
		declaredByCollection.set(fingerprint.collection, declared);
	}

	return { declaredByCollection, labelledCollections };
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
async function drainPendingScopedCachePurges(): Promise<number> {
	if (!redisConfigAvailable()) {
		return 0;
	}

	const pending = await listPendingScopedCachePurges();

	if (pending.length === 0) {
		return 0;
	}

	// Imported lazily so the module graph stays acyclic: `cache.js` imports this
	// module for `dropScopedCacheIndex`, so a static import back would close
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
	if (await cacheStoreDropsEntries(cache) === false) {
		return 0;
	}

	let cleared = 0;
	const reported = new Set<string>();

	// Recorded like the purges it finishes, or the page would show the entries
	// they evicted as never purged at all (#507). One id for the drain: what it
	// drops, it drops in one pass, whatever the number of writes that recorded it.
	const purgeId = randomUUID();

	for (const target of pending) {
		try {
			if (target.mode === 'namespace') {
				await cache.clear();

				queueCachePurge({
					purgeId,
					collection: null,
					mode: 'namespace',
					scopedCacheTags: null,
					scopedCacheTagCount: 0,
					evicted: null,
					durationMs: null,
				});
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

				await purgeCollectionScopedCache(cache, target.collection, {
					scopedCachePurgeId: purgeId,
					retried: true,
				});
			}
			else {
				const { declaredByCollection, labelledCollections } =
					recordedScopedCachePurgeTargets(target.scopedCacheFingerprints);

				// Every collection the record reaches, before any of them is read: a
				// retry owes the same guarantee the purge it finishes owed, and a read
				// in flight has to decline rather than file itself under an index this
				// drain is about to prune.
				await bumpScopedCacheEpochs([
					...declaredByCollection.keys(),
					...labelledCollections,
				]);

				let evicted = 0;
				const staleKeys: string[] = [];

				for (const [declaredCollection, declared] of declaredByCollection) {
					// No index path: the schema the record was written under is not this
					// drain's to read, so every set the collection owns is scanned.
					const sweep = await purgeScopedCacheDeclaredPins(
						cache,
						declaredCollection,
						declared,
						null,
					);

					evicted += sweep.evicted;

					for (const staleKey of sweep.matchedKeys) {
						staleKeys.push(staleKey);
					}
				}

				// Records its own collection-mode purge, as it does everywhere else:
				// it is the one that knows how many sets its scan turned up.
				for (const labelledCollection of labelledCollections) {
					await purgeCollectionScopedCache(cache, labelledCollection, {
						scopedCachePurgeId: purgeId,
						retried: true,
					});
				}

				// Guarded on its own: naming the stale entries is best-effort telemetry
				// and reads Postgres, so its failure must not abort the purge — the
				// purge is what makes the cache correct again, and a blocked one stays
				// blocked for every later retry too.
				try {
					await reportRecoveredScopedCacheEntries(staleKeys, reported);
				}
				catch (error: any) {
					useLogger().warn(
						error,
						`[scoped-cache] could not name the entries a purge left stale: `
						+ `${error}`,
					);
				}

				// Only for what the fingerprints took: a label's collection purge
				// records itself, and counting it here would show its entries evicted
				// twice.
				if (declaredByCollection.size > 0) {
					const declaredFingerprints = target.scopedCacheFingerprints
						.filter((recorded) => recorded.endsWith('&'));

					queueCachePurge({
						purgeId,
						collection: target.collection,
						mode: 'slices',
						scopedCacheTags: declaredFingerprints,
						scopedCacheTagCount: declaredFingerprints.length,
						evicted,
						durationMs: null,
					});
				}
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
	void import('../cache.js')
		.then(({ getCache }) => {
			const { cache } = getCache();

			const storeClient = (cache?.store as {
				client?: { on?: (event: string, listener: () => void) => void };
			} | undefined)?.client;

			storeClient?.on?.('ready', recover);
		})
		// `getCache` builds the store on first call, so it can throw here — on a
		// boot path, where an unhandled rejection is the process's problem rather
		// than this listener's. The other two triggers still cover the drain.
		.catch((error: any) => {
			logger.warn(
				error,
				`[scoped-cache] could not watch the response cache client: ${error}`,
			);
		});

	recover();
}

/**
 * Name the entries a failed purge left stale, once it has finally dropped them.
 * Emitted HERE rather than at failure time because the anomaly stream is itself
 * Redis-backed — reporting when the purge failed would report nothing in the one
 * case worth reporting, a Redis outage.
 *
 * Read off what the purge matched rather than off the index: the index no longer
 * holds a set per slice to take the members of, and the purge scanned exactly
 * those entries on its way to deleting them.
 *
 * Best-effort: an entry with no descriptor (stats were off when it was filled)
 * is purged all the same, it just cannot be named on the admin page.
 *
 * `reported` spans the drain: an entry is filed under every index value it was
 * filled under, and a drain that retries several of them names it once, not once
 * per target.
 */
async function reportRecoveredScopedCacheEntries(
	staleKeys: readonly string[],
	reported: Set<string>,
): Promise<void> {
	if (staleKeys.length === 0) {
		return;
	}

	const { readCacheDescriptorForRedisKey } = await import('../cache-events.js');

	// A sidecar is the same stale entry counted once more, and the purge deletes
	// it alongside the entry it belongs to.
	const members = [...new Set(staleKeys)].filter((member) => {
		return cacheSidecarOwner(member) === null && !reported.has(member);
	});

	for (const member of members) {
		reported.add(member);
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
		// The rows the mutation wrote, as they were AND as they became, each
		// serialised as a fingerprint of its own. Given them, the purge asks each
		// cached read its own question — does one of these rows satisfy everything
		// I depend on — instead of dropping every entry filed under any slice the
		// write touched. Absent, it falls back to the tag sweep, which is what a
		// purge that knows no rows can do: a hook's own `purgeBy`, a collection-wide
		// fallback, a write whose rows could not be read back.
		rowFingerprints?: readonly ScopedCacheFingerprint[];
		// The columns an update rewrote, `null` for an insert or a delete. A read
		// bound to none of them cannot have changed, whichever slice the row is in.
		changed?: readonly string[] | null;
		// The path the collection's index is split by, so the purge reads back
		// the sets its rows own instead of every set the collection has.
		indexPath?: string | null;
		// The tags in the list that the rows do NOT answer for, and so keep their
		// tag sweep: a hook's `purgeBy` names a slice, not the rows it wrote, and
		// nothing the mutation read back can resolve it.
		sweepScopedCacheTags?: readonly ScopedCacheTag[];
	} = {},
): Promise<ScopedCacheTag[] | null> {
	// Returns the purged tags so a caller can surface them (dev-only debug header):
	// `null` = whole namespace flushed (non-scoped mode); bare `[{ collection }]` =
	// a collection-wide purge; otherwise the resolved slice tags.
	const startedAt = Date.now();

	if (!scopedCachePurgeEnabled()) {
		const cleared = await purgeOrRecord(
			() => cache.clear(),
			{ mode: 'namespace', collection: null, scopedCacheFingerprints: [] },
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
				return purgeCollectionScopedCache(cache, collection, {
					scopedCachePurgeId: options.scopedCachePurgeId,
				});
			},
			{ mode: 'collection', collection, scopedCacheFingerprints: [] },
		);

		return [{ collection }];
	}

	const declaredScopedCacheTags = options.includeCollectionTag === false
		? [...scopedCacheTags]
		: [{ collection }, ...scopedCacheTags];

	let resolvedScopedCacheTags = declaredScopedCacheTags;

	// The filter runs after the mutation committed, so an extension that throws
	// here would answer 500 for a durable write — and, being outside
	// `purgeOrRecord`, would record nothing either, leaving the entries it was
	// about to drop stale with nothing coming for them. Purging what was already
	// resolved loses whatever the extension would have added, which is the smaller
	// harm and the visible one: its own `purgeBy` is what that tag is for.
	try {
		resolvedScopedCacheTags = (await emitter.emitFilter(
			'cache.purge',
			declaredScopedCacheTags,
			{ collection },
			context,
		)) as ScopedCacheTag[];
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[scoped-cache] cache.purge filter failed, purging the tags resolved `
			+ `without it: ${error}`,
		);
	}

	// Row-driven: the fingerprints answer for every tag the mutation itself
	// declared, so only what a hook declared and what the `cache.purge` filter
	// ADDED is still swept by tag — each of those names a slice, not the rows the
	// mutation wrote, and nothing else can resolve it.
	const sweptAnyway = new Set(
		(options.sweepScopedCacheTags ?? []).map(scopedCacheTagKey),
	);

	const rowDriven = new Set(
		declaredScopedCacheTags
			.map(scopedCacheTagKey)
			.filter((entryKey) => sweptAnyway.has(entryKey) === false),
	);

	const sweptScopedCacheTags = options.rowFingerprints === undefined
		? resolvedScopedCacheTags
		: resolvedScopedCacheTags.filter((resolvedTag) => {
			return rowDriven.has(scopedCacheTagKey(resolvedTag)) === false;
		});

	const tagKeys = [...new Set(sweptScopedCacheTags.map(scopedCacheTagKey))];
	let evicted: number | null = null;

	// What a retry has to be able to run again, in the one grammar the index reads:
	// the rows this purge was bound to, and the pins it was handed. A label would
	// name a slice the index files nothing under, and a retry aimed at one would
	// report success having dropped nothing.
	// The collection tag rides with the rows rather than in the swept list, so a
	// retry driven by the record alone would leave the global reads warm: a row
	// fingerprint names a value, and a pin naming a value cannot reach an entry
	// bound to none.
	const recordedCollectionTag =
		options.rowFingerprints !== undefined && options.includeCollectionTag !== false
			? [scopedCacheFingerprintOf(collection, [])]
			: [];

	const recordedFingerprints = [
		...(options.rowFingerprints ?? []),
		...recordedCollectionTag,
		...sweptScopedCacheTags.map((sweptTag) => {
			return scopedCacheFingerprintOf(sweptTag.collection, [sweptTag]);
		}),
	].map(renderScopedCacheFingerprint);

	const purged = await purgeOrRecord(
		async () => {
			const [bound, swept] = await Promise.all([
				options.rowFingerprints === undefined
					? 0
					: purgeScopedCacheFingerprintIndex(
						cache,
						collection,
						options.rowFingerprints,
						options.changed ?? null,
						options.indexPath ?? null,
						options.includeCollectionTag !== false,
					),
				purgeScopedCacheDeclaredTags(
					cache,
					collection,
					sweptScopedCacheTags,
					options.indexPath ?? null,
				),
			]);

			evicted = bound + swept;
		},
		{
			mode: 'slices',
			collection,
			scopedCacheFingerprints: recordedFingerprints,
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
