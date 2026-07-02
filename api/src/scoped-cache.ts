import { useEnv } from '@directus/env';
import type { EventContext, Filter, ScopedCacheTag, Type } from '@directus/types';
import type Keyv from 'keyv';
import emitter from './emitter.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

const env = useEnv();

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

	// integer/bigInteger keep `String` to preserve precision past MAX_SAFE_INTEGER; they
	// already collapse (`7` and `'7'` → `'7'`). Only fixed-scale types need the numeric pass.
	if (type === 'decimal' || type === 'float') {
		const num = Number(value);

		return Number.isFinite(num)
			? String(num)
			: String(value);
	}

	return String(value);
}

// Types whose filter value and stored row value are NOT guaranteed to canonicalize to the same
// token across drivers/timezones: a naive `dateTime`/`timestamp` column comes back as a local
// `Date` from the driver but as an ISO string (possibly with an explicit `Z`) from a filter, so
// the epoch-ms canonical can diverge. The read side never pins these — it falls back to the bare
// collection tag so any write to the collection invalidates the read (over-purge, never stale).
const PIN_UNSAFE_SCOPE_TYPES = new Set<Type>(['date', 'dateTime', 'timestamp']);

function isPinnableScopeType(type: Type | undefined): boolean {
	return !PIN_UNSAFE_SCOPE_TYPES.has(type as Type);
}

function scopedCacheTagKey(tag: ScopedCacheTag): string {
	const base = `${env['CACHE_NAMESPACE']}:tag:${tag.collection}`;
	return tag.field === undefined
		? base
		: `${base}:${tag.field}=${canonicalScopedCacheValue(tag.value, tag.type)}`;
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
): Promise<void> {
	if (!scopedCachePurgeEnabled()) {
		return;
	}

	const tagKeys = [...new Set([...scopedCacheTags].map(scopedCacheTagKey))];

	if (tagKeys.length === 0) {
		return;
	}

	const redis = useRedis();
	const ttlSeconds = Math.ceil(getMilliseconds(env['CACHE_TTL'], 0) / 1000) * 2;
	const pipeline = redis.pipeline();

	for (const tagKey of tagKeys) {
		pipeline.sadd(tagKey, key, `${key}__expires_at`);

		if (ttlSeconds > 0) {
			pipeline.expire(tagKey, ttlSeconds);
		}
	}

	await pipeline.exec();
}

/**
 * Delete the cache entries a set of tag keys point to, then drop the tag sets. Shared by
 * the scoped purge (specific value slices) and the collection-wide fallback (every slice).
 */
async function purgeScopedCacheTagKeys(cache: Keyv, tagKeys: string[]): Promise<void> {
	// `redis.del()` with no keys throws — a `cache.purge` filter (or an empty collection
	// scan) can leave nothing to purge.
	if (tagKeys.length === 0) {
		return;
	}

	const redis = useRedis();
	const memberLists = await Promise.all(tagKeys.map((tagKey) => redis.smembers(tagKey)));
	const members = [...new Set(memberLists.flat())];

	if (members.length > 0) {
		await Promise.all(members.map((member) => cache.delete(member)));
	}

	await redis.del(...tagKeys);
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
 * Purge every cached read of `collection` — its bare collection tag plus all its value
 * slices — without full-flushing the namespace. The fallback when a mutation's scope
 * values are unresolvable (e.g. an upsert mixing inserts and updates): which slices
 * changed is unknown, but only reads touching THIS collection can be stale, so scope the
 * flush to its tag sets and spare every other collection's entries.
 */
export async function purgeCollectionScopedCache(
	cache: Keyv,
	collection: string,
): Promise<void> {
	const bareKey = `${env['CACHE_NAMESPACE']}:tag:${collection}`;

	// Slice keys are `<bareKey>:<field>=<value>`; the `:` delimiter keeps a prefix-sharing
	// sibling (`articles` vs `articles_archive`) out of the scan.
	const sliceKeys = await scanScopedCacheTagKeys(`${bareKey}:*`);

	await purgeScopedCacheTagKeys(cache, [bareKey, ...sliceKeys]);
}

/**
 * Purge cached responses affected by a mutation on `collection`. Outside scoped mode
 * the whole data cache is flushed (legacy `cache.clear()` behavior). In scoped mode
 * the bare collection tag (global reads) is always purged alongside the resolved
 * `scopedCacheTags` (the owner/partition slices the mutation touched), leaving every
 * other slice untouched. A `null` `scopedCacheTags` means "values couldn't be
 * resolved" → fall back to a collection-wide purge (bare tag + every slice) rather than
 * risk leaving a slice stale; still narrower than nuking the whole namespace.
 */
export async function purgeScopedCache(
	cache: Keyv,
	collection: string,
	scopedCacheTags: ScopedCacheTag[] | null = [],
	context: EventContext | null = null,
): Promise<void> {
	if (!scopedCachePurgeEnabled()) {
		await cache.clear();
		return;
	}

	if (scopedCacheTags === null) {
		await purgeCollectionScopedCache(cache, collection);
		return;
	}

	const resolvedScopedCacheTags = (await emitter.emitFilter(
		'cache.purge',
		[{ collection }, ...scopedCacheTags],
		{ collection },
		context,
	)) as ScopedCacheTag[];

	await purgeScopedCacheTagKeys(
		cache,
		[...new Set(resolvedScopedCacheTags.map(scopedCacheTagKey))],
	);
}

/**
 * Build scoped cache tags from the distinct scope values present across `rows` — the purge side.
 *
 * - `onUnresolvable`: what to do when a row is missing a scoped-cache-field *key*. `'coarse'`
 *   returns `null` so the caller can fall back to a collection-wide purge rather than leave a
 *   slice stale; `'skip'` best-effort skips just that row's contribution.
 * - The `'coarse'` path only triggers for a caller feeding *unprojected* rows (e.g. a raw payload).
 *   The sole production caller (`snapshotScopedCacheTags`) reads rows via an explicit projected
 *   `select`, so every field key is always present and it never returns `null` there — an
 *   update/delete/create snapshot always resolves. A create whose committed rows can't be trusted
 *   is caught upstream by the row-count check (`someRowTakenOver`), not here.
 * - `fieldTypes`: each field's schema type, so the tag value canonicalizes the same way the read
 *   side's filter value does.
 */
export function scopedCacheTagsFromRows(
	collection: string,
	fields: string[],
	rows: Record<string, any>[],
	onUnresolvable: 'coarse' | 'skip',
	fieldTypes: Record<string, Type | undefined> = {},
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

/**
 * Scope a read's root cache tags off the query filter — the read side. A read is
 * soundly scoped to a value slice only when the filter *bounds* it to that value: a
 * future insert with a new scope value must be excluded by the same filter, or the
 * read would silently miss it (a write to the new value purges only its own slice,
 * never this read). So scope tags come from `_eq`/`_in` constraints on a scoped cache
 * field, reached through the root or an `_and` (an `_or` branch doesn't bound — a row
 * matching the other branch still belongs). No pinned field → returns `[]`, and the
 * caller falls back to the bare collection tag so every write to the collection
 * invalidates the read. `fieldTypes` carries each field's schema type so the pinned
 * filter value canonicalizes the same way the purge side's stored row value does — and
 * so date-ish types (not pin-safe, see `PIN_UNSAFE_SCOPE_TYPES`) are skipped.
 */
export function pinnedScopedCacheTagsFromFilter(
	collection: string,
	fields: string[],
	filter: Filter | null | undefined,
	fieldTypes: Record<string, Type | undefined> = {},
): ScopedCacheTag[] {
	if (!filter || fields.length === 0) {
		return [];
	}

	const fieldSet = new Set(fields);
	const pinned = new Map<string, Set<unknown>>();

	function pin(field: string, values: unknown[]): void {
		const seen = pinned.get(field) ?? new Set<unknown>();

		for (const value of values) {
			seen.add(value);
		}

		pinned.set(field, seen);
	}

	function walk(node: Filter): void {
		for (const [key, value] of Object.entries(node)) {
			if (key === '_and' && Array.isArray(value)) {
				for (const sub of value) {
					walk(sub as Filter);
				}

				continue;
			}

			// `_or` doesn't bound the read; nothing under it can pin a scope. A date-ish field
			// isn't pin-safe (filter↔row canonical can diverge), so it's skipped too — the read
			// falls back to the bare collection tag.
			if (
				key === '_or' ||
				!fieldSet.has(key) ||
				!isPinnableScopeType(fieldTypes[key]) ||
				value === null ||
				typeof value !== 'object'
			) {
				continue;
			}

			const ops = value as Record<string, unknown>;

			if ('_eq' in ops) {
				pin(key, [ops['_eq']]);
			}
			else if ('_in' in ops && Array.isArray(ops['_in'])) {
				pin(key, ops['_in']);
			}
		}
	}

	walk(filter);

	const tags: ScopedCacheTag[] = [];

	for (const [field, values] of pinned) {
		for (const value of values) {
			tags.push({ collection, field, value, type: fieldTypes[field] });
		}
	}

	return tags;
}
