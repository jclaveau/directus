import { getMilliseconds } from "./utils/get-milliseconds.js";
import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { useLogger } from "./logger/index.js";
import { warnOncePerConnectionOutage } from "./redis/lib/warn-once-per-connection-outage.js";
import { redisConfigAvailable } from "./redis/utils/redis-config-available.js";
import "./redis/index.js";
import { useBus } from "./bus/lib/use-bus.js";
import "./bus/index.js";
import { clearCache } from "./permissions/cache.js";
import { validateEnv } from "./utils/validate-env.js";
import { dropScopedCacheIndex } from "./scoped-cache.js";
import { compress, decompress } from "./utils/compress.js";
import { freezeSchema, unfreezeSchema } from "./utils/freeze-schema.js";
import { createRequire } from "node:module";
import { useEnv } from "@directus/env";
import { ServiceUnavailableError } from "@directus/errors";
import Keyv from "keyv";

//#region src/cache.ts
const logger = useLogger();
const env = useEnv();
const require = createRequire(import.meta.url);
let cache = null;
let systemCache = null;
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
	messenger.subscribe("cacheCleared", async ({ targets }) => {
		if (env["CACHE_STORE"] !== "memory") return;
		const { cache: cache$1, systemCache: systemCache$1, lockCache: lockCache$1 } = getCache();
		if (targets.includes("response")) await cache$1?.clear();
		if (targets.includes("system")) await systemCache$1.clear();
		if (targets.includes("locks")) await lockCache$1.clear();
	});
}
/**
* Report what goes wrong with one cache, under that cache's own name.
*
* Two things have to be heard from, and neither is a matter of survival: the
* adapter registers an `error` listener on its client from its own constructor and
* forwards what it hears, so the connection is never unlistened and the handlers
* this replaced already saw connection failures. What was missing is a line worth
* reading. The client reports the outage; the store reports what its own commands
* hit, which since `disableOfflineQueue` is one error per refused command — a log
* that grows with traffic rather than with the outage.
*
* Both are the same failure, so both go under one label and share one throttle.
* Attached here rather than where the client is built, because a shared label
* across the four caches names none of them, and this is where the names live.
* Nothing has connected yet at this point: node-redis dials on its first command.
*/
function warnOnCacheFailure(keyv, cacheLabel) {
	const { client } = keyv.store;
	if (client === void 0) {
		keyv.on("error", (error) => logger.warn(error, `[${cacheLabel}] ${error}`));
		return;
	}
	warnOncePerConnectionOutage(client, cacheLabel, keyv);
}
function getCache() {
	const store = env["CACHE_STORE"] === "redis" ? "redis" : "memory";
	if (env["CACHE_ENABLED"] === true && cache === null) {
		validateEnv([
			"CACHE_NAMESPACE",
			"CACHE_TTL",
			"CACHE_STORE"
		]);
		cache = getKeyvInstance(store, getMilliseconds(env["CACHE_TTL"]), "_response");
		warnOnCacheFailure(cache, "response-cache");
	}
	if (systemCache === null) {
		systemCache = getKeyvInstance(store, getMilliseconds(env["CACHE_SYSTEM_TTL"]), "_system");
		warnOnCacheFailure(systemCache, "system-cache");
	}
	if (localSchemaCache === null) {
		localSchemaCache = getKeyvInstance("memory", getMilliseconds(env["CACHE_SYSTEM_TTL"]), "_schema");
		warnOnCacheFailure(localSchemaCache, "schema-cache");
	}
	if (lockCache === null) {
		lockCache = getKeyvInstance(store, void 0, "_lock");
		warnOnCacheFailure(lockCache, "lock-cache");
	}
	return {
		cache,
		systemCache,
		localSchemaCache,
		lockCache
	};
}
async function flushCaches(forced) {
	const startedAt = Date.now();
	const { cache: cache$1 } = getCache();
	const failures = [];
	try {
		await clearSystemCache({ forced });
	} catch (error) {
		failures.push("system cache");
		logger.warn(error, `[cache] could not clear the system cache: ${error}`);
	}
	try {
		await cache$1?.clear();
	} catch (error) {
		failures.push("response cache");
		logger.warn(error, `[cache] could not clear the response cache: ${error}`);
	}
	let droppedIndexKeys = 0;
	try {
		const index = await dropScopedCacheIndex();
		droppedIndexKeys = index.dropped;
		if (index.refused > 0) {
			failures.push("scoped-cache index");
			logger.warn(`[cache] redis refused ${index.refused} of the index unlink commands`);
		}
	} catch (error) {
		failures.push("scoped-cache index");
		logger.warn(error, `[cache] could not drop the scoped-tag index: ${error}`);
	}
	try {
		await messenger.publish("cacheCleared", { targets: ["response", "system"] });
	} catch (error) {
		failures.push("peer notification");
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}
	const durationMs = Date.now() - startedAt;
	const flushed = `[cache] flushed in ${durationMs}ms, dropped ${droppedIndexKeys} scoped-cache index keys`;
	if (failures.length > 0) logger.warn(`${flushed}, without ${failures.join(", ")}`);
	else logger.info(flushed);
	return {
		durationMs,
		droppedIndexKeys,
		failures
	};
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
	try {
		await messenger.publish("schemaChanged", { autoPurgeCache: opts?.autoPurgeCache });
	} catch (error) {
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}
}
/**
* Flush a chosen subset of the cache and tell every node to drop the same subset of
* its per-node memory tiers. A blanket flush is deliberately not the default:
* `system` is auto-invalidated on schema change and costly to rebuild, and `locks`
* holds the build-identity fingerprint whose loss forces a full re-flush next boot.
*/
async function clearCacheTargets(targets) {
	const { cache: cache$1, lockCache: lockCache$1 } = getCache();
	let refusedIndexKeys = 0;
	if (targets.includes("system")) await clearSystemCache({ forced: true });
	if (targets.includes("response")) {
		await cache$1?.clear();
		refusedIndexKeys = (await dropScopedCacheIndex()).refused;
	}
	if (targets.includes("locks")) await lockCache$1.clear();
	try {
		await messenger.publish("cacheCleared", { targets });
	} catch (error) {
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}
	if (refusedIndexKeys > 0) throw new ServiceUnavailableError({
		service: "scoped-cache index",
		reason: `redis refused ${refusedIndexKeys} of the unlink commands`
	});
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
	if (!value) return;
	return await decompress(value);
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
		const connection = getRedisConnection();
		config.store = new KeyvRedis({
			...typeof connection === "string" ? { url: connection } : connection,
			disableOfflineQueue: true
		});
	}
	return config;
}
function getRedisConnection() {
	const url = env["REDIS"];
	const keepAlive = env["REDIS_KEEP_ALIVE"];
	if (url) {
		if (keepAlive === void 0) return url;
		return {
			url,
			socket: { keepAlive }
		};
	}
	const { host, port, username, password, db, tls } = getConfigFromEnv("REDIS");
	return {
		socket: {
			host,
			...port !== void 0 && { port: Number(port) },
			...tls && { tls: true },
			...keepAlive !== void 0 && { keepAlive }
		},
		...username !== void 0 && { username },
		...password !== void 0 && { password },
		...db !== void 0 && { database: Number(db) }
	};
}

//#endregion
export { clearCacheTargets, clearSystemCache, flushCaches, getCache, getCacheValue, getMemorySchemaCache, getRedisConnection, getSystemCache, setCacheValue, setMemorySchemaCache, setSystemCache };