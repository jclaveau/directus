import { getMilliseconds } from "./utils/get-milliseconds.js";
import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { useLogger } from "./logger/index.js";
import { warnOncePerConnectionOutage } from "./redis/lib/warn-once-per-connection-outage.js";
import { withRedisDatabase } from "./redis/lib/create-redis.js";
import { cacheRedisDatabase } from "./redis/lib/use-cache-redis.js";
import { redisConfigAvailable } from "./redis/utils/redis-config-available.js";
import "./redis/index.js";
import { useBus } from "./bus/lib/use-bus.js";
import "./bus/index.js";
import { deserializeCacheEnvelope, serializeCacheEnvelope } from "./cache-envelope.js";
import { clearCache } from "./permissions/cache.js";
import { scopedCachePurgeEnabled } from "./scoped-cache/config.js";
import { validateEnv } from "./utils/validate-env.js";
import { clearResponseCache, dropScopedCacheIndex } from "./scoped-cache/purge.js";
import "./scoped-cache/index.js";
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
		cache = getKeyvInstance(store, getMilliseconds(env["CACHE_TTL"]), "_response", cacheRedisDatabase());
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
const storeReadyTimeoutMs = 5e3;
/**
* Wait until every Redis tier can take a command. The dial `getConfig` starts
* leaves the client open but not ready, and `disableOfflineQueue` refuses what
* is sent in between: a `directus cache flush` process builds its tiers and
* clears them in the same tick, so every one of its clears went out in that gap.
* Waits at most `storeReadyTimeoutMs`, then lets the commands fail and be
* reported, since a Redis that never answers is a failed flush, not a hung one.
* A server's tiers are ready long before, so there it waits only through an
* outage: a schema apply or a migration then takes those 5s more to fail.
* A cluster client has no `isReady` and is not waited for.
*/
async function awaitStoresReady(tiers) {
	const pendingClients = tiers.map((tier) => (tier?.store)?.client).filter((client) => {
		return client !== void 0 && client.isReady === false;
	});
	if (pendingClients.length === 0) return;
	let readyTimer;
	const readyListeners = [];
	const allReady = Promise.all(pendingClients.map((client) => {
		return new Promise((resolve) => {
			readyListeners.push([client, resolve]);
			client.once("ready", resolve);
		});
	}));
	const timedOut = new Promise((resolve) => {
		readyTimer = setTimeout(() => resolve(true), storeReadyTimeoutMs);
	});
	try {
		if (await Promise.race([allReady.then(() => false), timedOut])) logger.warn(`[cache] redis stores not ready after ${storeReadyTimeoutMs}ms, flushing anyway`);
	} finally {
		clearTimeout(readyTimer);
		for (const [client, readyListener] of readyListeners) client.off("ready", readyListener);
	}
}
/**
* The errors the tiers raised while `flushStep` ran. Keyv answers a refused
* command with an `error` event and a resolved promise, and `@keyv/redis`
* swallows a failed `clear()` whatever `throwOnErrors` says, so listening while
* the step runs is the only way to learn a tier did not clear. In a server, a
* request's refused command on the same tier lands here too and counts against
* the clear: a false alarm needs Redis to refuse that command and take the
* clear sent beside it.
*/
async function storeErrorsDuring(tiers, flushStep) {
	const heardErrors = [];
	const hearError = (error) => heardErrors.push(error);
	const listenedTiers = tiers.filter((tier) => tier !== null);
	for (const tier of listenedTiers) tier.on("error", hearError);
	try {
		await flushStep();
	} finally {
		for (const tier of listenedTiers) tier.off("error", hearError);
	}
	return heardErrors;
}
async function flushCaches(forced) {
	const startedAt = Date.now();
	const { cache: cache$1, systemCache: systemCache$1, lockCache: lockCache$1 } = getCache();
	const failures = [];
	await awaitStoresReady([
		cache$1,
		systemCache$1,
		lockCache$1
	]);
	try {
		const systemErrors = await storeErrorsDuring([systemCache$1, lockCache$1], () => clearSystemCache({ forced }));
		if (systemErrors.length > 0) {
			failures.push("system cache");
			logger.warn(`[cache] redis refused the system cache clear: ${systemErrors[0]}`);
		}
	} catch (error) {
		failures.push("system cache");
		logger.warn(error, `[cache] could not clear the system cache: ${error}`);
	}
	let flushedDatabase = false;
	try {
		const responseErrors = await storeErrorsDuring([cache$1], async () => {
			flushedDatabase = await clearResponseCache(cache$1);
		});
		if (!flushedDatabase && responseErrors.length > 0) {
			failures.push("response cache");
			logger.warn(`[cache] redis refused the response cache clear: ${responseErrors[0]}`);
		}
	} catch (error) {
		failures.push("response cache");
		logger.warn(error, `[cache] could not clear the response cache: ${error}`);
	}
	let droppedIndexKeys = 0;
	try {
		const index = flushedDatabase ? {
			dropped: 0,
			refused: 0
		} : await dropScopedCacheIndex();
		droppedIndexKeys = index.dropped;
		if (index.refused > 0) {
			failures.push("scoped-cache index");
			logger.warn(`[cache] redis refused ${index.refused} of the index unlink commands`);
		}
	} catch (error) {
		failures.push("scoped-cache index");
		logger.warn(error, `[cache] could not drop the fingerprint index: ${error}`);
	}
	try {
		await messenger.publish("cacheCleared", { targets: ["response", "system"] });
	} catch (error) {
		failures.push("peer notification");
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}
	const durationMs = Date.now() - startedAt;
	const indexFlushedNote = scopedCachePurgeEnabled() ? ", the scoped-cache index with it" : "";
	const flushed = `[cache] flushed in ${durationMs}ms, ${flushedDatabase ? `FLUSHDB on redis db ${cacheRedisDatabase()}${indexFlushedNote}` : `dropped ${droppedIndexKeys} scoped-cache index keys`}`;
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
	const { cache: cache$1, systemCache: systemCache$1, lockCache: lockCache$1 } = getCache();
	const refusedTargets = [];
	let refusedIndexKeys = 0;
	if (targets.includes("system")) {
		if ((await storeErrorsDuring([systemCache$1, lockCache$1], () => clearSystemCache({ forced: true }))).length > 0) refusedTargets.push("system");
	}
	if (targets.includes("response")) {
		let flushedDatabase = false;
		const responseErrors = await storeErrorsDuring([cache$1], async () => {
			flushedDatabase = await clearResponseCache(cache$1);
		});
		if (!flushedDatabase && responseErrors.length > 0) refusedTargets.push("response");
		if (!flushedDatabase) refusedIndexKeys = (await dropScopedCacheIndex()).refused;
	}
	if (targets.includes("locks")) {
		if ((await storeErrorsDuring([lockCache$1], () => lockCache$1.clear())).length > 0) refusedTargets.push("locks");
	}
	try {
		await messenger.publish("cacheCleared", { targets });
	} catch (error) {
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}
	if (refusedTargets.length > 0) throw new ServiceUnavailableError({
		service: "cache",
		reason: `redis refused the ${refusedTargets.join(", ")} clear`
	});
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
/**
* Read several entries in one round trip.
*
* The response cache never reads a payload without also reading the sidecar it is
* stored beside, and awaiting them in turn cost two round trips on every HIT —
* which on a redis that is a network hop is the whole of what serving from cache
* saves. `@keyv/redis` answers this with one MGET.
*
* A key the store has nothing for comes back `undefined`, in its own position: the
* caller tells a missing payload from a missing sidecar by index, as it did when
* the two were separate reads.
*/
async function getCacheValues(cache$1, keys) {
	const values = await cache$1.getMany(keys);
	return Promise.all(values.map((value) => {
		return value ? decompress(value) : void 0;
	}));
}
async function getCacheValue(cache$1, key) {
	const value = await cache$1.get(key);
	if (!value) return;
	return await decompress(value);
}
function getKeyvInstance(store, ttl, namespaceSuffix, database) {
	switch (store) {
		case "redis": return new Keyv(getConfig("redis", ttl, namespaceSuffix, database));
		case "memory":
		default: return new Keyv(getConfig("memory", ttl, namespaceSuffix));
	}
}
function getConfig(store = "memory", ttl, namespaceSuffix = "", database) {
	const config = {
		namespace: `${env["CACHE_NAMESPACE"]}${namespaceSuffix}`,
		serialize: serializeCacheEnvelope,
		deserialize: deserializeCacheEnvelope,
		...ttl && { ttl }
	};
	if (store === "redis") {
		const { default: KeyvRedis } = require("@keyv/redis");
		const connection = getRedisConnection(database);
		const keyvRedis = new KeyvRedis({
			...typeof connection === "string" ? { url: connection } : connection,
			disableOfflineQueue: true
		});
		keyvRedis.getClient().catch(() => {});
		config.store = keyvRedis;
	}
	return config;
}
function getRedisConnection(database) {
	const configuredUrl = env["REDIS"];
	const url = configuredUrl && database !== void 0 ? withRedisDatabase(configuredUrl, database) : configuredUrl;
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
		...db !== void 0 && { database: Number(db) },
		...database !== void 0 && { database }
	};
}

//#endregion
export { clearCacheTargets, clearSystemCache, flushCaches, getCache, getCacheValue, getCacheValues, getMemorySchemaCache, getRedisConnection, getSystemCache, setCacheValue, setMemorySchemaCache, setSystemCache };