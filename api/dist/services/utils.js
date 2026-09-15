import { getMilliseconds } from "../utils/get-milliseconds.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { cacheExpiresAtKey, cacheTagsKey } from "../cache-sidecars.js";
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
import { applySharedSettingsPatch, parseSharedSettingsPatch } from "../processes/autoscale/lib/shared-settings.js";
import { MAX_DRILL_PERCENT, MAX_DRILL_SECONDS, MIN_DRILL_PERCENT, drillState, loadedWorker, startDrill, stopDrill } from "../processes/autoscale/lib/drill.js";
import { SHARED_SETTINGS_COLUMNS, readAllSharedSettings, readSharedSettings, writeSharedSettings } from "../processes/lib/shared-settings.js";
import { applySupervisorPatch, parseSupervisorPatch } from "../processes/autoscale/lib/supervisor-shared-settings.js";
import { askForReload, reloadRefusal } from "../processes/autoscale/lib/reload.js";
import { configWithSharedSettings } from "../processes/autoscale/lib/resolve-config.js";
import { assertUsableConfig } from "../processes/autoscale/lib/validate-config.js";
import { processesReportEnabled } from "../processes/lib/processes-config.js";
import { collectProcesses } from "../processes/lib/collect-processes.js";
import "../processes/index.js";
import { stringByteSize } from "../utils/get-string-byte-size.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { systemCollectionRows } from "@directus/system-data";

//#region src/services/utils.ts
/**
* A whole number inside the range the field accepts, or the answer saying it
* is not one.
*
* Both drill inputs reach here off a query string, where every value is a
* string and `'abc'` and `''` are the same `NaN` — so the check is one place
* and the message names the field and the range it missed.
*/
function wholeNumberWithin(value, low, high, field) {
	const parsed = Number(value);
	if (Number.isInteger(parsed) === false || parsed < low || parsed > high) throw new InvalidPayloadError({ reason: `'${field}' has to be a whole number between ${low} and ${high}` });
	return parsed;
}
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
		const expiry = await getCacheValue(cache, cacheExpiresAtKey(redisKey)) ?? null;
		const tagged = await getCacheValue(cache, cacheTagsKey(redisKey));
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
	async readProcesses(details) {
		this.assertAdmin("inspect the running processes");
		return collectProcesses(details);
	}
	/**
	* The shared settings, and the key they are stored under.
	*
	* Only the shared settings: what the pool is actually being scaled on is the
	* environment of the process that scales it laid under this, and that
	* process reports it with `readProcesses` rather than answering a request.
	*/
	async readAutoscaleConfig() {
		this.assertAdmin("inspect the autoscale configuration");
		const stored = await readAllSharedSettings();
		return this.answerWith(stored[SHARED_SETTINGS_COLUMNS.autoscale], stored[SHARED_SETTINGS_COLUMNS.supervisor]);
	}
	/**
	* Lay a patch over the shared settings, `null` giving one field back to the
	* environment chain.
	*
	* Field by field on purpose: a write of the whole object would pin every
	* value a form happened to render, and the next deployment's environment
	* would stop reaching the pool without anyone having asked for that.
	*/
	async updateAutoscaleConfig(patch, surface) {
		this.assertAdmin("change the autoscale configuration");
		const stamped = {
			...parseSharedSettingsPatch(patch),
			setBy: this.accountability?.user ?? null,
			setAt: (/* @__PURE__ */ new Date()).toISOString(),
			setFrom: surface
		};
		const stored = await readAllSharedSettings();
		const sharedSettings = applySharedSettingsPatch(stored[SHARED_SETTINGS_COLUMNS.autoscale], stamped);
		assertUsableConfig(configWithSharedSettings(sharedSettings ?? {}));
		await writeSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale, sharedSettings, this.settingsOptions);
		return this.answerWith(sharedSettings, stored[SHARED_SETTINGS_COLUMNS.supervisor]);
	}
	/**
	* The shared settings with the writer named rather than identified.
	*
	* The stamp keeps the user's id, which survives a rename and a changed
	* address; a page reading it back wants the address, and only the database
	* turns one into the other.
	*/
	async answerWith(sharedSettings, supervisorSettings) {
		return {
			key: `directus_settings.${SHARED_SETTINGS_COLUMNS.autoscale}`,
			sharedSettings,
			setByEmail: await this.emailOf(sharedSettings?.["setBy"]),
			supervisor: await this.supervisorAnswer(supervisorSettings)
		};
	}
	async supervisorAnswer(sharedSettings) {
		return {
			key: `directus_settings.${SHARED_SETTINGS_COLUMNS.supervisor}`,
			sharedSettings,
			setByEmail: await this.emailOf(sharedSettings?.["setBy"])
		};
	}
	/**
	* Change the pm2 options the next rolling restart will carry.
	*
	* Stored rather than applied: pm2 reads these when it starts a worker, so
	* the write lands on the pool through the restart below it and the page
	* says so. Nothing is clamped — a supervisor takes what it is handed.
	*/
	async updateSupervisorConfig(patch, surface) {
		this.assertAdmin("change the supervisor configuration");
		const stamped = {
			...parseSupervisorPatch(patch),
			setBy: this.accountability?.user ?? null,
			setAt: (/* @__PURE__ */ new Date()).toISOString(),
			setFrom: surface
		};
		const sharedSettings = applySupervisorPatch(await readSharedSettings(SHARED_SETTINGS_COLUMNS.supervisor), stamped);
		await writeSharedSettings(SHARED_SETTINGS_COLUMNS.supervisor, sharedSettings, this.settingsOptions);
		return this.supervisorAnswer(sharedSettings);
	}
	/**
	* What a write to the settings singleton runs as.
	*
	* The accountability travels with it because that is what puts a row in
	* `directus_revisions`: the stamp says who changed a threshold, and the
	* revision is what survives the stamp being overwritten by the next change.
	*/
	get settingsOptions() {
		return {
			knex: this.knex,
			schema: this.schema,
			accountability: this.accountability
		};
	}
	async emailOf(user) {
		if (typeof user !== "string") return null;
		try {
			return (await this.knex.select("email").from("directus_users").where({ id: user }).first())?.email ?? null;
		} catch {
			return null;
		}
	}
	/**
	* Every process that is scaling a pool, with what it last decided on.
	*
	* Read from the same report the processes page collects, because the values
	* a pool is actually scaled on are the ones resolved in the process that
	* scales it — an api worker resolving them again would answer for its own
	* environment, which is a different process's.
	*/
	async readAutoscaleRunners() {
		this.assertAdmin("inspect the autoscale configuration");
		if (processesReportEnabled() === false) return [];
		return (await collectProcesses(["stats"])).services.flatMap((service) => {
			return service.replicas.flatMap((replica) => {
				return replica.processes.filter((node) => node.autoscale !== null).map((node) => {
					return {
						service: service.service,
						replicaId: replica.replicaId,
						nodeId: node.nodeId,
						name: node.name,
						state: node.autoscale
					};
				});
			});
		});
	}
	/** What the worker answering this is burning, and until when. */
	async readAutoscaleDrill() {
		this.assertAdmin("inspect the autoscale load drill");
		return drillState();
	}
	/**
	* Put the whole pool under load for a while.
	*
	* A configuration change is judged by what the loop does with it, and a
	* quiet pool does nothing with any of it: the thresholds are never reached,
	* the cooldowns never start, and a ceiling that is wrong stays wrong until
	* the traffic that proves it arrives at the worst possible time. This
	* produces that traffic's effect on demand, and nothing else — it never
	* touches the bounds it is being used to test.
	*/
	async startAutoscaleDrill(seconds, percent) {
		this.assertAdmin("run an autoscale load drill");
		const duration = wholeNumberWithin(seconds, 1, MAX_DRILL_SECONDS, "seconds");
		const share = wholeNumberWithin(percent, MIN_DRILL_PERCENT, MAX_DRILL_PERCENT, "percent");
		const hottest = loadedWorker(await this.readAutoscaleRunners());
		if (hottest !== null) throw new InvalidPayloadError({ reason: `the pool is already working — a worker is at ${hottest}% CPU, so a drill would measure that as well as itself` });
		return startDrill(duration, share);
	}
	/**
	* Restart every worker of the pool without dropping below its size.
	*
	* The supervisor starts a replacement, waits for it to report ready, and
	* only then retires the worker it replaces — which is how a change to
	* something the pool reads at boot reaches it without a deploy and without
	* a gap in service. Asked for over the bus rather than run here: this
	* worker is one of the ones being replaced.
	*/
	async startAutoscaleReload() {
		this.assertAdmin("restart the autoscaled pool");
		const refusal = reloadRefusal(await this.readAutoscaleRunners());
		if (refusal !== null) throw new InvalidPayloadError({ reason: refusal });
		return askForReload();
	}
	/** Call the drill off before its deadline. */
	async stopAutoscaleDrill() {
		this.assertAdmin("stop the autoscale load drill");
		return stopDrill();
	}
	/** Drop the shared settings, so every field comes from the environment again. */
	async clearAutoscaleConfig() {
		this.assertAdmin("clear the autoscale configuration");
		await writeSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale, null, this.settingsOptions);
	}
	async readPgBouncer(details) {
		this.assertAdmin("inspect the pgbouncer pools");
		return collectPgBouncer(details);
	}
};

//#endregion
export { UtilsService };