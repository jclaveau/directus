import { useEnv } from '@directus/env';
import { ServiceUnavailableError } from '@directus/errors';
import type { CacheFlushTarget, SchemaOverview } from '@directus/types';
import Keyv, { type KeyvOptions } from 'keyv';
import { useBus } from './bus/index.js';
import { responseCacheWanted } from './cache-settings.js';
import {
	deserializeCacheEnvelope,
	serializeCacheEnvelope,
} from './cache-envelope.js';
import { useLogger } from './logger/index.js';
import { clearCache as clearPermissionCache } from './permissions/cache.js';
import { cacheRedisDatabase, redisConfigAvailable } from './redis/index.js';
import { withRedisDatabase } from './redis/lib/create-redis.js';
import {
	type ConnectionEvents,
	warnOncePerConnectionOutage,
} from './redis/lib/warn-once-per-connection-outage.js';
import {
	clearResponseCache,
	dropScopedCacheIndex,
	scopedCachePurgeEnabled,
} from './scoped-cache/index.js';
import { compress, decompress } from './utils/compress.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';
import { getMilliseconds } from './utils/get-milliseconds.js';
import { validateEnv } from './utils/validate-env.js';

import { createRequire } from 'node:module';
import { freezeSchema, unfreezeSchema } from './utils/freeze-schema.js';

const logger = useLogger();
const env = useEnv();

const require = createRequire(import.meta.url);

let cache: Keyv | null = null;
let systemCache: Keyv | null = null;
let lockCache: Keyv | null = null;
let messengerSubscribed = false;

let localSchemaCache: Keyv | null = null;
let memorySchemaCache: Readonly<SchemaOverview> | null = null;

type Store = 'memory' | 'redis';

const messenger = useBus();

interface CacheMessage {
	autoPurgeCache: boolean | undefined;
}

// The subset a flush drops, chosen per-target on the cache page. `system` rides the
// existing `schemaChanged` broadcast; `response`/`locks` are per-node memory tiers a
// dedicated channel has to reach (see `clearCacheTargets`).
interface CacheClearMessage {
	targets: CacheFlushTarget[];
}

if (redisConfigAvailable() && !messengerSubscribed) {
	messengerSubscribed = true;

	messenger.subscribe<CacheMessage>('schemaChanged', async (opts) => {
		if (env['CACHE_STORE'] === 'memory' && env['CACHE_AUTO_PURGE'] && cache && opts?.['autoPurgeCache'] !== false) {
			await cache.clear();
		}

		await localSchemaCache?.clear();
		memorySchemaCache = null;
	});

	messenger.subscribe<CacheClearMessage>('cacheCleared', async ({ targets }) => {
		// Redis-backed tiers are shared, so the initiator already cleared them globally;
		// only a per-node memory store leaves each node its own copy to drop here.
		if (env['CACHE_STORE'] !== 'memory') {
			return;
		}

		const { cache, systemCache, lockCache } = getCache();

		if (targets.includes('response')) {
			await cache?.clear();
		}

		// `schemaChanged` (from the initiator's clearSystemCache) drops each peer's
		// localSchemaCache but NOT its `_system` Keyv — so carry that clear here, else a
		// memory-store peer keeps a stale system cache after a "System cache" flush.
		if (targets.includes('system')) {
			await systemCache.clear();
		}

		if (targets.includes('locks')) {
			await lockCache.clear();
		}
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
function warnOnCacheFailure(keyv: Keyv, cacheLabel: string): void {
	const { client } = keyv.store as { client?: ConnectionEvents };

	// A memory store has no client, and fails for reasons that are not outages —
	// serialization, not connectivity — so there is nothing to collapse and nothing to
	// wait for. Every one of those is worth a line.
	if (client === undefined) {
		keyv.on('error', (error) => logger.warn(error, `[${cacheLabel}] ${error}`));
		return;
	}

	warnOncePerConnectionOutage(client, cacheLabel, keyv);
}

/**
 * Build the response tier if this node has none yet. `getCache` builds it when
 * `responseCacheWanted` says so; a write switching the cache on builds it ahead
 * of that, to clear it.
 */
export function buildResponseCache(): Keyv {
	if (cache === null) {
		validateEnv(['CACHE_NAMESPACE', 'CACHE_TTL', 'CACHE_STORE']);

		cache = getKeyvInstance(
			env['CACHE_STORE'] === 'redis'
				? 'redis'
				: 'memory',
			getMilliseconds(env['CACHE_TTL']),
			'_response',
			cacheRedisDatabase(),
		);

		warnOnCacheFailure(cache, 'response-cache');
	}

	return cache;
}

export function getCache(): {
	cache: Keyv | null;
	systemCache: Keyv;
	localSchemaCache: Keyv;
	lockCache: Keyv;
} {
	const store: Store = env['CACHE_STORE'] === 'redis'
		? 'redis'
		: 'memory';

	if (responseCacheWanted()) {
		buildResponseCache();
	}

	if (systemCache === null) {
		systemCache = getKeyvInstance(
			store,
			getMilliseconds(env['CACHE_SYSTEM_TTL']),
			'_system',
		);

		warnOnCacheFailure(systemCache, 'system-cache');
	}

	if (localSchemaCache === null) {
		localSchemaCache = getKeyvInstance('memory', getMilliseconds(env['CACHE_SYSTEM_TTL']), '_schema');
		warnOnCacheFailure(localSchemaCache, 'schema-cache');
	}

	if (lockCache === null) {
		lockCache = getKeyvInstance(store, undefined, '_lock');
		warnOnCacheFailure(lockCache, 'lock-cache');
	}

	return { cache, systemCache, localSchemaCache, lockCache };
}

const storeReadyTimeoutMs = 5000;

interface StoreClientState {
	isReady: boolean;
	once(event: 'ready', listener: () => void): unknown;
	off(event: 'ready', listener: () => void): unknown;
}

/**
 * Wait until every Redis tier can take a command. The dial `getConfig` starts
 * leaves the client open but not ready, and `disableOfflineQueue` refuses what
 * is sent in between: a `directus cache flush` process builds its tiers and
 * clears them in the same tick, so every one of its clears went out in that gap,
 * and so does a settings write switching the cache on where the environment
 * leaves it off, which builds the response tier only to clear it.
 * Waits at most `storeReadyTimeoutMs`, then lets the commands fail and be
 * reported, since a Redis that never answers is a failed flush, not a hung one.
 * A server's tiers are ready long before, so there it waits only through an
 * outage: a schema apply or a migration then takes those 5s more to fail.
 * A cluster client has no `isReady` and is not waited for.
 */
async function awaitStoresReady(tiers: (Keyv | null)[]): Promise<void> {
	const pendingClients = tiers
		.map((tier) => (tier?.store as { client?: StoreClientState })?.client)
		.filter((client): client is StoreClientState => {
			return client !== undefined && client.isReady === false;
		});

	if (pendingClients.length === 0) {
		return;
	}

	let readyTimer: NodeJS.Timeout | undefined;
	const readyListeners: [StoreClientState, () => void][] = [];

	const allReady = Promise.all(pendingClients.map((client) => {
		return new Promise<void>((resolve) => {
			readyListeners.push([client, resolve]);
			client.once('ready', resolve);
		});
	}));

	const timedOut = new Promise<boolean>((resolve) => {
		readyTimer = setTimeout(() => resolve(true), storeReadyTimeoutMs);
	});

	try {
		if (await Promise.race([allReady.then(() => false), timedOut])) {
			logger.warn(
				`[cache] redis stores not ready after ${storeReadyTimeoutMs}ms, `
				+ 'flushing anyway',
			);
		}
	}
	finally {
		clearTimeout(readyTimer);

		for (const [client, readyListener] of readyListeners) {
			client.off('ready', readyListener);
		}
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
async function storeErrorsDuring(
	tiers: (Keyv | null)[],
	flushStep: () => Promise<unknown>,
): Promise<unknown[]> {
	const heardErrors: unknown[] = [];
	const hearError = (error: unknown) => heardErrors.push(error);
	const listenedTiers = tiers.filter((tier): tier is Keyv => tier !== null);

	for (const tier of listenedTiers) {
		tier.on('error', hearError);
	}

	try {
		await flushStep();
	}
	finally {
		for (const tier of listenedTiers) {
			tier.off('error', hearError);
		}
	}

	return heardErrors;
}

/**
 * What a flush managed and what it did not. `flushCaches` stays best-effort — see
 * the comment inside — so the tiers it could not clear are reported rather than
 * thrown, and a caller that must not silently succeed (`directus cache flush`)
 * reads `failures` instead of the absence of an exception.
 */
export interface CacheFlushReport {
	durationMs: number;
	droppedIndexKeys: number;
	failures: string[];
}

export async function flushCaches(forced?: boolean): Promise<CacheFlushReport> {
	// Before `getCache`, whose first call builds the four Keyv tiers: on the boot
	// path that build is part of what the caller is waiting through, and that run is
	// the one where the number was worth reading.
	const startedAt = Date.now();
	const { cache, systemCache, lockCache } = getCache();
	const failures: string[] = [];

	await awaitStoresReady([cache, systemCache, lockCache]);

	// Best-effort, all of it. Every caller here runs AFTER the thing it is flushing
	// for already happened — a migration recorded its version, a schema diff applied,
	// a deploy changed the build identity — so nothing below can be undone by
	// failing, and a caller told "that failed" would be told it about a change that
	// landed. The tiers that cannot be dropped stay stale either way.
	//
	// Deliberately not in `clearSystemCache` itself: `clearCacheTargets` calls that
	// directly for an operator who asked for a clear, and they deserve to hear it
	// could not be done.
	try {
		// The Keyv tiers report a refused command as an event, the permission cache
		// it also clears — a `@directus/memory` multi cache wired straight to
		// ioredis — by rejecting.
		const systemErrors = await storeErrorsDuring(
			[systemCache, lockCache],
			() => clearSystemCache({ forced }),
		);

		if (systemErrors.length > 0) {
			failures.push('system cache');

			logger.warn(
				`[cache] redis refused the system cache clear: ${systemErrors[0]}`,
			);
		}
	}
	catch (error: any) {
		failures.push('system cache');
		logger.warn(error, `[cache] could not clear the system cache: ${error}`);
	}

	// Caught like the rest. Left to throw, it reaches the migration runner that
	// calls this uncaught, and it keeps the one tier the flush command exists for
	// out of the report that command reads its exit code from.
	let flushedDatabase = false;

	try {
		const responseErrors = await storeErrorsDuring([cache], async () => {
			flushedDatabase = await clearResponseCache(cache);
		});

		// A FLUSHDB goes through ioredis and leaves the Keyv tier untouched, so what
		// that tier raised meanwhile is about its connection, not about the clear.
		if (!flushedDatabase && responseErrors.length > 0) {
			failures.push('response cache');

			logger.warn(
				`[cache] redis refused the response cache clear: ${responseErrors[0]}`,
			);
		}
	}
	catch (error: any) {
		failures.push('response cache');
		logger.warn(error, `[cache] could not clear the response cache: ${error}`);
	}

	// Same reason as the `response` target in `clearCacheTargets`: the fingerprint
	// index sits in raw Redis outside the Keyv namespace, so the clear above misses
	// it. Both callers here — the migration runner and the build-identity self-heal
	// — mean "the response cache is gone", and leaving the index behind strands
	// index SETs pointing at keys that no longer exist until their `ttl*2`
	// self-expiry, or forever when `CACHE_TTL` is unset and they are deliberately
	// unbounded. A FLUSHDB already took it, with the counters the drop would move.
	//
	// Never fatal, unlike the `clearCacheTargets` call: `database/migrations/run.ts`
	// calls this right after recording the version it just applied and does not catch,
	// so a throw here fails a deploy over a cache the request path already treats as a
	// MISS while Redis is away. What is left behind self-expires, or goes with the
	// next flush that reaches Redis.
	let droppedIndexKeys = 0;

	try {
		const index = flushedDatabase
			? { dropped: 0, refused: 0 }
			: await dropScopedCacheIndex();

		droppedIndexKeys = index.dropped;

		// Redis refuses a pipelined command by answering with the error rather than
		// by throwing, so this is the only place a half-dropped index is visible.
		if (index.refused > 0) {
			failures.push('scoped-cache index');

			logger.warn(
				`[cache] redis refused ${index.refused} of the index unlink commands`,
			);
		}
	}
	catch (error: any) {
		failures.push('scoped-cache index');
		logger.warn(error, `[cache] could not drop the fingerprint index: ${error}`);
	}

	// A peer on a memory store holds its own response and system tiers, and
	// `schemaChanged` reaches neither: its handler drops the response cache only
	// under `CACHE_AUTO_PURGE`, and never touches `_system` at all. Without this
	// those nodes keep serving the reads this call exists to retire.
	try {
		await messenger.publish<CacheClearMessage>('cacheCleared', {
			targets: ['response', 'system'],
		});
	}
	catch (error: any) {
		failures.push('peer notification');
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}

	// Every caller of this is a deploy-shaped event — a migration, a schema diff, a
	// build-identity change — and on the boot path it is time the container is not
	// serving. Whether that is 20ms or 20s was not knowable from the logs
	// (https://github.com/jclaveau/directus/issues/468), so it is said here rather
	// than at each caller: one line, and the number that explains it.
	const durationMs = Date.now() - startedAt;

	// Out of scoped purging there is no index for the FLUSHDB to have taken.
	const indexFlushedNote = scopedCachePurgeEnabled()
		? ', the scoped-cache index with it'
		: '';

	const indexCleared = flushedDatabase
		? `FLUSHDB on redis db ${cacheRedisDatabase()}${indexFlushedNote}`
		: `dropped ${droppedIndexKeys} scoped-cache index keys`;

	const flushed = `[cache] flushed in ${durationMs}ms, ${indexCleared}`;

	// Under the warns naming the tiers that did not go, an info line reading
	// "flushed" answers the question they just answered, with the other answer.
	if (failures.length > 0) {
		logger.warn(`${flushed}, without ${failures.join(', ')}`);
	}
	else {
		logger.info(flushed);
	}

	return { durationMs, droppedIndexKeys, failures };
}

export async function clearSystemCache(opts?: {
	forced?: boolean | undefined;
	autoPurgeCache?: boolean | undefined;
}): Promise<void> {
	const { systemCache, localSchemaCache, lockCache } = getCache();

	// Flush system cache when forced or when system cache lock not set
	if (opts?.forced || !(await lockCache.get('system-cache-lock'))) {
		await lockCache.set('system-cache-lock', true, 10000);
		await systemCache.clear();
		await lockCache.delete('system-cache-lock');
	}

	await localSchemaCache.clear();
	memorySchemaCache = null;

	// Since a lot of cached permission function rely on the schema it needs to be cleared as well
	await clearPermissionCache();

	// Awaited so the flush that wraps this can report a lost broadcast, but never
	// fatal: the 23 callers are mutations whose write has already committed, and
	// `collections.ts` calls this from a `finally`, where a throw would replace the
	// outcome it was running after. The peers stay stale either way.
	try {
		await messenger.publish<CacheMessage>(
			'schemaChanged',
			{ autoPurgeCache: opts?.autoPurgeCache },
		);
	}
	catch (error: any) {
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}
}

/**
 * Flush a chosen subset of the cache and tell every node to drop the same subset of
 * its per-node memory tiers. A blanket flush is deliberately not the default:
 * `system` is auto-invalidated on schema change and costly to rebuild, and `locks`
 * holds the build-identity fingerprint whose loss forces a full re-flush next boot.
 */
export async function clearCacheTargets(targets: CacheFlushTarget[]): Promise<void> {
	const { cache, systemCache, lockCache } = getCache();
	const refusedTargets: CacheFlushTarget[] = [];
	let refusedIndexKeys = 0;

	await awaitStoresReady([cache, systemCache, lockCache]);

	if (targets.includes('system')) {
		// forced so it runs even while a lock is held; its `schemaChanged` publish
		// fans the system + schema + permissions clear out to every node.
		const systemErrors = await storeErrorsDuring(
			[systemCache, lockCache],
			() => clearSystemCache({ forced: true }),
		);

		if (systemErrors.length > 0) {
			refusedTargets.push('system');
		}
	}

	if (targets.includes('response')) {
		let flushedDatabase = false;

		const responseErrors = await storeErrorsDuring([cache], async () => {
			flushedDatabase = await clearResponseCache(cache);
		});

		if (!flushedDatabase && responseErrors.length > 0) {
			refusedTargets.push('response');
		}

		// The fingerprint index lives in raw Redis outside the Keyv namespace, so
		// a key-by-key clear misses it — drop it too so no orphan index members
		// linger. A FLUSHDB took it with the entries.
		if (!flushedDatabase) {
			refusedIndexKeys = (await dropScopedCacheIndex()).refused;
		}
	}

	if (targets.includes('locks')) {
		const lockErrors = await storeErrorsDuring(
			[lockCache],
			() => lockCache.clear(),
		);

		if (lockErrors.length > 0) {
			refusedTargets.push('locks');
		}
	}

	// Same reasoning as the `schemaChanged` publish above: the tiers this cleared
	// are already cleared, and an operator who asked for a flush is not served by
	// an error over the one part of it nothing can retry.
	try {
		await messenger.publish<CacheClearMessage>('cacheCleared', { targets });
	}
	catch (error: any) {
		logger.warn(error, `[cache] could not tell the other nodes: ${error}`);
	}

	// Raised only once the peers have been told, and raised at all because unlike
	// `flushCaches` this one has somebody waiting on the answer. Keyv answers a
	// refused clear with an `error` event and a resolved promise, and a pipeline
	// answers per command, so a chunk redis refused is a chunk still indexed: an
	// admin told the clear succeeded has no other way to learn it did not.
	if (refusedTargets.length > 0) {
		throw new ServiceUnavailableError({
			service: 'cache',
			reason: `redis refused the ${refusedTargets.join(', ')} clear`,
		});
	}

	if (refusedIndexKeys > 0) {
		throw new ServiceUnavailableError({
			service: 'scoped-cache index',
			reason: `redis refused ${refusedIndexKeys} of the unlink commands`,
		});
	}
}

export async function setSystemCache(key: string, value: any, ttl?: number): Promise<void> {
	const { systemCache, lockCache } = getCache();

	if (!(await lockCache.get('system-cache-lock'))) {
		await setCacheValue(systemCache, key, value, ttl);
	}
}

export async function getSystemCache(key: string): Promise<Record<string, any>> {
	const { systemCache } = getCache();

	return await getCacheValue(systemCache, key);
}

export function setMemorySchemaCache(schema: SchemaOverview) {
	if (Object.isFrozen(schema)) {
		memorySchemaCache = schema;
	}
	else {
		memorySchemaCache = freezeSchema(schema);
	}
}

export function getMemorySchemaCache(): Readonly<SchemaOverview> | undefined {
	if (env['CACHE_SCHEMA_FREEZE_ENABLED']) {
		return memorySchemaCache ?? undefined;
	}
	else if (memorySchemaCache) {
		return unfreezeSchema(memorySchemaCache);
	}

	return undefined;
}

export async function setCacheValue(
	cache: Keyv,
	key: string,
	value: Record<string, any> | Record<string, any>[],
	ttl?: number,
) {
	const compressed = await compress(value);
	await cache.set(key, compressed, ttl);
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
export async function getCacheValues(
	cache: Keyv,
	keys: string[],
): Promise<any[]> {
	const values = await cache.getMany(keys);

	return Promise.all(values.map((value) => {
		return value
			? decompress(value)
			: undefined;
	}));
}

export async function getCacheValue(cache: Keyv, key: string): Promise<any> {
	const value = await cache.get(key);

	if (!value) {
		return undefined;
	}

	const decompressed = await decompress(value);
	return decompressed;
}

function getKeyvInstance(
	store: Store,
	ttl: number | undefined,
	namespaceSuffix?: string,
	database?: number,
): Keyv {
	switch (store) {
		case 'redis':
			return new Keyv(getConfig('redis', ttl, namespaceSuffix, database));
		case 'memory':
		default:
			return new Keyv(getConfig('memory', ttl, namespaceSuffix));
	}
}

function getConfig(
	store: Store = 'memory',
	ttl: number | undefined,
	namespaceSuffix = '',
	database?: number,
): KeyvOptions {
	const config: KeyvOptions = {
		namespace: `${env['CACHE_NAMESPACE']}${namespaceSuffix}`,
		serialize: serializeCacheEnvelope,
		deserialize: deserializeCacheEnvelope,
		...(ttl && { ttl }),
	};

	if (store === 'redis') {
		const { default: KeyvRedis } = require('@keyv/redis');
		const connection = getRedisConnection(database);

		// node-redis gives a command issued while it is reconnecting no deadline at all:
		// `sendCommand` rejects only when the client is closed or when this flag is set,
		// and its default reconnect strategy retries forever. `KeyvRedis.getClient()`
		// does not help either — it returns early while `isOpen` is true, so its
		// `connectionTimeout` guards the first connect and nothing after it. A cached
		// read during an outage therefore never settled, and the request that made it
		// blocked for as long as Redis was away instead of missing.
		//
		// Rejecting instead is the behaviour the rest of the stack already expects:
		// `@keyv/redis` swallows the rejection into `undefined`, which is exactly the
		// MISS the response cache serves when it has nothing. Losing Redis costs hit
		// ratio again, rather than availability.
		//
		// Passing options rather than the URL string also settles which reconnect
		// strategy applies. `KeyvRedis` installs its own only on the string form, so a
		// `REDIS` url and a `REDIS_HOST`/`REDIS_PORT` pair used to back off differently
		// (2^n*100ms vs 2^n*50ms, both capped at 2s). Both now use node-redis's.
		const clientOptions = typeof connection === 'string'
			? { url: connection }
			: connection;

		const keyvRedis = new KeyvRedis({ ...clientOptions, disableOfflineQueue: true });

		// Dialed now rather than by the first command. `getClient()` hands the client
		// over as soon as it is open, and node-redis is open from the moment it starts
		// dialing — so of two commands a fresh worker sent at once, the second went
		// out while the first was still connecting and was refused as offline (the
		// queue above). A purge was that second command on the PR-736 preview, and
		// was recorded for retry over a Redis that was never away. A dial that fails
		// reports through the `error` the adapter forwards, like any later one.
		void keyvRedis.getClient().catch(() => {});

		config.store = keyvRedis;
	}

	return config;
}

// @keyv/redis v5 is node-redis based: it accepts a URL string or node-redis RedisClientOptions
// ({ socket: { host, port }, … }), not ioredis's flat { host, port }. env['REDIS'] is already a URL;
// otherwise translate the REDIS_* (ioredis-shaped) config into node-redis options so a host/port
// setup actually connects (a flat { host, port } silently falls back to localhost:6379 under v5).
// Advanced setups (sentinel/cluster, cert-based TLS) should use the REDIS connection URL.
export function getRedisConnection(
	database?: number,
): string | Record<string, unknown> {
	const configuredUrl = env['REDIS'] as string | undefined;

	const url = configuredUrl && database !== undefined
		? withRedisDatabase(configuredUrl, database)
		: configuredUrl;

	// node-redis defaults its socket `keepAlive` to 5000ms → a TCP keepalive probe every 5s on the
	// persistent cache connection. That outbound traffic blocks Railway App-Sleeping on an otherwise-idle
	// preview. `REDIS_KEEP_ALIVE=false` disables the probe; a large ms value spaces it past the sleep
	// window. Unset → node-redis's 5000ms default is preserved untouched (prod is unaffected).
	const keepAlive = env['REDIS_KEEP_ALIVE'] as number | boolean | undefined;

	if (url) {
		if (keepAlive === undefined) {
			return url;
		}

		return { url, socket: { keepAlive } };
	}

	const { host, port, username, password, db, tls } = getConfigFromEnv('REDIS') as Record<string, any>;

	return {
		socket: {
			host,
			...(port !== undefined && { port: Number(port) }),
			...(tls && { tls: true }),
			...(keepAlive !== undefined && { keepAlive }),
		},
		...(username !== undefined && { username }),
		...(password !== undefined && { password }),
		...(db !== undefined && { database: Number(db) }),
		...(database !== undefined && { database }),
	};
}
