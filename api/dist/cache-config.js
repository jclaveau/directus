import { useBus } from "./bus/lib/use-bus.js";
import "./bus/index.js";
import { useEnv } from "@directus/env";

//#region src/cache-config.ts
/**
* The live global cache-TTL override, persisted in `directus_settings.cache_ttl`
* and mirrored here so the hot path reads a module variable, never a per-request DB
* query (same shape as `cacheStatsActive()`). `null` means "no override" → the
* reader falls back to env `CACHE_TTL`.
*
* Seeded from settings at boot; kept live across every node by the
* `cacheConfigChanged` bus channel, which the settings PATCH publishes (see
* `SettingsService`). A node that missed the publish re-seeds correctly on its next
* boot, so the DB row stays the durable source of truth.
*/
let cacheTtlOverride = null;
const CONFIG_CHANGED_CHANNEL = "cacheConfigChanged";
/**
* The TTL value in force — the settings override when set, else env `CACHE_TTL`.
* Returned raw (a duration string, or undefined when neither is set) for
* `getMilliseconds` to parse at the consuming site, exactly as env was read before.
*/
function resolvedCacheTtl() {
	return cacheTtlOverride ?? useEnv()["CACHE_TTL"];
}
function normaliseTtl(value) {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}
/** Re-read the durable override from `directus_settings` into the mirror. */
async function refreshCacheTtlOverride() {
	const { default: getDatabase } = await import("./database/index.js");
	cacheTtlOverride = normaliseTtl((await getDatabase().select("cache_ttl").from("directus_settings").first())?.cache_ttl);
}
/**
* Announce a TTL change to every node and apply it here now. The peers pick it up
* off the bus; a booting node that missed the message re-seeds from settings via
* `refreshCacheTtlOverride`.
*/
function publishCacheConfigChanged(ttl) {
	const normalised = normaliseTtl(ttl);
	cacheTtlOverride = normalised;
	useBus().publish(CONFIG_CHANGED_CHANNEL, { ttl: normalised });
}
/**
* Seed the override from settings and subscribe to live changes. Called
* unconditionally at boot (unlike the cache-stats gate) so the override works even
* when stats/Redis are off — with no Redis the bus is a same-process emitter, which
* still delivers this node's own publishes.
*/
async function initCacheConfig() {
	try {
		await refreshCacheTtlOverride();
	} catch {}
	useBus().subscribe(CONFIG_CHANGED_CHANNEL, ({ ttl }) => {
		cacheTtlOverride = normaliseTtl(ttl);
	});
	const { default: emitter } = await import("./emitter.js");
	const { recordCacheConfigEvent } = await import("./cache-events.js");
	emitter.onAction("settings.update", ({ payload }) => {
		if (!payload || "cache_ttl" in payload === false) return;
		publishCacheConfigChanged(payload["cache_ttl"]);
		recordCacheConfigEvent("ttl_change", payload["cache_ttl"]).catch(() => {});
	});
}

//#endregion
export { initCacheConfig, publishCacheConfigChanged, refreshCacheTtlOverride, resolvedCacheTtl };