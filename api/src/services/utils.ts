import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { systemCollectionRows } from '@directus/system-data';
import type { AbstractServiceOptions, Accountability, PrimaryKey, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { clearSystemCache, getCache, getCacheValue } from '../cache.js';
import {
	type CacheAnomalyRecord,
	type CacheEntryRecord,
	type CacheStatsState,
	evictCacheEntriesForPath,
	evictCacheEntry,
	getCacheStatsState,
	listCacheAnomalies,
	listCacheEntries,
	readCacheTombstone,
	setCacheStatsEnabled,
	truncateCacheEvents,
} from '../cache-events.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { countScopedCacheTagMembers } from '../scoped-cache.js';
import { compress } from '../utils/compress.js';
import { stringByteSize } from '../utils/get-string-byte-size.js';
import { shouldClearCache } from '../utils/should-clear-cache.js';

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

	async clearCache({ system }: { system: boolean }): Promise<void> {
		if (this.accountability?.admin !== true) {
			throw new ForbiddenError({
				reason: `'${this.accountability?.user}' does not have permission to clear the cache as not being an admin`,
			});
		}

		const { cache } = getCache();

		if (system) {
			await clearSystemCache({ forced: true });
		}

		return cache?.clear();
	}

	private assertCacheAdmin(action: string): void {
		if (this.accountability?.admin !== true) {
			const reason =
				`'${this.accountability?.user}' does not have permission `
				+ `to ${action} as not being an admin`;

			throw new ForbiddenError({ reason });
		}
	}

	async getCacheEntries(windowMs?: number): Promise<CacheEntryRecord[]> {
		this.assertCacheAdmin('inspect the cache');

		return listCacheEntries(windowMs);
	}

	async getCacheAnomalies(windowMs?: number): Promise<CacheAnomalyRecord[]> {
		this.assertCacheAdmin('inspect cache anomalies');

		return listCacheAnomalies(windowMs);
	}

	// The live Redis state for a single key — the cached response plus its
	// sidecars (scoped-cache tags, expiry metadata) — none of which the Postgres
	// descriptor holds. All may be gone: the descriptor outlives the value.
	async readCacheEntry(key: string): Promise<{
		exists: boolean;
		value: unknown;
		tags: string[] | null;
		tagCounts: Record<string, number>;
		expiry: { exp: number; createdAt: number; ttlMs: number | null } | null;
		sizes: { uncompressed: number; compressed: number } | null;
		tombstone: number | null;
	}> {
		this.assertCacheAdmin('inspect a cache entry');

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
			};
		}

		const value = await getCacheValue(cache, key);
		const expiry = (await getCacheValue(cache, `${key}__expires_at`)) ?? null;
		const tagged = await getCacheValue(cache, `${key}__tags`);

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
			tombstone: await readCacheTombstone(key),
		};
	}

	async evictCacheEntry(key: string): Promise<void> {
		this.assertCacheAdmin('evict a cache entry');

		const { cache } = getCache();

		if (cache) {
			await evictCacheEntry(cache, key);
		}
	}

	async evictCacheEntriesForPath(path: string): Promise<number> {
		this.assertCacheAdmin('evict cache entries');

		const { cache } = getCache();

		if (!cache) {
			return 0;
		}

		return evictCacheEntriesForPath(cache, path);
	}

	async getCacheStatsState(): Promise<CacheStatsState> {
		this.assertCacheAdmin('inspect cache stats');

		return getCacheStatsState();
	}

	async setCacheStatsEnabled(enabled: boolean): Promise<void> {
		this.assertCacheAdmin('toggle cache stats');

		await setCacheStatsEnabled(enabled);
	}

	async truncateCacheStats(): Promise<void> {
		this.assertCacheAdmin('truncate cache stats');

		await truncateCacheEvents();
	}
}
