import { useEnv } from '@directus/env';
import type {
	EventContext,
	Filter,
	Item,
	Query,
	ScopedCacheCollector,
	ScopedCachePath,
	ScopedCacheTag,
	SchemaOverview,
	Type,
} from '@directus/types';
import type Keyv from 'keyv';
import { resolvedCacheTtl } from './cache-config.js';
import type { AST } from './types/ast.js';
import {
	extractFieldsFromQuery,
} from './permissions/modules/process-ast/lib/extract-fields-from-query.js';
import {
	joinFilterWithCases,
} from './database/run-ast/lib/apply-query/join-filter-with-cases.js';
import type {
	CollectionKey,
	FieldMap,
	QueryPath,
} from './permissions/modules/process-ast/types.js';
import { queueCacheAnomaly, queueCachePurge } from './cache-events.js';
import emitter from './emitter.js';
import { useLogger } from './logger/index.js';
import {
	clearPendingScopedCachePurges,
	countFailedScopedCachePurgeRetry,
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
	type PendingScopedCachePurge,
} from './scoped-cache-pending-purges.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

const env = useEnv();

/**
 * A per-operation collector backing the `context.scopedCache` hook handle. The
 * service wires ONE of `scope`/`purge` as `context.scopedCache` per the filter event
 * (read → `scope.scopeTo`, mutation → `purge.purgeBy`); the hook pushes via it and
 * the service drains `tags` into the read's scope or the mutation's purge tags. Both
 * are the same idempotent sink. Safe with purging off (then `tags` is unread).
 */
export function createScopedCacheCollector(
	schema: SchemaOverview,
): ScopedCacheCollector {
	const tags: ScopedCacheTag[] = [];
	const seen = new Set<string>();
	const manuallyPurgedKeys = new Set<string>();
	const purgeSkippedKeys = new Set<string>();

	// A hook names a slice by collection/field/value and rarely knows the column's
	// type, but the type is what canonicalizes the value: `uuid` lowercases and
	// `integer` strips a leading zero, so a type-less tag and the schema-typed one
	// the purge side emits resolve DIFFERENT keys for the SAME row — a pin nothing
	// ever purges. Fill it from the schema so both sides agree.
	function withSchemaType(tag: ScopedCacheTag): ScopedCacheTag {
		if (tag.type !== undefined || tag.field === undefined) {
			return tag;
		}

		const schemaType = schema.collections[tag.collection]?.fields[tag.field]?.type;

		return schemaType === undefined
			? tag
			: { ...tag, type: schemaType };
	}

	function add(
		input: ScopedCacheTag | readonly ScopedCacheTag[],
		manuallyPurged = false,
	): void {
		const batch = Array.isArray(input)
			? input
			: [input];

		for (const declaredTag of batch) {
			const tag = withSchemaType(declaredTag);

			// Idempotent: a hook looping over rows that resolve the same slice — or a
			// batch/upsert parent's shared collector fed by many children — must not
			// inflate the set. Key on the canonical tag key (the same one the purge side
			// dedups on), so field order and value/type variants (7 vs '7') can't slip a
			// duplicate past a raw JSON compare.
			const key = scopedCacheTagKey(tag);

			// Record the accept regardless of dedup: if ANY scopeTo of this tag marked it
			// manuallyPurged, it's exempt from the unautopurgeable-scope anomaly.
			if (manuallyPurged) {
				manuallyPurgedKeys.add(key);
			}

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			tags.push(tag);
		}
	}

	return {
		tags,
		manuallyPurgedKeys,
		purgeSkippedKeys,
		scope: { scopeTo: (input, options) => add(input, options?.manuallyPurged) },
		purge: {
			purgeBy: (input) => add(input),
			// Deliberately not a tag: the take-over check reads the tag count, and
			// declaring nothing to purge must not read as declaring a purge.
			skipPurgeFor: (key) => {
				purgeSkippedKeys.add(String(key));
			},
		},
	};
}

/**
 * Whether scoped (tag-based) cache purging is active. Requires the opt-in mode AND a Redis cache
 * store, since the tag→keys index lives in Redis sets. Any other config falls back to full flush.
 */
export function scopedCachePurgeEnabled(): boolean {
	return (
		env['CACHE_AUTO_PURGE_MODE'] === 'scoped' &&
		env['CACHE_STORE'] === 'redis' &&
		redisConfigAvailable()
	);
}

/**
 * Fail fast at startup: scoped cache purging drives Redis SCAN + multi-key DEL over a single
 * node, so it only works on a standalone client. A cluster client would silently under-purge
 * (keys on other nodes never scanned) and leave stale slices. `useRedis()` always builds a
 * standalone `Redis` in core, so this only bites a custom override — surface it at boot rather
 * than as a mid-request stale HIT.
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

// Canonicalize a scope value to a driver-stable token so a REST/GraphQL filter value and the
// native DB row value resolve the SAME slice. `String()` alone collapses the common case (number
// 7 vs string "7"), but diverges for non-string scalars — a boolean is `true` from a parsed filter
// but `1`/`0` (mysql/sqlite) or `'t'` (pg) from a stored row; a datetime is an ISO string from a
// filter but a `Date` from the driver; a decimal is `1.5` vs `'1.50'`. NULL gets a null-byte
// sentinel rather than String(null)='null', so it can't collide with a literal "null" value.
export function canonicalScopedCacheValue(
	value: unknown,
	type: Type | undefined,
): string {
	if (value === null || value === undefined) {
		return '\x00null';
	}

	if (type === 'boolean') {
		const truthy = value === true || value === 1 || value === '1'
			|| value === 't' || value === 'true';

		return truthy
			? 'true'
			: 'false';
	}

	// `time` has no date component, so it stays a plain string (both sides give `HH:MM:SS`).
	if (type === 'date' || type === 'dateTime' || type === 'timestamp') {
		const ms = value instanceof Date
			? value.getTime()
			: Date.parse(String(value));

		return Number.isNaN(ms)
			? String(value)
			: String(ms);
	}

	// A uuid is compared case-insensitively by the DB, so both spellings name one row
	// and must name one slice. Neither side normalizes for us — `validateKeys` accepts
	// either case without rewriting it — so the token would otherwise be whatever the
	// caller sent: an iOS client reading `UUID().uuidString` (uppercase) against a
	// web client writing lowercase would pin and purge different keys → stale HIT.
	if (type === 'uuid') {
		return String(value).toLowerCase();
	}

	// integer/bigInteger normalize the SPELLING but never go through `Number`: past
	// MAX_SAFE_INTEGER a numeric pass corrupts the value, so leading zeros and a
	// leading `+` are stripped as string surgery. `01`, `+1`, `0001` and a driver's
	// `1` are one key to the DB, so they must not resolve different slices. Anything
	// that isn't a plain integer keeps its string form rather than becoming empty.
	if (type === 'integer' || type === 'bigInteger') {
		const raw = String(value).trim();
		const digits = /^([+-]?)0*(\d+)$/.exec(raw);

		if (digits === null) {
			// Spellings `validateKeys` still lets through, since it only asks
			// `Number.isInteger(Number(key))`: `1e3`, `0x10`, `1.0`. Normalize through
			// `Number` when it round-trips safely; past MAX_SAFE_INTEGER no token can be
			// right, and such a key cannot have matched a row either, so keep it raw.
			const num = Number(raw);

			return raw !== '' && Number.isSafeInteger(num)
				? String(num)
				: raw;
		}

		// `-0` is zero; only a non-zero magnitude keeps the sign.
		const sign = digits[1] === '-' && digits[2] !== '0'
			? '-'
			: '';

		return `${sign}${digits[2]}`;
	}

	// Only fixed-scale types need the numeric pass (`'1.50'` vs `1.5`).
	if (type === 'decimal' || type === 'float') {
		const num = Number(value);

		return Number.isFinite(num)
			? String(num)
			: String(value);
	}

	return String(value);
}

/** Each field of a collection mapped to its schema type, or undefined when the
 * schema does not carry it. What canonicalizes a tag value on both sides. */
export type FieldTypesByField = Record<string, Type | undefined>;

// Types whose filter value and stored row value are NOT guaranteed to canonicalize to the same
// token across drivers/timezones: a naive `dateTime`/`timestamp` column comes back as a local
// `Date` from the driver but as an ISO string (possibly with an explicit `Z`) from a filter, so
// the epoch-ms canonical can diverge. The read side never pins these — it falls back to the bare
// collection tag so any write to the collection invalidates the read (over-purge, never stale).
const PIN_UNSAFE_SCOPE_TYPES = new Set<Type>(['date', 'dateTime', 'timestamp']);

function isPinnableScopeType(type: Type | undefined): boolean {
	return !PIN_UNSAFE_SCOPE_TYPES.has(type as Type);
}

// The slice tag keys a collection currently owns, so a collection-wide purge reads
// them instead of walking the whole keyspace to find them again.
function scopedCacheCollectionSlicesKey(collection: string): string {
	return `${env['CACHE_NAMESPACE']}:slices:${collection}`;
}

export function scopedCacheTagKey(tag: ScopedCacheTag): string {
	const base = `${env['CACHE_NAMESPACE']}:tag:${tag.collection}`;
	return tag.field === undefined
		? base
		: `${base}:${tag.field}=${canonicalScopedCacheValue(tag.value, tag.type)}`;
}

// Render scope tags for the dev-only `X-Scoped-Cache-*` headers: each tag as its
// key suffix (no `<namespace>:tag:` prefix) — `collection`, or `collection:field=
// value` for a pinned slice (same canonical value as the Redis key). Comma-joined.
export function scopedCacheTagLabel(tag: ScopedCacheTag): string {
	if (tag.field === undefined) {
		return tag.collection;
	}

	return `${tag.collection}:${tag.field}=${
		canonicalScopedCacheValue(tag.value, tag.type)
	}`;
}

export function serializeScopedCacheTags(tags: readonly ScopedCacheTag[]): string {
	return tags
		.map(scopedCacheTagLabel)
		.join(', ');
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
 *   - the one exception is a DIRECT self-relation that only rewrites a foreign key.
 *     Those rows survive in their slices, and finding which ones the rule moved
 *     means scanning by a foreign key Directus does not index.
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
			// rather than deletes. Reached from another collection, the rewritten
			// rows are not children of the deleted ones.
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
 * Index a freshly-cached response key under every tag its data came from, so a later
 * mutation can drop just the matching entries instead of the whole namespace. Both the
 * payload key and its `__expires_at` sibling are tagged. When a cache TTL is set, each tag
 * set self-expires at twice that TTL as a safety net against members orphaned by a crash
 * between write and purge; with no TTL (`CACHE_TTL` unset) the cached entries never expire
 * either, so the tag sets are left unbounded to match — a normal purge still drains them.
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
	const ttlSeconds = Math.ceil(getMilliseconds(resolvedCacheTtl(), 0) / 1000) * 2;
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
		pipeline.sadd(tagKey, key, `${key}__expires_at`, ...extraSiblings);

		if (ttlSeconds > 0) {
			pipeline.expire(tagKey, ttlSeconds);
		}

		// The bare tag is where a collection-wide purge starts, so filing it would
		// only name a key that purge already holds.
		if (tag.field === undefined) {
			continue;
		}

		const slicesKey = scopedCacheCollectionSlicesKey(tag.collection);

		pipeline.sadd(slicesKey, tagKey);

		// Same expiry as the tag sets it names, written in the same pipeline, so the
		// index cannot outlive — or predecease — what it points at.
		if (ttlSeconds > 0) {
			pipeline.expire(slicesKey, ttlSeconds);
		}
	}

	await pipeline.exec();
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
 * Delete the cache entries a set of tag keys point to, then drop the tag sets. Shared by
 * the scoped purge (specific value slices) and the collection-wide fallback (every slice).
 *
 * Returns how many cache ENTRIES it actually deleted, which is neither how many
 * keys it deleted nor how many the tag sets named.
 *
 * Not the key count, because a tag set holds each entry alongside its
 * `__expires_at` sibling and any extra sibling (`__tags`), so counting members
 * would report every entry twice over. A sidecar is recognisable by its base key
 * being in the set beside it — the `sadd` writes them together — which stays
 * right as siblings are added.
 *
 * Not the membership count either, because nothing ever SREMs: a member that
 * expired by TTL stays named by the set until the set itself is dropped here. On
 * the workload this fork exists for — per-user keys, so high cardinality, TTLs
 * shorter than the gap between mutations — most of a set can be entries that were
 * already gone, and counting them would inflate every purge figure on the page.
 * So the store's own answer decides. Only an explicit `false` is evidence the key
 * was absent; a store that reports nothing leaves the count where it was rather
 * than silently collapsing it to zero.
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

async function purgeScopedCacheTagKeys(
	cache: Keyv,
	tagKeys: string[],
): Promise<number> {
	// `redis.del()` with no keys throws — a `cache.purge` filter (or an empty collection
	// scan) can leave nothing to purge.
	if (tagKeys.length === 0) {
		return 0;
	}

	const redis = useRedis();
	const memberLists = await Promise.all(tagKeys.map((tagKey) => redis.smembers(tagKey)));
	const members = [...new Set(memberLists.flat())];

	const wasDeleted = await Promise.all(members.map((member) => {
		return cache.delete(member);
	}));

	// Array form: one key per tag purged, so a spread throws RangeError once
	// the list is long enough.
	await redis.del(tagKeys);

	// Drop the purged slice keys from their collection's index: one pruned only
	// wholesale keeps naming keys that are gone, and grows without bound. A
	// collection name cannot hold a `:`, so the first one after the prefix is
	// where the field starts.
	const tagPrefix = `${env['CACHE_NAMESPACE']}:tag:`;
	const sliceKeysByCollection = new Map<string, string[]>();

	for (const tagKey of tagKeys) {
		const label = tagKey.startsWith(tagPrefix)
			? tagKey.slice(tagPrefix.length)
			: '';

		const fieldAt = label.indexOf(':');

		if (fieldAt === -1) {
			continue;
		}

		const collection = label.slice(0, fieldAt);

		sliceKeysByCollection.set(collection, [
			...sliceKeysByCollection.get(collection) ?? [],
			tagKey,
		]);
	}

	// One member per slice the collection owns, so the array form: a spread
	// throws RangeError once the list is long enough.
	await Promise.all([...sliceKeysByCollection].map(([collection, sliceKeys]) => {
		return redis.srem(scopedCacheCollectionSlicesKey(collection), sliceKeys);
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
 * Cursor-scan every Redis key matching `match`. A single-node SCAN only covers the whole
 * keyspace on a standalone client; a cluster would miss keys on other nodes. Scoped mode is
 * refused on a cluster at startup (`assertScopedCacheRedisSupported`), so the client here is
 * always standalone.
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
 * Purge every cached read of `collection` — its bare collection tag plus all its value
 * slices — without full-flushing the namespace. The fallback when a mutation's scope
 * values are unresolvable (e.g. an upsert mixing inserts and updates): which slices
 * changed is unknown, but only reads touching THIS collection can be stale, so scope the
 * flush to its tag sets and spare every other collection's entries.
 */
export async function purgeCollectionScopedCache(
	cache: Keyv,
	collection: string,
	scopedCachePurgeId?: string,
): Promise<void> {
	const bareKey = `${env['CACHE_NAMESPACE']}:tag:${collection}`;

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
	const { getCache } = await import('./cache.js');
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

	// And again when the response cache's own client comes back: it reconnects on its
	// own schedule, so the drain above can find it still offline and bail, leaving
	// this the only thing that finishes those records.
	void import('./cache.js').then(({ getCache }) => {
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

	const { readCacheDescriptorForRedisKey } = await import('./cache-events.js');
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
 * resolved" → fall back to a collection-wide purge (bare tag + every slice) rather than
 * risk leaving a slice stale; still narrower than nuking the whole namespace.
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

/**
 * Build scoped cache tags from the distinct scope values present across `rows` — the purge side.
 *
 * - `onUnresolvable`: what to do when a row is missing a scoped-cache-field *key*. `'coarse'`
 *   returns `null` so the caller can fall back to a collection-wide purge rather than leave a
 *   slice stale; `'skip'` best-effort skips just that row's contribution.
 * - The `'coarse'` path triggers for a caller feeding *unprojected* rows. The purge
 *   side (`snapshotScopedCacheTags`) reads rows via an explicit projected `select`,
 *   so every field key is always present and it never returns `null` there — an
 *   update/delete/create snapshot always resolves. A create whose committed rows
 *   can't be trusted is caught upstream by the row-count check
 *   (`someRowTakenOver`), not here.
 * - The read side (`pinnedScopedCacheTagsFromM2oParents`) is the caller that
 *   depends on the `null`: one parent row missing its key has to take its whole
 *   collection down to the bare tag, since pinning the rest would leave that row
 *   covered by nothing.
 * - `fieldTypes`: each field's schema type, so the tag value canonicalizes the same way the read
 *   side's filter value does.
 */
export function scopedCacheTagsFromRows(
	collection: string,
	fields: string[],
	rows: Record<string, any>[],
	onUnresolvable: 'coarse' | 'skip',
	fieldTypes: FieldTypesByField = {},
): ScopedCacheTag[] | null {
	const tags: ScopedCacheTag[] = [];

	for (const field of fields) {
		// Dedup on the canonical token, not the raw value, so `7` and `'7'` (or a boolean
		// stored as `1`/`'t'`) collapse to one tag instead of emitting redundant slices.
		const seen = new Set<string>();

		for (const row of rows) {
			if (!(field in row)) {
				if (onUnresolvable === 'coarse') {
					return null;
				}

				continue;
			}

			const value = row[field];
			const token = canonicalScopedCacheValue(value, fieldTypes[field]);

			if (seen.has(token)) {
				continue;
			}

			seen.add(token);
			tags.push({ collection, field, value, type: fieldTypes[field] });
		}
	}

	return tags;
}

export type ScopedCacheM2oJoin = {
	field: string;
	relatedCollection: string;
	relatedPk: string;
};

/**
 * Resolve a dotted path into the chain of M2O joins it crosses, from `collection`
 * down. Null on anything that is not an M2O — a to-many hop, an unknown field, or an
 * A2O, whose relation names no single related collection — and every caller then
 * degrades to the bare collection tag.
 *
 * A row maps to exactly one parent across an M2O, so what such a join reaches is
 * fully determined by the rows already in hand. Shared, so the two sides that ask
 * "is this path pinnable?" cannot drift apart on the answer: a collection's declared
 * scope paths, and the nested collections of a read.
 */
export function resolveScopedCacheM2oJoinChainFromPath(
	schema: SchemaOverview,
	collection: CollectionKey,
	path: QueryPath,
): ScopedCacheM2oJoin[] | null {
	const joins: ScopedCacheM2oJoin[] = [];
	let current = collection;

	for (const field of path) {
		const relation = schema.relations.find((rel) => {
			return rel.collection === current && rel.field === field;
		});

		const relatedCollection = relation?.related_collection;

		const relatedPk = relatedCollection
			? schema.collections[relatedCollection]?.primary
			: undefined;

		if (!relatedCollection || !relatedPk) {
			return null;
		}

		joins.push({ field, relatedCollection, relatedPk });
		current = relatedCollection;
	}

	return joins;
}

/**
 * How many slices one nested collection may pin on a single read. Every tag costs
 * a Redis set plus a slice-index member, and the write side deletes them one by one.
 *
 * Sized above a default page of nested parents (the default `limit` is 100), below
 * an import-sized one. NOT the bound
 * https://github.com/jclaveau/directus/issues/392 is deciding, though both coarsen
 * rather than fan out and both fail toward over-purge:
 *
 * - #392 bounds what a WRITE emits, forced by Postgres's 65 535 bind parameters,
 *   and picks its number from the purge crossover. Above it a whole collection's
 *   cache goes.
 * - This bounds what a READ attaches. Nothing structural forces it, and a read
 *   never purges — so the crossover #392 measures does not apply. Above it this
 *   one response loses its pin and is still cached.
 *
 * Operator-tunable because the right number is deployment-specific — it weighs
 * Redis memory against the hit ratio the pin buys, and a pin costs a tag set plus a
 * member of the collection's slice index (130 B measured, on a TTL every write
 * refreshes). No setting of it can serve a stale row.
 */
export function scopedCacheMaxPinsPerCollection(): number {
	return env['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] as number;
}

/**
 * The parent rows sitting at the END of one M2O path, in document order — the set is
 * replaced at every hop, so the rows passed through on the way out are not returned.
 *
 * Null when the response cannot answer the path — a segment it never carried, or an
 * array where an M2O promised one row — so the caller falls back to the bare tag
 * rather than pin a set it only half read.
 */
function m2oParentRowsAtPathEnd(
	records: Item[],
	segments: QueryPath,
): Item[] | null {
	let current = records;

	for (const segment of segments) {
		const next: Item[] = [];

		for (const row of current) {
			const value = row[segment];

			// A row whose parent link is empty carries no parent to pin, and says
			// nothing about the rows its siblings reached.
			if (value === null) {
				continue;
			}

			if (typeof value !== 'object' || Array.isArray(value)) {
				return null;
			}

			next.push(value);
		}

		current = next;
	}

	return current;
}

/**
 * The collections a read depends on BEYOND the parent rows it nested, so keying the
 * pin on those rows would leave the entry alive through a write that changes
 * what the read returns.
 *
 * - A query filters, sorts, groups or aggregates on a path into it (permission cases
 *   joined the way the SQL WHERE joins them), so rows the response never nested
 *   decide which rows come back. Read off EVERY node's query, not only the root's: a
 *   nested node's filter withholds parents, and which ones it withholds is
 *   decided by every collection that filter reads — each of them one the
 *   response may have nested only in part.
 * - A nested node carries a field-level case, so a parent it references can be
 *   withheld and arrive as a null slot — which `mergeWithParentItems` writes for
 *   a null foreign key too, leaving the two indistinguishable once merged.
 */
export function scopedCacheCollectionsBeyondNestedRows(
	schema: SchemaOverview,
	ast: AST,
): Set<CollectionKey> {
	const beyond = new Set<CollectionKey>();

	const addCollectionsQueriedBy = (
		collection: CollectionKey,
		query: Query,
		cases: Filter[],
	): void => {
		const queryFieldMap: FieldMap = { read: new Map(), other: new Map() };

		extractFieldsFromQuery(
			collection,
			{ ...query, filter: joinFilterWithCases(query.filter, cases) },
			queryFieldMap,
			schema,
		);

		for (const [, entry] of [...queryFieldMap.read, ...queryFieldMap.other]) {
			beyond.add(entry.collection);
		}
	};

	addCollectionsQueriedBy(ast.name, ast.query, ast.cases);

	const addWhatNestedM2oNodesDependOn = (children: AST['children']): void => {
		for (const child of children) {
			if (child.type !== 'm2o') {
				continue;
			}

			addCollectionsQueriedBy(
				child.relation.related_collection!,
				child.query,
				child.cases,
			);

			// Not a filter, so nothing above reads it: the case decides per ROW
			// whether this parent is shown at all.
			if (child.whenCase.length > 0) {
				beyond.add(child.relation.related_collection!);
			}

			addWhatNestedM2oNodesDependOn(child.children);
		}
	};

	addWhatNestedM2oNodesDependOn(ast.children);

	return beyond;
}

/**
 * Scope a read's NON-root collections off the parent rows it nested — the other
 * half of `pinnedScopedCacheTagsFromFilter`, which bounds the root.
 *
 * Per touched collection, the first of these that holds:
 *
 * - `<pk>=<key>` per parent row — M2O hops only. An INSERT lands a key this
 *   response cannot have nested, so the pin cannot go stale.
 * - its own declared scope slices — past the ceiling. One tag per distinct value.
 * - the bare collection tag — a to-many hop or A2O anywhere on one of its paths, no
 *   parent row nested, a row missing its key, or the read depending on it
 *   beyond what it nested (`scopedCacheCollectionsBeyondNestedRows`).
 *
 * Returns the pinned collections only; the bare tag is the caller's default, so a
 * collection absent here keeps the tag it has always carried. Each fallback
 * over-purges, none serves stale.
 */
export function pinnedScopedCacheTagsFromM2oParents(
	schema: SchemaOverview,
	rootCollection: CollectionKey,
	fieldMap: FieldMap,
	records: Item[],
	collectionsBeyondNestedRows: Set<CollectionKey>,
): Map<CollectionKey, ScopedCacheTag[]> {
	// A set per collection: the field map carries the same path under both its read
	// and its other group, and walking one path twice would double every row.
	const pathsByCollection = new Map<CollectionKey, Set<QueryPath[number]>>();

	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		// The root is bounded by its own filter, not by what it nested, and a
		// self-referential relation reaches it again at a path that bounds nothing.
		if (entry.collection === rootCollection) {
			continue;
		}

		// Its parent rows do not bound the read, so only the bare tag covers it.
		if (collectionsBeyondNestedRows.has(entry.collection)) {
			continue;
		}

		const paths = pathsByCollection.get(entry.collection)
			?? new Set<QueryPath[number]>();

		paths.add(path);
		pathsByCollection.set(entry.collection, paths);
	}

	const pinned = new Map<CollectionKey, ScopedCacheTag[]>();

	for (const [collection, paths] of pathsByCollection) {
		const primaryKeyField = schema.collections[collection]?.primary;
		const collectionFields = schema.collections[collection]?.fields ?? {};

		if (primaryKeyField === undefined) {
			continue;
		}

		const rows: Item[] = [];
		let pinnableFromNestedRows = true;

		for (const path of paths) {
			const segments = path.split('.');

			const joins = resolveScopedCacheM2oJoinChainFromPath(
				schema,
				rootCollection,
				segments,
			);

			if (joins === null) {
				pinnableFromNestedRows = false;
				break;
			}

			const parentRows = m2oParentRowsAtPathEnd(records, segments);

			if (parentRows === null) {
				pinnableFromNestedRows = false;
				break;
			}

			// Pushed one by one: a spread passes an argument per row, and a read
			// with no limit blows the call-stack cap somewhere past 100k of them.
			for (const parentRow of parentRows) {
				rows.push(parentRow);
			}
		}

		if (pinnableFromNestedRows === false) {
			continue;
		}

		// Reached, but carrying nothing to pin — a filter-only relation the response
		// never nested, or rows whose parent link is empty throughout.
		if (rows.length === 0) {
			continue;
		}

		// `coarse`, not `skip`: one row without its key must take the whole
		// collection down to the bare tag. Skipping it would pin the rows that DID
		// carry a key and leave that one covered by nothing — stale, where the bare
		// tag only over-purges.
		const keyTags = scopedCacheTagsFromRows(
			collection,
			[primaryKeyField],
			rows,
			'coarse',
			{ [primaryKeyField]: collectionFields[primaryKeyField]?.type },
		);

		if (
			keyTags !== null &&
			keyTags.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, keyTags);
			continue;
		}

		// Only the direct columns: a dotted scope field names a column on another
		// collection, which the parent row does not carry.
		const sliceFields = (schema.collections[collection]?.scopedCacheFields ?? [])
			.filter((field) => !field.includes('.'));

		if (sliceFields.length === 0) {
			continue;
		}

		const sliceFieldTypes: FieldTypesByField = {};

		for (const field of sliceFields) {
			sliceFieldTypes[field] = collectionFields[field]?.type;
		}

		const sliceTags = scopedCacheTagsFromRows(
			collection,
			sliceFields,
			rows,
			'coarse',
			sliceFieldTypes,
		);

		if (
			sliceTags !== null &&
			sliceTags.length <= scopedCacheMaxPinsPerCollection()
		) {
			pinned.set(collection, sliceTags);
		}
	}

	return pinned;
}

/**
 * Scope a read's root cache tags off a filter — the read side. A read is soundly scoped to a value
 * slice only when the filter *bounds* it to that value: a future insert with a new scope value must
 * be excluded by the same filter, or the read would silently miss it. Tags come from `_eq`/`_in` on
 * a scoped field (flat or relational `{ fk: { <pk>: … } }`). Each node reports its tags plus whether
 * it *covers* every row it matches (i.e. binds a pinnable field on that row), combined by operator:
 *   - `_and`/root union a field's values and are covered if ANY conjunct is (a row satisfies every
 *     conjunct); the value union over-approximates the intersection — over-purges, never stale.
 *   - `_or` is sound only when EVERY branch is covered (else a row matching an uncovered branch
 *     carries no pinned tag → stale); then its tags are the union across branches — a matching row
 *     satisfies one branch, whose covering tag lies in that union. This holds across *different*
 *     fields too: `{ _or: [{ owner }, { dept }] }` pins both, purged if a write touches either.
 * This is what scopes a permission-isolated read: the caller passes
 * `joinFilterWithCases(query.filter, ast.cases)`, whose `{ _or: cases }` is unioned by that rule
 * (one case = its own values; a case that leaves ALL fields unbound → bare). No pinned field → `[]`,
 * and the caller falls back to the bare collection tag. `fieldTypes` canonicalizes a value the way
 * the purge side does and skips date-ish types (not pin-safe, `PIN_UNSAFE_SCOPE_TYPES`).
 *
 * `primaryKeyField` joins the declared fields implicitly and always, no config:
 *   - Every row has a primary key, so this axis always resolves.
 *   - An inserted row carries a different key, so it can never join a `<pk>._eq`
 *     or `<pk>._in` read's result set — the insert-blindness that bars a value
 *     slice elsewhere cannot bite here.
 *   - The purge side emits the same tag from the keys it already holds, so read and
 *     write agree without either paying a query for it.
 */
export function pinnedScopedCacheTagsFromFilter(
	collection: string,
	fields: string[],
	filter: Filter | null | undefined,
	fieldTypes: FieldTypesByField = {},
	relatedPrimaryKeys: Record<string, string> = {},
	scopedCachePaths: ScopedCachePath[] = [],
	primaryKeyField?: string,
): ScopedCacheTag[] {
	const fieldSet = new Set(fields);

	if (primaryKeyField !== undefined) {
		fieldSet.add(primaryKeyField);
	}

	if (!filter || (fieldSet.size === 0 && scopedCachePaths.length === 0)) {
		return [];
	}

	// A relational-path scope field (`enrollment.student.user`) is pinned by walking
	// the nested filter down its segments to the terminal `_eq`/`_in` (`evalPathsAt`).
	// Grouped by head segment so a filter key can look up the paths it starts.
	const pathsByHead = new Map<string, ScopedCachePath[]>();

	for (const path of scopedCachePaths) {
		const head = path.segments[0];

		if (head === undefined) {
			continue;
		}

		const group = pathsByHead.get(head) ?? [];
		group.push(path);
		pathsByHead.set(head, group);
	}

	// A node's pinned tags plus whether it *covers* every row it matches — a leaf that bound a
	// pinnable field covers its rows; an uncovered node's rows carry no pinned tag (would be stale).
	type Eval = { tags: Map<string, Set<unknown>>; covered: boolean };

	// Union `source`'s values into `target` in place (shared by AND and OR).
	function unionTags(
		target: Map<string, Set<unknown>>,
		source: Map<string, Set<unknown>>,
	): void {
		for (const [field, values] of source) {
			const seen = target.get(field) ?? new Set<unknown>();

			for (const value of values) {
				seen.add(value);
			}

			target.set(field, seen);
		}
	}

	// A single `_eq`/`_in` (or relational `{ fk: { <pk>: { _eq | _in } } }`) leaf → its value set.
	// Covered iff it bound a pinnable scope field; a non-scope/date/non-`_eq`/`_in` key covers nothing.
	function evalLeaf(field: string, value: unknown): Eval {
		const tags = new Map<string, Set<unknown>>();

		if (
			!fieldSet.has(field) ||
			!isPinnableScopeType(fieldTypes[field]) ||
			value === null ||
			typeof value !== 'object'
		) {
			return { tags, covered: false };
		}

		const ops = value as Record<string, unknown>;

		if ('_eq' in ops) {
			tags.set(field, new Set([ops['_eq']]));
		}
		else if ('_in' in ops && Array.isArray(ops['_in'])) {
			tags.set(field, new Set(ops['_in']));
		}
		else {
			// Relational: a filter on the related PK bounds the fk to the value the write side
			// stores. Only the related PK is sound — a non-PK attribute wouldn't determine it.
			const relatedPrimaryKey = relatedPrimaryKeys[field];

			const inner = relatedPrimaryKey === undefined
				? undefined
				: ops[relatedPrimaryKey];

			if (inner !== null && typeof inner === 'object') {
				const innerOps = inner as Record<string, unknown>;

				if ('_eq' in innerOps) {
					tags.set(field, new Set([innerOps['_eq']]));
				}
				else if ('_in' in innerOps && Array.isArray(innerOps['_in'])) {
					tags.set(field, new Set(innerOps['_in']));
				}
			}
		}

		return { tags, covered: tags.size > 0 };
	}

	// Follow a declared path's segments down the nested filter to the terminal ops
	// and read its `_eq`/`_in` — or `{ <terminalRelatedPk>: { _eq | _in } }` when the
	// terminal is an M2O written PK-unwrapped. Returns the value set, or null when the
	// filter doesn't bind the full path to a concrete value.
	function pathTerminalValues(
		segments: string[],
		value: unknown,
		terminalRelatedPk: string | undefined,
	): Set<unknown> | null {
		let node: unknown = value;

		for (let i = 1; i < segments.length; i++) {
			if (node === null || typeof node !== 'object') {
				return null;
			}

			node = (node as Record<string, unknown>)[segments[i]!];
		}

		if (node === null || typeof node !== 'object') {
			return null;
		}

		const ops = node as Record<string, unknown>;

		if ('_eq' in ops) {
			return new Set([ops['_eq']]);
		}

		if ('_in' in ops && Array.isArray(ops['_in'])) {
			return new Set(ops['_in']);
		}

		const inner = terminalRelatedPk === undefined
			? undefined
			: ops[terminalRelatedPk];

		if (inner !== null && typeof inner === 'object') {
			const innerOps = inner as Record<string, unknown>;

			if ('_eq' in innerOps) {
				return new Set([innerOps['_eq']]);
			}

			if ('_in' in innerOps && Array.isArray(innerOps['_in'])) {
				return new Set(innerOps['_in']);
			}
		}

		return null;
	}

	// Every declared path whose head segment is this filter key → its terminal values.
	// Covered iff a path bound (terminal `_eq`/`_in` present, type pin-safe).
	function evalPathsAt(headField: string, value: unknown): Eval {
		const tags = new Map<string, Set<unknown>>();
		const paths = pathsByHead.get(headField);

		if (!paths || value === null || typeof value !== 'object') {
			return { tags, covered: false };
		}

		for (const { field, segments } of paths) {
			if (!isPinnableScopeType(fieldTypes[field])) {
				continue;
			}

			const values = pathTerminalValues(segments, value, relatedPrimaryKeys[field]);

			if (values !== null && values.size > 0) {
				tags.set(field, values);
			}
		}

		return { tags, covered: tags.size > 0 };
	}

	// OR: a row matches at least one branch. Sound to pin only when EVERY branch covers its own rows
	// (else a row matching an uncovered branch carries no pinned tag → stale); then the tags are the
	// union across branches — a matching row's covering tag lies in it, across different fields too.
	function evalOr(branches: Eval[]): Eval {
		if (branches.length === 0 || !branches.every((branch) => branch.covered)) {
			return { tags: new Map<string, Set<unknown>>(), covered: false };
		}

		const tags = new Map<string, Set<unknown>>();

		for (const branch of branches) {
			unionTags(tags, branch.tags);
		}

		return { tags, covered: true };
	}

	// Every key at an object level is AND-combined (the root and `_and` share this): a row satisfies
	// every conjunct, so tags union and the node is covered if ANY conjunct covers the row.
	function evalNode(node: Filter): Eval {
		const result: Eval = { tags: new Map<string, Set<unknown>>(), covered: false };

		function andIn(part: Eval): void {
			unionTags(result.tags, part.tags);
			result.covered = result.covered || part.covered;
		}

		for (const [key, value] of Object.entries(node)) {
			if (key === '_and' && Array.isArray(value)) {
				for (const sub of value) {
					andIn(evalNode(sub as Filter));
				}
			}
			else if (key === '_or' && Array.isArray(value)) {
				andIn(evalOr(value.map((sub) => evalNode(sub as Filter))));
			}
			else {
				andIn(evalLeaf(key, value));
				andIn(evalPathsAt(key, value));
			}
		}

		return result;
	}

	const pinned = evalNode(filter);
	const tags: ScopedCacheTag[] = [];

	for (const [field, values] of pinned.tags) {
		for (const value of values) {
			tags.push({ collection, field, value, type: fieldTypes[field] });
		}
	}

	return tags;
}

/**
 * Auto-derive multi-hop scope paths from LOCAL scope fields, so each collection
 * declares only its own column and the grand-owner path composes itself. A scope
 * field on `collection` that is an M2O to a collection which itself declares scope
 * fields contributes `<field>.<targetScope>` for each of the target's scopes — its
 * own and, transitively, its derived. So `team` scoped by `owner_ref` + `member`
 * scoped by `team` yields `team.owner_ref`, no config naming another collection's
 * relation. Cycle-guarded (`visited`); the caller re-resolves each path (a to-many
 * hop drops to the bare tag).
 */
export function composeScopedCachePaths(
	schema: Pick<SchemaOverview, 'collections' | 'relations'>,
	collection: string,
	visited: Set<string> = new Set(),
): ScopedCachePath[] {
	if (visited.has(collection)) {
		return [];
	}

	const seen = new Set(visited).add(collection);
	const localFields = schema.collections[collection]?.scopedCacheFields ?? [];
	const composed: ScopedCachePath[] = [];

	for (const field of localFields) {
		if (field.includes('.')) {
			continue;
		}

		const relation = schema.relations.find((rel) => {
			return rel.collection === collection && rel.field === field;
		});

		const target = relation?.related_collection;

		if (!target) {
			continue;
		}

		for (const targetField of schema.collections[target]?.scopedCacheFields ?? []) {
			composed.push({
				field: `${field}.${targetField}`,
				segments: [field, ...targetField.split('.')],
			});
		}

		for (const deeper of composeScopedCachePaths(schema, target, seen)) {
			composed.push({
				field: `${field}.${deeper.field}`,
				segments: [field, ...deeper.segments],
			});
		}
	}

	return composed;
}
