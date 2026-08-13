import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { systemCollectionRows } from '@directus/system-data';
import type {
	AbstractServiceOptions,
	Accountability,
	CacheFlushTarget,
	PgBouncerDetail,
	PgBouncerReport,
	PrimaryKey,
	ProcessesReport,
	SchemaOverview,
} from '@directus/types';
import type { Knex } from 'knex';
import { clearCacheTargets, getCache, getCacheValue } from '../cache.js';
import {
	type CacheAnomalyRecord,
	type CacheEntryRecord,
	type CacheGroupLatencyRecord,
	type CacheStatsState,
	type CacheTimeseries,
	CACHE_TIMESERIES_MAX_BUCKETS,
	CACHE_TIMESERIES_MIN_BUCKETS,
	evictCacheEntriesForPath,
	evictCacheEntry,
	getCacheStatsState,
	listCacheAnomalies,
	listCacheEntries,
	type CacheEntryPurgeRecord,
	listCacheGroupLatencies,
	listPurgesCoveringEntry,
	readCacheDescriptorForRedisKey,
	readCacheTimeseries,
	readCacheTombstone,
	recordCacheConfigEvent,
	setCacheStatsEnabled,
	truncateCacheEvents,
} from '../cache-events.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { collectPgBouncer } from '../pgbouncer/index.js';
import { collectProcesses } from '../processes/index.js';
import { countScopedCacheTagMembers } from '../scoped-cache.js';
import { compress } from '../utils/compress.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { stringByteSize } from '../utils/get-string-byte-size.js';
import { shouldClearCache } from '../utils/should-clear-cache.js';

/**
 * How far back a cache read was asked to look, as milliseconds.
 *
 * A duration the parser cannot read is refused rather than quietly becoming the
 * default: a caller told "here are the last 24h" when it asked for "yesterday"
 * has no way to notice, and an agent that chose the tool has no way at all.
 */
function requestedStatsWindow(raw: unknown): number | undefined {
	if (raw === undefined) {
		return undefined;
	}

	const parsed = getMilliseconds(raw);

	if (parsed === undefined) {
		throw new InvalidPayloadError({
			reason: `window '${String(raw)}' is not a duration such as "15m"`,
		});
	}

	return parsed;
}

/**
 * How many buckets a timeseries read was asked for.
 *
 * `Number` reads `null`, `[]` and `''` as 0 and `true` as 1 — all of them finite
 * — so a value that is no bucket count at all would survive a bare finiteness
 * check and silently re-bucket the read. Only a number, or text spelling one, is
 * taken; anything else is refused rather than reaching the query as an Invalid
 * Date, which fails there naming nothing the caller could act on.
 *
 * Out of range is refused for the same reason the window is: the read clamps to
 * these bounds, and a caller that asked for ten thousand buckets and silently
 * got five hundred would go on dividing by the count it asked for.
 */
function requestedTimeseriesBuckets(raw: unknown): number | undefined {
	if (raw === undefined) {
		return undefined;
	}

	const spellsANumber = typeof raw === 'number'
		|| (typeof raw === 'string' && raw.trim() !== '');

	const parsed = spellsANumber
		? Number(raw)
		: Number.NaN;

	if (Number.isFinite(parsed) === false) {
		throw new InvalidPayloadError({
			reason: `buckets '${String(raw)}' is not a number`,
		});
	}

	if (
		parsed < CACHE_TIMESERIES_MIN_BUCKETS
		|| parsed > CACHE_TIMESERIES_MAX_BUCKETS
	) {
		throw new InvalidPayloadError({
			reason: `buckets '${String(raw)}' is outside `
				+ `${CACHE_TIMESERIES_MIN_BUCKETS}-${CACHE_TIMESERIES_MAX_BUCKETS}`,
		});
	}

	return parsed;
}

export class UtilsService {
	knex: Knex;
	accountability: Accountability | null;
	schema: SchemaOverview;

	constructor(options: AbstractServiceOptions) {
		this.knex = options.knex || getDatabase();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}

	async sort(collection: string, { item, to }: { item: PrimaryKey; to: PrimaryKey }): Promise<void> {
		const sortFieldResponse =
			(await this.knex.select('sort_field').from('directus_collections').where({ collection }).first()) ||
			systemCollectionRows;

		const sortField = sortFieldResponse?.sort_field;

		if (!sortField) {
			throw new InvalidPayloadError({ reason: `Collection "${collection}" doesn't have a sort field` });
		}

		if (this.accountability && this.accountability.admin !== true) {
			await validateAccess(
				{
					accountability: this.accountability,
					action: 'update',
					collection,
				},
				{
					schema: this.schema,
					knex: this.knex,
				},
			);

			const allowedFields = await fetchAllowedFields(
				{ collection, action: 'update', accountability: this.accountability },
				{ schema: this.schema, knex: this.knex },
			);

			if (allowedFields[0] !== '*' && allowedFields.includes(sortField) === false) {
				throw new ForbiddenError({
					reason: `'${this.accountability.user}' does not have permission to read the sort field '${collection}.${sortField}'`,
				});
			}
		}

		const primaryKeyField = this.schema.collections[collection]!.primary;

		// Make sure all rows have a sort value
		const countResponse = await this.knex.count('* as count').from(collection).whereNull(sortField).first();

		if (countResponse?.count && +countResponse.count !== 0) {
			const lastSortValueResponse = await this.knex.max(sortField).from(collection).first();

			const rowsWithoutSortValue = await this.knex
				.select(primaryKeyField, sortField)
				.from(collection)
				.whereNull(sortField);

			let lastSortValue: any = lastSortValueResponse ? Object.values(lastSortValueResponse)[0] : 0;

			for (const row of rowsWithoutSortValue) {
				lastSortValue++;

				await this.knex(collection)
					.update({ [sortField]: lastSortValue })
					.where({ [primaryKeyField]: row[primaryKeyField] });
			}
		}

		// Check to see if there's any duplicate values in the sort counts. If that's the case, we'll have to
		// reset the count values, otherwise the sort operation will cause unexpected results
		const duplicates = await this.knex
			.select(sortField)
			.count(sortField, { as: 'count' })
			.groupBy(sortField)
			.from(collection)
			.havingRaw('count(??) > 1', [sortField]);

		if (duplicates?.length > 0) {
			const ids = await this.knex.select(primaryKeyField).from(collection).orderBy(sortField);

			// This might not scale that well, but I don't really know how to accurately set all rows
			// to a sequential value that works cross-DB vendor otherwise
			for (let i = 0; i < ids.length; i++) {
				await this.knex(collection)
					.update({ [sortField]: i + 1 })
					.where(ids[i]);
			}
		}

		const targetSortValueResponse = await this.knex
			.select(sortField)
			.from(collection)
			.where({ [primaryKeyField]: to })
			.first();

		const targetSortValue = targetSortValueResponse[sortField];

		const sourceSortValueResponse = await this.knex
			.select(sortField)
			.from(collection)
			.where({ [primaryKeyField]: item })
			.first();

		const sourceSortValue = sourceSortValueResponse[sortField];

		// Set the target item to the new sort value
		await this.knex(collection)
			.update({ [sortField]: targetSortValue })
			.where({ [primaryKeyField]: item });

		if (sourceSortValue < targetSortValue) {
			await this.knex(collection)
				.decrement(sortField, 1)
				.where(sortField, '>', sourceSortValue)
				.andWhere(sortField, '<=', targetSortValue)
				.andWhereNot({ [primaryKeyField]: item });
		} else {
			await this.knex(collection)
				.increment(sortField, 1)
				.where(sortField, '>=', targetSortValue)
				.andWhere(sortField, '<=', sourceSortValue)
				.andWhereNot({ [primaryKeyField]: item });
		}

		// check if cache should be cleared
		const { cache } = getCache();

		if (shouldClearCache(cache, undefined, collection)) {
			await cache.clear();
		}

		emitter.emitAction(
			['items.sort', `${collection}.items.sort`],
			{
				collection,
				item,
				to,
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);
	}

	async clearCache({ targets }: { targets: CacheFlushTarget[] }): Promise<void> {
		if (this.accountability?.admin !== true) {
			throw new ForbiddenError({
				reason: `'${this.accountability?.user}' does not have permission to clear the cache as not being an admin`,
			});
		}

		await clearCacheTargets(targets);

		// Best-effort marker for the cache-page timeseries; never fail the flush on it.
		void recordCacheConfigEvent('flush', targets.join(',')).catch(() => {});
	}

	private assertAdmin(action: string): void {
		if (this.accountability?.admin !== true) {
			const reason =
				`'${this.accountability?.user}' does not have permission `
				+ `to ${action} as not being an admin`;

			throw new ForbiddenError({ reason });
		}
	}

	/**
	 * `window` and `buckets` arrive untrusted from whichever surface asked — a
	 * query string, a tool argument — so every cache read below takes them raw and
	 * they are read here, which is what keeps the surfaces from disagreeing about
	 * the same value.
	 */
	async getCacheEntries(window?: unknown): Promise<CacheEntryRecord[]> {
		this.assertAdmin('inspect the cache');

		return listCacheEntries(requestedStatsWindow(window));
	}

	async getCacheAnomalies(window?: unknown): Promise<CacheAnomalyRecord[]> {
		this.assertAdmin('inspect cache anomalies');

		return listCacheAnomalies(requestedStatsWindow(window));
	}

	async getCacheGroupLatencies(
		window?: unknown,
	): Promise<CacheGroupLatencyRecord[]> {
		this.assertAdmin('inspect cache latencies');

		return listCacheGroupLatencies(requestedStatsWindow(window));
	}

	async getCacheTimeseries(
		window?: unknown,
		buckets?: unknown,
	): Promise<CacheTimeseries> {
		this.assertAdmin('inspect the cache timeseries');

		return readCacheTimeseries(
			requestedStatsWindow(window),
			requestedTimeseriesBuckets(buckets),
		);
	}

	// The live Redis state for a single key — the cached response plus its
	// sidecars (scoped-cache tags, expiry metadata) — none of which the Postgres
	// descriptor holds. All may be gone: the descriptor outlives the value.
	/**
	 * Takes the REDIS key — the same string `evictCacheEntry` takes, and what the
	 * listing answers as `redisKey`. Its descriptor supplies the stats identity
	 * the purge join needs; the two differ only where `CACHE_KEY_HASH_ENABLED` is
	 * off and the Redis key becomes a readable descriptor.
	 */
	async readCacheEntry(redisKey: string): Promise<{
		exists: boolean;
		value: unknown;
		tags: string[] | null;
		tagCounts: Record<string, number>;
		expiry: { exp: number; createdAt: number; ttlMs: number | null } | null;
		sizes: { uncompressed: number; compressed: number } | null;
		tombstone: number | null;
		filledAt: number | null;
		purgesSinceFilled: CacheEntryPurgeRecord[] | null;
	}> {
		this.assertAdmin('inspect a cache entry');

		const descriptor = await readCacheDescriptorForRedisKey(redisKey);

		// Empty is a reading — nothing covered it since it was written. `null` is
		// not: with no descriptor there is no fill to measure from, and answering
		// "no purges" would claim a proof this cannot give.
		const purgesSinceFilled = descriptor === null
			? null
			: await listPurgesCoveringEntry(descriptor.cacheKey, descriptor.lastFilled);

		const filledAt = descriptor?.lastFilled.getTime() ?? null;

		const { cache } = getCache();

		if (!cache) {
			return {
				exists: false,
				value: null,
				tags: null,
				tagCounts: {},
				expiry: null,
				sizes: null,
				tombstone: null,
				filledAt,
				purgesSinceFilled,
			};
		}

		const value = await getCacheValue(cache, redisKey);
		const expiry = (await getCacheValue(cache, `${redisKey}__expires_at`)) ?? null;
		const tagged = await getCacheValue(cache, `${redisKey}__tags`);

		// `__tags` stores the comma-joined scoped-cache tags (only when the
		// dev-only CACHE_TAGS_HEADER is on, which is what writes this sidecar).
		const tags = typeof tagged?.tags === 'string'
			? tagged.tags.split(', ').filter(Boolean)
			: null;

		// Re-compress the payload to size its Redis footprint against the raw response.
		let sizes: { uncompressed: number; compressed: number } | null = null;

		if (value !== undefined) {
			const packed = await compress(value);

			sizes = {
				uncompressed: stringByteSize(JSON.stringify(value)),
				compressed: Buffer.isBuffer(packed)
					? packed.byteLength
					: stringByteSize(JSON.stringify(packed)),
			};
		}

		return {
			exists: value !== undefined,
			value: value ?? null,
			tags,
			// Blast radius: how many entries each tag would purge.
			tagCounts: tags
				? await countScopedCacheTagMembers(tags)
				: {},
			expiry,
			sizes,
			// When this key last expired, if a miss-gap tombstone still lives.
			tombstone: await readCacheTombstone(redisKey),
			filledAt,
			purgesSinceFilled,
		};
	}

	async evictCacheEntry(redisKey: string): Promise<void> {
		this.assertAdmin('evict a cache entry');

		const { cache } = getCache();

		if (cache) {
			await evictCacheEntry(cache, redisKey);
		}
	}

	async evictCacheEntriesForPath(path: string): Promise<number> {
		this.assertAdmin('evict cache entries');

		const { cache } = getCache();

		if (!cache) {
			return 0;
		}

		return evictCacheEntriesForPath(cache, path);
	}

	async getCacheStatsState(): Promise<CacheStatsState> {
		this.assertAdmin('inspect cache stats');

		return getCacheStatsState();
	}

	async setCacheStatsEnabled(enabled: boolean): Promise<void> {
		this.assertAdmin('toggle cache stats');

		await setCacheStatsEnabled(enabled);
	}

	async truncateCacheStats(): Promise<void> {
		this.assertAdmin('truncate cache stats');

		await truncateCacheEvents();
	}

	async readProcesses(): Promise<ProcessesReport> {
		this.assertAdmin('inspect the running processes');

		return collectProcesses();
	}

	async readPgBouncer(details: PgBouncerDetail[]): Promise<PgBouncerReport> {
		this.assertAdmin('inspect the pgbouncer pools');

		return collectPgBouncer(details);
	}
}
