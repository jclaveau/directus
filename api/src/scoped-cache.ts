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
 */
export function pinnedScopedCacheTagsFromFilter(
	collection: string,
	fields: string[],
	filter: Filter | null | undefined,
	fieldTypes: Record<string, Type | undefined> = {},
	relatedPrimaryKeys: Record<string, string> = {},
	scopedCachePaths: { field: string; segments: string[] }[] = [],
): ScopedCacheTag[] {
	if (!filter || (fields.length === 0 && scopedCachePaths.length === 0)) {
		return [];
	}

	const fieldSet = new Set(fields);

	// A relational-path scope field (`enrollment.student.user`) is pinned by walking
	// the nested filter down its segments to the terminal `_eq`/`_in` (`evalPathsAt`).
	// Grouped by head segment so a filter key can look up the paths it starts.
	const pathsByHead = new Map<string, { field: string; segments: string[] }[]>();

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
