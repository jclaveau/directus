import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { redisConfigAvailable } from "./redis/utils/redis-config-available.js";
import "./redis/index.js";
import { useBus } from "./bus/lib/use-bus.js";
import "./bus/index.js";
import { useLogger } from "./logger/index.js";
import { getMilliseconds } from "./utils/get-milliseconds.js";
import { clearCache } from "./permissions/cache.js";
import { compress, decompress } from "./utils/compress.js";
import { freezeSchema, unfreezeSchema } from "./utils/freeze-schema.js";
import { validateEnv } from "./utils/validate-env.js";
import { createRequire } from "node:module";
import { useEnv } from "@directus/env";
import Keyv from "keyv";

//#region src/cache.ts
const logger = useLogger();
const env = useEnv();
const require = createRequire(import.meta.url);
let cache = null;
let systemCache = null;
let deploymentCache = null;
let lockCache = null;
let messengerSubscribed = false;
let localSchemaCache = null;
let memorySchemaCache = null;
const messenger = useBus();
if (redisConfigAvailable() && !messengerSubscribed) {
	messengerSubscribed = true;
	messenger.subscribe("schemaChanged", async (opts) => {
		if (env["CACHE_STORE"] === "memory" && env["CACHE_AUTO_PURGE"] && cache && opts?.["autoPurgeCache"] !== false) await cache.clear();
		await localSchemaCache?.clear();
		memorySchemaCache = null;
	});
}
function getCache() {
	if (env["CACHE_ENABLED"] === true && cache === null) {
		validateEnv([
			"CACHE_NAMESPACE",
			"CACHE_TTL",
			"CACHE_STORE"
		]);
		cache = getKeyvInstance(env["CACHE_STORE"], getMilliseconds(env["CACHE_TTL"]));
		cache.on("error", (err) => logger.warn(err, `[cache] ${err}`));
	}
	if (systemCache === null) {
		systemCache = getKeyvInstance(env["CACHE_STORE"], getMilliseconds(env["CACHE_SYSTEM_TTL"]), "_system");
		systemCache.on("error", (err) => logger.warn(err, `[system-cache] ${err}`));
	}
	if (deploymentCache === null) {
		const ttl = getMilliseconds(env["CACHE_DEPLOYMENT_TTL"]) || 5e3;
		deploymentCache = getKeyvInstance(env["CACHE_STORE"], ttl, "_deployment");
		deploymentCache.on("error", (err) => logger.warn(err, `[deployment-cache] ${err}`));
	}
	if (localSchemaCache === null) {
		localSchemaCache = getKeyvInstance("memory", getMilliseconds(env["CACHE_SYSTEM_TTL"]), "_schema");
		localSchemaCache.on("error", (err) => logger.warn(err, `[schema-cache] ${err}`));
	}
	if (lockCache === null) {
		lockCache = getKeyvInstance(env["CACHE_STORE"], void 0, "_lock");
		lockCache.on("error", (err) => logger.warn(err, `[lock-cache] ${err}`));
	}
	return {
		cache,
		systemCache,
		deploymentCache,
		localSchemaCache,
		lockCache
	};
}
async function flushCaches(forced) {
	const { cache: cache$1 } = getCache();
	await clearSystemCache({ forced });
	await cache$1?.clear();
}
async function clearSystemCache(opts) {
	const { systemCache: systemCache$1, localSchemaCache: localSchemaCache$1, lockCache: lockCache$1 } = getCache();
	if (opts?.forced || !await lockCache$1.get("system-cache-lock")) {
		await lockCache$1.set("system-cache-lock", true, 1e4);
		await systemCache$1.clear();
		await lockCache$1.delete("system-cache-lock");
	}
	await localSchemaCache$1.clear();
	memorySchemaCache = null;
	await clearCache();
	messenger.publish("schemaChanged", { autoPurgeCache: opts?.autoPurgeCache });
}
async function setSystemCache(key, value, ttl) {
	const { systemCache: systemCache$1, lockCache: lockCache$1 } = getCache();
	if (!await lockCache$1.get("system-cache-lock")) await setCacheValue(systemCache$1, key, value, ttl);
}
async function getSystemCache(key) {
	const { systemCache: systemCache$1 } = getCache();
	return await getCacheValue(systemCache$1, key);
}
function setMemorySchemaCache(schema) {
	if (Object.isFrozen(schema)) memorySchemaCache = schema;
	else memorySchemaCache = freezeSchema(schema);
}
function getMemorySchemaCache() {
	if (env["CACHE_SCHEMA_FREEZE_ENABLED"]) return memorySchemaCache ?? void 0;
	else if (memorySchemaCache) return unfreezeSchema(memorySchemaCache);
}
async function setCacheValue(cache$1, key, value, ttl) {
	const compressed = await compress(value);
	await cache$1.set(key, compressed, ttl);
}
async function getCacheValue(cache$1, key) {
	const value = await cache$1.get(key);
	if (!value) return void 0;
	return await decompress(value);
}
/**
* Store a value in cache with its expiration timestamp for TTL tracking
*/
async function setCacheValueWithExpiry(cache$1, key, value, ttl) {
	await setCacheValue(cache$1, key, value, ttl);
	await setCacheValue(cache$1, `${key}__expires_at`, { exp: Date.now() + ttl }, ttl);
}
/**
* Get a cached value along with its remaining TTL
*/
async function getCacheValueWithTTL(cache$1, key) {
	const value = await getCacheValue(cache$1, key);
	if (!value) return void 0;
	const expiryData = await getCacheValue(cache$1, `${key}__expires_at`);
	return {
		data: value,
		remainingTTL: expiryData?.exp ? Math.max(0, expiryData.exp - Date.now()) : 0
	};
}
function getKeyvInstance(store, ttl, namespaceSuffix) {
	switch (store) {
		case "redis": return new Keyv(getConfig("redis", ttl, namespaceSuffix));
		case "memory":
		default: return new Keyv(getConfig("memory", ttl, namespaceSuffix));
	}
}
function getConfig(store = "memory", ttl, namespaceSuffix = "") {
	const config = {
		namespace: `${env["CACHE_NAMESPACE"]}${namespaceSuffix}`,
		...ttl && { ttl }
	};
	if (store === "redis") {
		const { default: KeyvRedis } = require("@keyv/redis");
		config.store = new KeyvRedis(env["REDIS"] || getConfigFromEnv("REDIS"), { useRedisSets: false });
	}
	return config;
}

//#endregion
export { clearSystemCache, flushCaches, getCache, getCacheValue, getCacheValueWithTTL, getMemorySchemaCache, getSystemCache, setCacheValue, setCacheValueWithExpiry, setMemorySchemaCache, setSystemCache };