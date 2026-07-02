import { useEnv } from '@directus/env';
import { isSystemCollection } from '@directus/system-data';
import type {
	Accountability,
	Item,
	Query,
	ScopedCacheTag,
	SchemaOverview,
} from '@directus/types';
import { parse as parseBytesConfiguration } from 'bytes';
import type Keyv from 'keyv';
import type { Knex } from 'knex';
import { getCacheValue, setCacheValue } from '../cache.js';
import { tagScopedCacheKeys } from '../scoped-cache.js';
import { getReadThroughCacheKey } from '../utils/get-cache-key.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { stringByteSize } from '../utils/get-string-byte-size.js';
import { isCacheTypeEnabled } from '../utils/is-cache-type-enabled.js';
import { permissionsCachable } from '../utils/permissions-cachable.js';

const env = useEnv();

export interface ServiceCacheContext {
	knex: Knex;
	collection: string;
	accountability: Accountability | null;
	schema: SchemaOverview;
	query: Query;
	cache: Keyv | null;
	/** `true` when the caller passed `{ cache: false }` to force a fresh read. */
	optOut: boolean;
}

/**
 * The cache key for a `readByQuery`, or `null` when this read must not be cached.
 * Caching is on by default but only happens when it's safe: the data cache is
 * enabled and includes the `service` type, the read isn't inside a transaction
 * (uncommitted rows) or on a system collection (permission/policy reads stay
 * fresh via the system cache), and permissions carry no `$NOW` dynamic var. The
 * cheap guards run first; the async `permissionsCachable` probe only when they
 * pass.
 */
export async function resolveServiceCacheKey(
	ctx: ServiceCacheContext,
): Promise<string | null> {
	const cacheable =
		!ctx.optOut &&
		env['CACHE_ENABLED'] === true &&
		isCacheTypeEnabled('service') &&
		ctx.cache !== null &&
		!ctx.knex.isTransaction &&
		!isSystemCollection(ctx.collection);

	if (!cacheable) {
		return null;
	}

	const cachablePermissions = await permissionsCachable(
		ctx.collection,
		{ knex: ctx.knex, schema: ctx.schema },
		ctx.accountability ?? undefined,
	);

	if (!cachablePermissions) {
		return null;
	}

	return getReadThroughCacheKey(ctx.collection, ctx.query, ctx.accountability);
}

/**
 * Read a cached slice, or `undefined` on a miss. A cache-store read failure is
 * swallowed (returns `undefined`) so it degrades to a live read rather than
 * failing the query.
 */
export async function readServiceCache(
	cache: Keyv,
	key: string,
): Promise<Item[] | undefined> {
	try {
		return await getCacheValue(cache, key);
	}
	catch {
		return undefined;
	}
}

/**
 * Populate the read-through cache on a miss, then index the key under the scope
 * tags so a later mutation purges exactly this slice (or a full/collection flush
 * outside scoped mode). Best-effort: an over-max-size payload or a store write
 * failure just skips caching, never fails the read.
 */
export async function writeServiceCache(
	cache: Keyv,
	key: string,
	records: Item[],
	tags: ScopedCacheTag[],
): Promise<void> {
	const maxSize = env['CACHE_VALUE_MAX_SIZE'] === false
		? null
		: parseBytesConfiguration(env['CACHE_VALUE_MAX_SIZE'] as string);

	const withinMaxSize = maxSize === null
		|| stringByteSize(JSON.stringify(records)) <= maxSize;

	if (!withinMaxSize) {
		return;
	}

	try {
		await setCacheValue(cache, key, records, getMilliseconds(env['CACHE_TTL']));

		await setCacheValue(cache, `${key}__expires_at`, {
			exp: Date.now() + getMilliseconds(env['CACHE_TTL'], 0),
		});

		await tagScopedCacheKeys(key, tags);
	}
	catch {
		// Caching is best-effort; a store write failure must not fail the read.
	}
}
