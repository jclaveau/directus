import { getMilliseconds, isPositiveDuration } from "./utils/get-milliseconds.js";
import { useLogger } from "./logger/index.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { parse } from "bytes";

//#region src/cache-settings.ts
/**
* `cache_settings`, mirrored so the hot path reads a module variable rather
* than the database. A field it does not hold is answered by its rule's
* fallback.
*/
let cacheSettings = {};
/** Which read the mirror holds, so a slower earlier one cannot replace it. */
let startedSettingsReads = 0;
let appliedSettingsRead = 0;
const DAY_MS = 1440 * 60 * 1e3;
function isByteSize(value) {
	if (Number.isInteger(value)) return value > 0;
	return typeof value === "string" && (parse(value) ?? 0) > 0;
}
function isIntegerBetween(minimum, maximum) {
	return (value) => {
		return Number.isInteger(value) && value >= minimum && value <= maximum;
	};
}
const isScanCount = isIntegerBetween(1, 1e5);
const isPinCap = isIntegerBetween(0, 1e5);
const isRetryFingerprintCap = isIntegerBetween(0, 1e5);
function isIndexTtlFactor(value) {
	return typeof value === "number" && value >= 1 && value <= 100;
}
/** `CACHE_RESPONSE` where it is set, else `CACHE_ENABLED`. */
function envResponseCache() {
	const envVars = useEnv();
	const responseSwitch = envVars["CACHE_RESPONSE"];
	if (typeof responseSwitch === "boolean") return responseSwitch;
	return envVars["CACHE_ENABLED"] === true;
}
/**
* Every field the layer takes, what a value has to be, and what answers when
* the layer leaves it out. Each one only changes what a later fill or purge
* costs, never which entries a write reaches: a field that could leave an
* entry no purge finds stays in the environment.
*
* The upper bounds keep a value inside what Redis and the database accept: past
* them the command a purge, a fill or a reap sends is refused.
*/
const CACHE_SETTING_RULES = {
	response: {
		variable: "CACHE_RESPONSE",
		accepts: (value) => typeof value === "boolean",
		expected: "true, false or null",
		fallback: envResponseCache
	},
	value_max_size: {
		variable: "CACHE_VALUE_MAX_SIZE",
		accepts: (value) => value === false || isByteSize(value),
		expected: "false, a size such as \"2mb\", or null",
		fallback: () => useEnv()["CACHE_VALUE_MAX_SIZE"]
	},
	stats_max_bytes: {
		variable: "CACHE_STATS_MAX_BYTES",
		accepts: (value) => value === false || isByteSize(value),
		expected: "false, a size such as \"2gb\", or null",
		fallback: () => {
			const envValue = useEnv()["CACHE_STATS_MAX_BYTES"];
			if (envValue === "false") return false;
			return envValue;
		}
	},
	audit_limit: {
		variable: "CACHE_AUDIT_LIMIT",
		accepts: isIntegerBetween(0, Number.MAX_SAFE_INTEGER),
		expected: "an integer from 0, or null",
		fallback: () => useEnv()["CACHE_AUDIT_LIMIT"]
	},
	audit_max_duration: {
		variable: "CACHE_AUDIT_MAX_DURATION",
		accepts: (value) => {
			return typeof value === "string" && isPositiveDuration(value) && getMilliseconds(value, Infinity) <= DAY_MS;
		},
		expected: "a duration such as \"10m\", up to \"24h\", or null",
		fallback: () => useEnv()["CACHE_AUDIT_MAX_DURATION"]
	},
	scoped_index_scan_count: {
		variable: "CACHE_SCOPED_INDEX_SCAN_COUNT",
		accepts: isScanCount,
		expected: "an integer from 1 to 100000, or null",
		fallback: () => {
			return useEnv()["CACHE_SCOPED_INDEX_SCAN_COUNT"] ?? 1e3;
		}
	},
	scoped_index_ttl_factor: {
		variable: "CACHE_SCOPED_INDEX_TTL_FACTOR",
		accepts: isIndexTtlFactor,
		expected: "a number from 1 to 100, or null",
		fallback: () => {
			return useEnv()["CACHE_SCOPED_INDEX_TTL_FACTOR"] ?? 2;
		}
	},
	scoped_max_pins_per_collection: {
		variable: "CACHE_SCOPED_MAX_PINS_PER_COLLECTION",
		accepts: isPinCap,
		expected: "an integer from 0 to 100000, or null",
		fallback: () => {
			return useEnv()["CACHE_SCOPED_MAX_PINS_PER_COLLECTION"] ?? 250;
		}
	},
	scoped_purge_retry_max_fingerprints: {
		variable: "CACHE_SCOPED_PURGE_RETRY_MAX_FINGERPRINTS",
		accepts: isRetryFingerprintCap,
		expected: "an integer from 0 to 100000, or null",
		fallback: () => {
			return useEnv()["CACHE_SCOPED_PURGE_RETRY_MAX_FINGERPRINTS"] ?? 100;
		}
	}
};
/**
* Refuse a variable the layer's own rule would refuse, at boot, before the
* server listens: a deployment carrying one fails its healthcheck and the one
* before keeps the traffic, rather than running on a value nobody asked for.
* An optional variable left unset is not checked.
*/
function validateCacheSettingsEnv() {
	for (const cacheRule of Object.values(CACHE_SETTING_RULES)) {
		const envValue = cacheRule.fallback();
		if (envValue === void 0 || cacheRule.accepts(envValue)) continue;
		useLogger().error(`"${cacheRule.variable}" Environment Variable is ${JSON.stringify(envValue)}, which is not ${cacheRule.expected.replace(/, or null$/, "")}.`);
		process.exit(1);
	}
}
function isCacheSettingField(field) {
	return Object.hasOwn(CACHE_SETTING_RULES, field);
}
/**
* Who wrote the layer, when, and through which surface. Stored beside the
* fields, written by the write itself, and never a setting the mirror applies.
*/
const CACHE_SETTINGS_STAMP_FIELDS = [
	"setBy",
	"setAt",
	"setFrom"
];
function isStampField(field) {
	return CACHE_SETTINGS_STAMP_FIELDS.includes(field);
}
/**
* Refuse a layer the mirror would read as something else: an unknown field is
* a setting nothing applies, and a value its rule refuses reads as unset.
*/
function assertUsableCacheSettings(document) {
	for (const [field, value] of Object.entries(document)) {
		if (isStampField(field)) {
			if (value !== null && typeof value !== "string") throw new InvalidPayloadError({ reason: `'cache_settings.${field}' has to be a string` });
			continue;
		}
		if (isCacheSettingField(field) === false) throw new InvalidPayloadError({ reason: `'cache_settings.${field}' is not a cache setting` });
		const cacheRule = CACHE_SETTING_RULES[field];
		if (value !== null && cacheRule.accepts(value) === false) throw new InvalidPayloadError({ reason: `'cache_settings.${field}' has to be ${cacheRule.expected}` });
	}
}
/**
* Refuse a patch the way a stored layer is refused, and a stamp field as well:
* the stamp is the write's own, so a patch naming one names no cache setting.
*/
function assertUsableCacheSettingsPatch(patch) {
	const stampField = Object.keys(patch).find(isStampField);
	if (stampField !== void 0) throw new InvalidPayloadError({ reason: `'cache_settings.${stampField}' is not a cache setting` });
	assertUsableCacheSettings(patch);
}
/**
* The fields of a stored layer the mirror would apply. A row written around
* the guard — by hand, or before a field had a rule — keeps its usable fields
* rather than losing the whole layer.
*/
function usableCacheSettings(document) {
	const usableFields = {};
	for (const [field, value] of Object.entries(document ?? {})) if (isCacheSettingField(field) && CACHE_SETTING_RULES[field].accepts(value)) usableFields[field] = value;
	return usableFields;
}
/**
* The layer's value for `field`, else its rule's fallback. The mirror only
* holds values their rule accepts, so the type is the one the rule checked.
*/
function cacheSetting(field) {
	return cacheSettings[field] ?? CACHE_SETTING_RULES[field].fallback();
}
/**
* Every field as `document` resolves it here: the stored value its rule
* accepts, else the fallback and where that comes from — the fallback given
* either way.
*/
function resolveCacheSettings(document) {
	const settingFields = Object.keys(CACHE_SETTING_RULES);
	return Object.fromEntries(settingFields.map((field) => {
		const cacheRule = CACHE_SETTING_RULES[field];
		const storedValue = document?.[field];
		const envFallback = cacheRule.fallback() ?? null;
		return [field, storedValue !== void 0 && storedValue !== null && cacheRule.accepts(storedValue) ? {
			value: storedValue,
			source: "settings",
			fallback: envFallback
		} : {
			value: envFallback,
			source: "env",
			fallback: envFallback
		}];
	}));
}
/** Whether this node serves and fills the response cache. */
function cacheEnabled() {
	return cacheSetting("response");
}
/**
* Whether this node holds a response cache at all.
*
* Wider than `cacheEnabled`: a write purges through the instance, so a node
* holds one wherever an entry it could reach may be served. On Redis that is
* every node, whatever `response` reads here: the store is shared, and a node
* whose mirror lags the switch still has to purge what the others fill. On a
* memory store only this node serves its entries, so it holds one once the
* environment or the layer enables serving, and keeps it where the layer later
* switches serving off.
*/
function responseCacheWanted() {
	return envResponseCache() || cacheEnabled() || useEnv()["CACHE_STORE"] === "redis";
}
/** Re-read the layer from `directus_settings` into the mirror. */
async function refreshCacheSettings() {
	const { SHARED_SETTINGS_COLUMNS, readSharedSettings } = await import("./processes/lib/shared-settings.js");
	startedSettingsReads += 1;
	const settingsRead = startedSettingsReads;
	const storedSettings = await readSharedSettings(SHARED_SETTINGS_COLUMNS.cache);
	if (settingsRead < appliedSettingsRead) return;
	appliedSettingsRead = settingsRead;
	cacheSettings = usableCacheSettings(storedSettings);
}
/**
* Seed the mirror, leaving the environment in charge when the table cannot be
* read — a boot ahead of its migrations has no column yet.
*/
async function seedCacheSettings() {
	try {
		await refreshCacheSettings();
	} catch (readError) {
		useLogger().warn(readError, "[cache] cache_settings is unreadable; the environment alone is read");
	}
}
/**
* The transactions whose write already had its clear, taken before the
* transaction opened so the row lock is not held across it.
*/
const enablingFlushedAhead = /* @__PURE__ */ new WeakSet();
/** Let the filter below skip the clear for a write that already had it. */
function markEnablingFlushed(transaction) {
	enablingFlushedAhead.add(transaction);
}
/**
* Drop the response cache before a write switches it on where the environment
* leaves it off.
*
* Such a deployment has nodes that never held an instance, so the writes they
* served purged nothing, and whatever an earlier period filled may be stale.
* Before the write rather than after it: no node can start serving until the
* row says so, and by then the entries are gone. A clear that is refused
* refuses the write, rather than switching on over entries it could not drop.
*
* Decided on the stored row, which a node that missed an announcement may read
* otherwise than its mirror does. Answers whether it cleared.
*/
async function flushBeforeEnabling(payload, context) {
	const { SHARED_SETTINGS_COLUMNS, asSharedSettings, readSharedSettings } = await import("./processes/lib/shared-settings.js");
	const settingsColumn = SHARED_SETTINGS_COLUMNS.cache;
	if (settingsColumn in payload === false || envResponseCache()) return false;
	if (asSharedSettings(payload[settingsColumn])?.["response"] !== true) return false;
	if (context.database && enablingFlushedAhead.has(context.database)) return false;
	if (context.accountability !== null && context.accountability?.admin !== true) throw new ForbiddenError();
	const { assertUsableSharedSettings } = await import("./processes/lib/settings-guard.js");
	assertUsableSharedSettings(payload);
	if ((await readSharedSettings(settingsColumn, context.database))?.["response"] === true) return false;
	const { buildResponseCache, clearCacheTargets } = await import("./cache.js");
	buildResponseCache();
	await clearCacheTargets(["response"]);
	return true;
}
/**
* Keep the mirror live: a change announced on the bus re-reads it at once, and
* the shared-settings floor re-reads it on a node that missed the announcement.
*/
async function initCacheSettings() {
	const cacheLogger = useLogger();
	const { SHARED_SETTINGS_COLUMNS, onSharedSettingsChanged, sharedSettingsPollMs } = await import("./processes/lib/shared-settings.js");
	const rereadSetting = () => {
		refreshCacheSettings().catch((refreshError) => {
			cacheLogger.warn(refreshError, "[cache] could not re-read cache_settings");
		});
	};
	onSharedSettingsChanged(SHARED_SETTINGS_COLUMNS.cache, rereadSetting);
	setInterval(rereadSetting, sharedSettingsPollMs()).unref();
	const { default: emitter } = await import("./emitter.js");
	for (const event of ["settings.create.one", "settings.update.one"]) emitter.onFilter(event, async (payload, _meta, context) => {
		await flushBeforeEnabling(payload, context);
		return payload;
	});
}

//#endregion
export { assertUsableCacheSettings, assertUsableCacheSettingsPatch, cacheEnabled, cacheSetting, envResponseCache, flushBeforeEnabling, initCacheSettings, markEnablingFlushed, refreshCacheSettings, resolveCacheSettings, responseCacheWanted, seedCacheSettings, usableCacheSettings, validateCacheSettingsEnv };