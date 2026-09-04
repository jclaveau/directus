import { getMilliseconds } from "../utils/get-milliseconds.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { CACHE_TIMESERIES_MAX_BUCKETS, CACHE_TIMESERIES_MIN_BUCKETS, evictCacheEntriesForPath, evictCacheEntry, getCacheStatsState, listCacheAnomalies, listCacheEntries, listCacheGroupLatencies, listPurgesCoveringEntry, readCacheDescriptorForRedisKey, readCacheTimeseries, readCacheTombstone, recordCacheConfigEvent, setCacheStatsEnabled, truncateCacheEvents } from "../cache-events.js";
import { countScopedCacheTagMembers } from "../scoped-cache/purge.js";
import "../scoped-cache.js";
import { compress } from "../utils/compress.js";
import { clearCacheTargets, getCache, getCacheValue } from "../cache.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { fetchAllowedFields } from "../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { collectPgBouncer } from "../pgbouncer/lib/collect-pgbouncer.js";
import "../pgbouncer/index.js";
import { collectProcesses } from "../processes/lib/collect-processes.js";
import "../processes/index.js";
import { stringByteSize } from "../utils/get-string-byte-size.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { systemCollectionRows } from "@directus/system-data";

//#region src/services/utils.ts
/**
* How far back a cache read was asked to look, as milliseconds.
*
* A duration the parser cannot read is refused rather than quietly becoming the
* default: a caller told "here are the last 24h" when it asked for "yesterday"
* has no way to notice, and an agent that chose the tool has no way at all.
*/
function requestedStatsWindow(raw) {
	if (raw === void 0) return;
	const parsed = getMilliseconds(raw);
	if (parsed === void 0) throw new InvalidPayloadError({ reason: `window '${String(raw)}' is not a duration such as "15m"` });
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
function requestedTimeseriesBuckets(raw) {
	if (raw === void 0) return;
	const parsed = typeof raw === "number" || typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
	if (Number.isFinite(parsed) === false) throw new InvalidPayloadError({ reason: `buckets '${String(raw)}' is not a number` });
	if (parsed < CACHE_TIMESERIES_MIN_BUCKETS || parsed > CACHE_TIMESERIES_MAX_BUCKETS) throw new InvalidPayloadError({ reason: `buckets '${String(raw)}' is outside ${CACHE_TIMESERIES_MIN_BUCKETS}-${CACHE_TIMESERIES_MAX_BUCKETS}` });
	return parsed;
}
var UtilsService = class {
	knex;
	accountability;
	schema;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}
	async sort(collection, { item, to }) {
		const sortField = (await this.knex.select("sort_field").from("directus_collections").where({ collection }).first() || systemCollectionRows)?.sort_field;
		if (!sortField) throw new InvalidPayloadError({ reason: `Collection "${collection}" doesn't have a sort field` });
		if (this.accountability && this.accountability.admin !== true) {
			await validateAccess({
				accountability: this.accountability,
				action: "update",
				collection
			}, {
				schema: this.schema,
				knex: this.knex
			});
			const allowedFields = await fetchAllowedFields({
				collection,
				action: "update",
				accountability: this.accountability
			}, {
				schema: this.schema,
				knex: this.knex
			});
			if (allowedFields[0] !== "*" && allowedFields.includes(sortField) === false) throw new ForbiddenError({ reason: `'${this.accountability.user}' does not have permission to read the sort field '${collection}.${sortField}'` });
		}
		const primaryKeyField = this.schema.collections[collection].primary;
		const countResponse = await this.knex.count("* as count").from(collection).whereNull(sortField).first();
		if (countResponse?.count && +countResponse.count !== 0) {
			const lastSortValueResponse = await this.knex.max(sortField).from(collection).first();
			const rowsWithoutSortValue = await this.knex.select(primaryKeyField, sortField).from(collection).whereNull(sortField);
			let lastSortValue = lastSortValueResponse ? Object.values(lastSortValueResponse)[0] : 0;
			for (const row of rowsWithoutSortValue) {
				lastSortValue++;
				await this.knex(collection).update({ [sortField]: lastSortValue }).where({ [primaryKeyField]: row[primaryKeyField] });
			}
		}
		if ((await this.knex.select(sortField).count(sortField, { as: "count" }).groupBy(sortField).from(collection).havingRaw("count(??) > 1", [sortField]))?.length > 0) {
			const ids = await this.knex.select(primaryKeyField).from(collection).orderBy(sortField);
			for (let i = 0; i < ids.length; i++) await this.knex(collection).update({ [sortField]: i + 1 }).where(ids[i]);
		}
		const targetSortValue = (await this.knex.select(sortField).from(collection).where({ [primaryKeyField]: to }).first())[sortField];
		const sourceSortValue = (await this.knex.select(sortField).from(collection).where({ [primaryKeyField]: item }).first())[sortField];
		await this.knex(collection).update({ [sortField]: targetSortValue }).where({ [primaryKeyField]: item });
		if (sourceSortValue < targetSortValue) await this.knex(collection).decrement(sortField, 1).where(sortField, ">", sourceSortValue).andWhere(sortField, "<=", targetSortValue).andWhereNot({ [primaryKeyField]: item });
		else await this.knex(collection).increment(sortField, 1).where(sortField, ">=", targetSortValue).andWhere(sortField, "<=", sourceSortValue).andWhereNot({ [primaryKeyField]: item });
		const { cache } = getCache();
		if (shouldClearCache(cache, void 0, collection)) await cache.clear();
		emitter_default.emitAction(["items.sort", `${collection}.items.sort`], {
			collection,
			item,
			to
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
	}
	async clearCache({ targets }) {
		if (this.accountability?.admin !== true) throw new ForbiddenError({ reason: `'${this.accountability?.user}' does not have permission to clear the cache as not being an admin` });
		await clearCacheTargets(targets);
		recordCacheConfigEvent("flush", targets.join(",")).catch(() => {});
	}
	assertAdmin(action) {
		if (this.accountability?.admin !== true) throw new ForbiddenError({ reason: `'${this.accountability?.user}' does not have permission to ${action} as not being an admin` });
	}
	/**
	* `window` and `buckets` arrive untrusted from whichever surface asked — a
	* query string, a tool argument — so every cache read below takes them raw and
	* they are read here, which is what keeps the surfaces from disagreeing about
	* the same value.
	*/
	async getCacheEntries(window) {
		this.assertAdmin("inspect the cache");
		return listCacheEntries(requestedStatsWindow(window));
	}
	async getCacheAnomalies(window) {
		this.assertAdmin("inspect cache anomalies");
		return listCacheAnomalies(requestedStatsWindow(window));
	}
	async getCacheGroupLatencies(window) {
		this.assertAdmin("inspect cache latencies");
		return listCacheGroupLatencies(requestedStatsWindow(window));
	}
	async getCacheTimeseries(window, buckets) {
		this.assertAdmin("inspect the cache timeseries");
		return readCacheTimeseries(requestedStatsWindow(window), requestedTimeseriesBuckets(buckets));
	}
	/**
	* Takes the REDIS key — the same string `evictCacheEntry` takes, and what the
	* listing answers as `redisKey`. Its descriptor supplies the stats identity
	* the purge join needs; the two differ only where `CACHE_KEY_HASH_ENABLED` is
	* off and the Redis key becomes a readable descriptor.
	*/
	async readCacheEntry(redisKey) {
		this.assertAdmin("inspect a cache entry");
		const descriptor = await readCacheDescriptorForRedisKey(redisKey);
		const purgesSinceFilled = descriptor === null ? null : await listPurgesCoveringEntry(descriptor.cacheKey, descriptor.lastFilled);
		const filledAt = descriptor?.lastFilled.getTime() ?? null;
		const { cache } = getCache();
		if (!cache) return {
			exists: false,
			value: null,
			tags: null,
			tagCounts: {},
			expiry: null,
			sizes: null,
			tombstone: null,
			filledAt,
			purgesSinceFilled
		};
		const value = await getCacheValue(cache, redisKey);
		const expiry = await getCacheValue(cache, `${redisKey}__expires_at`) ?? null;
		const tagged = await getCacheValue(cache, `${redisKey}__tags`);
		const tags = typeof tagged?.tags === "string" ? tagged.tags.split(", ").filter(Boolean) : null;
		let sizes = null;
		if (value !== void 0) {
			const packed = await compress(value);
			sizes = {
				uncompressed: stringByteSize(JSON.stringify(value)),
				compressed: Buffer.isBuffer(packed) ? packed.byteLength : stringByteSize(JSON.stringify(packed))
			};
		}
		return {
			exists: value !== void 0,
			value: value ?? null,
			tags,
			tagCounts: tags ? await countScopedCacheTagMembers(tags) : {},
			expiry,
			sizes,
			tombstone: await readCacheTombstone(redisKey),
			filledAt,
			purgesSinceFilled
		};
	}
	async evictCacheEntry(redisKey) {
		this.assertAdmin("evict a cache entry");
		const { cache } = getCache();
		if (cache) await evictCacheEntry(cache, redisKey);
	}
	async evictCacheEntriesForPath(path) {
		this.assertAdmin("evict cache entries");
		const { cache } = getCache();
		if (!cache) return 0;
		return evictCacheEntriesForPath(cache, path);
	}
	async getCacheStatsState() {
		this.assertAdmin("inspect cache stats");
		return getCacheStatsState();
	}
	async setCacheStatsEnabled(enabled) {
		this.assertAdmin("toggle cache stats");
		await setCacheStatsEnabled(enabled);
	}
	async truncateCacheStats() {
		this.assertAdmin("truncate cache stats");
		await truncateCacheEvents();
	}
	async readProcesses() {
		this.assertAdmin("inspect the running processes");
		return collectProcesses();
	}
	async readPgBouncer(details) {
		this.assertAdmin("inspect the pgbouncer pools");
		return collectPgBouncer(details);
	}
};

//#endregion
export { UtilsService };