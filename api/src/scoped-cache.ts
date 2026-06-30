import { useEnv } from '@directus/env';
import type { EventContext, Filter, ScopedCacheTag } from '@directus/types';
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
	return env['CACHE_AUTO_PURGE_MODE'] === 'scoped' && env['CACHE_STORE'] === 'redis' && redisConfigAvailable();
}

// `String(value)` collapses types (number 7 vs string "7", null vs "null"). Safe
// because a given scope column has a stable type — tag and purge always resolve the
// value from the same column.
function serializeScopedCacheTagValue(value: unknown): string {
	return value === null || value === undefined
		? 'null'
		: String(value);
}

function scopedCacheTagKey(tag: ScopedCacheTag): string {
	const base = `${env['CACHE_NAMESPACE']}:tag:${tag.collection}`;
	return tag.field === undefined
		? base
		: `${base}:${tag.field}=${serializeScopedCacheTagValue(tag.value)}`;
}

/**
 * Index a freshly-cached response key under every tag its data came from, so a later
 * mutation can drop just the matching entries instead of the whole namespace. Both the
 * payload key and its `__expires_at` sibling are tagged. Each tag set self-expires at
 * twice the cache TTL as a safety net against members orphaned by a crash between write
 * and purge.
 */
export async function tagScopedCacheKeys(
	key: string,
	tags: Iterable<ScopedCacheTag>,
): Promise<void> {
	if (!scopedCachePurgeEnabled()) {
		return;
	}

	const tagKeys = [...new Set([...tags].map(scopedCacheTagKey))];

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
 * Purge cached responses affected by a mutation on `collection`. Outside scoped mode
 * the whole data cache is flushed (legacy `cache.clear()` behavior). In scoped mode
 * the bare collection tag (global reads) is always purged alongside the resolved
 * `scopedCacheTags` (the owner/partition slices the mutation touched), leaving every
 * other slice untouched. A `null` `scopedCacheTags` means "values couldn't be
 * resolved" → fall back to a full flush rather than risk leaving a stale slice behind.
 */
export async function purgeCache(
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
		await cache.clear();
		return;
	}

	const tags = (await emitter.emitFilter(
		'cache.purge',
		[{ collection }, ...scopedCacheTags],
		{ collection },
		context,
	)) as ScopedCacheTag[];

	const redis = useRedis();
	const tagKeys = [...new Set(tags.map(scopedCacheTagKey))];
	const memberLists = await Promise.all(tagKeys.map((tagKey) => redis.smembers(tagKey)));
	const members = [...new Set(memberLists.flat())];

	if (members.length > 0) {
		await Promise.all(members.map((member) => cache.delete(member)));
	}

	// A `cache.purge` filter could empty the tag set; `redis.del()` with no keys throws.
	if (tagKeys.length > 0) {
		await redis.del(...tagKeys);
	}
}

/**
 * Build scoped cache tags from the distinct scope values present across `rows` — the
 * purge side. With `requireAll` a row missing any scoped cache field makes the values
 * unresolvable (returns `null`), so the caller falls back to a coarse purge rather than
 * leaving a slice stale (a create whose payload omitted the field). Without it, missing
 * fields are skipped — for update payloads where an absent field just means "unchanged"
 * and the pre-update capture covers the old value.
 */
export function scopedCacheTagsFromRows(
	collection: string,
	fields: string[],
	rows: Record<string, any>[],
	requireAll: boolean,
): ScopedCacheTag[] | null {
	const tags: ScopedCacheTag[] = [];

	for (const field of fields) {
		const seen = new Set<unknown>();

		for (const row of rows) {
			if (!(field in row)) {
				if (requireAll) {
					return null;
				}

				continue;
			}

			const value = row[field];

			if (seen.has(value)) {
				continue;
			}

			seen.add(value);
			tags.push({ collection, field, value });
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
 * invalidates the read.
 */
export function pinnedScopeTagsFromFilter(
	collection: string,
	fields: string[],
	filter: Filter | null | undefined,
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

			// `_or` doesn't bound the read; nothing under it can pin a scope.
			if (
				key === '_or' ||
				!fieldSet.has(key) ||
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
			tags.push({ collection, field, value });
		}
	}

	return tags;
}
