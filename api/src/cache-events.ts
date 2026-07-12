import { useEnv } from '@directus/env';
import { parse as parseBytes } from 'bytes';
import type { Knex } from 'knex';
import type Keyv from 'keyv';
import { useBus } from './bus/index.js';
import getDatabase from './database/index.js';
import { useLogger } from './logger/index.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

/**
 * Cache telemetry buffered in a Redis Stream and drained to two PG tables so a
 * hit/miss never touches the DB on the hot path:
 *
 *   - `directus_cache_events` — lean fact, one row per hit/miss: cache key +
 *     age-at-hit (shorten signal), gap-since-expiry (lengthen signal, from a
 *     tombstone), effective TTL. Timescale hypertable + retention where present;
 *     a daily app-level reap (CACHE_STATS_RETENTION) bounds it on every dialect.
 *   - `directus_cache_descriptors` — dimension, one row per key: the request
 *     descriptor (method/path/collection/user/query/url/size), upserted on fill.
 *
 * Three stream kinds: `h` hit (cache.ts), `m` miss (cache.ts), `d` descriptor
 * (respond.ts fill, where the descriptor is fully populated). The flusher demuxes
 * them into the two tables. Capture is gated by a runtime flag refreshed from
 * Redis, killable live by an admin or the size/buffer watchdog.
 */

export interface CacheHitCapture {
	cacheKey: string;
	ageMs: number;
	ttlMs: number | null;
	durationMs: number | null;
}

export interface CacheMissCapture {
	cacheKey: string;
	gapMs: number | null;
	ttlMs: number | null;
}

export interface CacheDescriptor {
	cacheKey: string;
	method: string;
	path: string;
	collection: string | null;
	userId: string | null;
	query: string;
	url: string;
	bytes: number;
	fillMs: number;
}

// A silent cache anomaly (not cached, cached-but-untracked, degraded scope, or a
// Redis error) surfaced on the dashboard rather than dropped.
export type CacheAnomalyReason =
	| 'key_too_long'
	| 'scoped_orphan'
	| 'value_too_large'
	| 'redis_error'
	| 'coarse_scope';

export interface CacheAnomalyCapture {
	reason: CacheAnomalyReason;
	path: string;
	collection?: string | null;
	method?: string | null;
	keyLength?: number | null; // key_too_long: the untrackable key's length
	detail?: string | null; // key preview / byte size / error message
}

// One grouped anomaly row for the admin page: reason+path with an occurrence count.
export interface CacheAnomalyRecord {
	reason: CacheAnomalyReason;
	path: string;
	collection: string | null;
	method: string | null;
	count: number;
	maxKeyLength: number | null;
	sample: string | null;
	lastSeen: number;
}

export interface CacheEntryRecord {
	key: string;
	method: string;
	path: string;
	collection: string | null;
	user: { id: string; email: string | null } | null;
	query: string;
	url: string;
	size: number;
	hits: number;
	fillMs: number | null;
	hitMs: number | null;
	ttlMs: number | null;
	recommendedTtlMs: number | null;
	createdAt: number;
	expiresAt: number | null;
	lastHitAt: number | null;
}

export interface CacheStatsState {
	configured: boolean;
	enabled: boolean;
	killedReason: string | null;
	bufferLength: number;
}

const STREAM_HARD_CAP = 1_000_000;

// The stats-table cache_key is varchar(255). The default hashed key is ~40 hex, but
// a readable key (CACHE_KEY_HASH_ENABLED=false) can exceed it and would throw on
// insert — wedging the flush. Skip an untrackable key rather than truncate it (a
// truncated key would collide in the descriptor primary key).
const MAX_CACHE_KEY_LENGTH = 255;

function isKeyTrackable(key: string): boolean {
	return key.length <= MAX_CACHE_KEY_LENGTH;
}

const FLUSH_BATCH = 500;
const DEFAULT_GAP_LOOKBACK = getMilliseconds('1h', 3_600_000);

// The admin listing groups recent activity; older keys are reaped, not shown.
const LISTING_WINDOW = getMilliseconds('24h', 86_400_000);
const LISTING_LIMIT = 200;

// A descriptor with no fill in this window AND no live event is an orphan (past
// a Directus upgrade, or a query combo that stopped being requested).
const DESCRIPTOR_REAP_AFTER = getMilliseconds('90d', 7_776_000_000);

// Fallback event-retention window if CACHE_STATS_RETENTION is unset/unparsable.
const DEFAULT_RETENTION = getMilliseconds('30d', 2_592_000_000);

// A hot uncached path emits an anomaly per request; throttle to one sample per
// reason+path per minute so anomalies can't crowd out hit/miss telemetry.
const ANOMALY_THROTTLE_MS = getMilliseconds('1m', 60_000);

// Refreshed from Redis so a live toggle/autokill flips capture without a
// restart. Seeded false; the schedule primes it before the first request.
let cacheStatsActiveFlag = false;
let isTimescaleCache: boolean | null = null;

// Single-flight latch for the drain (see flushCacheEvents).
let flushInProgress = false;

function statsNamespace(): string {
	return `${useEnv()['CACHE_NAMESPACE']}:stats`;
}

const streamKey = () => `${statsNamespace()}:events`;
const flagKey = () => `${statsNamespace()}:enabled`;
const reasonKey = () => `${statsNamespace()}:killed_reason`;
const tombstoneKey = (key: string) => `${statsNamespace()}:tomb:${key}`;

const anomalyThrottleKey = (reason: string, path: string) =>
	`${statsNamespace()}:anom:${reason}:${path}`;

/**
 * Master switch: opt-in (CACHE_STATS_ENABLED, default off) AND Redis reachable
 * (buffer + flag live there). The runtime flag can only narrow this, never widen.
 */
export function cacheStatsConfigured(): boolean {
	return useEnv()['CACHE_STATS_ENABLED'] === true && redisConfigAvailable();
}

// Hot-path gate — a plain module read, no Redis round-trip per request.
export function cacheStatsActive(): boolean {
	return cacheStatsActiveFlag;
}

function gapLookbackMs(): number {
	const configured = useEnv()['CACHE_STATS_GAP_LOOKBACK'];
	return getMilliseconds(configured, DEFAULT_GAP_LOOKBACK);
}

function retentionMs(): number {
	return getMilliseconds(useEnv()['CACHE_STATS_RETENTION'], DEFAULT_RETENTION);
}

/**
 * Re-read the runtime override into the in-process flag. Called on a short
 * per-instance interval so a toggle/autokill anywhere propagates within a tick.
 */
export async function refreshCacheStatsFlag(): Promise<void> {
	if (!cacheStatsConfigured()) {
		cacheStatsActiveFlag = false;
		return;
	}

	const override = await useRedis().get(flagKey());

	cacheStatsActiveFlag = override === null
		? true
		: override === '1';
}

async function xadd(fields: Record<string, string>): Promise<void> {
	const flat: string[] = [];

	for (const [field, value] of Object.entries(fields)) {
		flat.push(field, value);
	}

	// MAXLEN ~ is a hard backstop on Redis memory even before the soft autokill.
	// .call() over typed xadd() — the field spread trips its overloads.
	await useRedis().call(
		'XADD',
		streamKey(),
		'MAXLEN',
		'~',
		String(STREAM_HARD_CAP),
		'*',
		...flat,
	);
}

export async function captureCacheHit(hit: CacheHitCapture): Promise<void> {
	if (!cacheStatsActiveFlag || !isKeyTrackable(hit.cacheKey)) {
		return;
	}

	await xadd({
		kind: 'h',
		cacheKey: hit.cacheKey,
		ageMs: String(hit.ageMs),
		ttlMs: hit.ttlMs === null
			? ''
			: String(hit.ttlMs),
		durationMs: hit.durationMs === null
			? ''
			: String(hit.durationMs),
		ts: String(Date.now()),
	});
}

export async function captureCacheMiss(miss: CacheMissCapture): Promise<void> {
	if (!cacheStatsActiveFlag || !isKeyTrackable(miss.cacheKey)) {
		return;
	}

	await xadd({
		kind: 'm',
		cacheKey: miss.cacheKey,
		gapMs: miss.gapMs === null
			? ''
			: String(miss.gapMs),
		ttlMs: miss.ttlMs === null
			? ''
			: String(miss.ttlMs),
		ts: String(Date.now()),
	});
}

// Emit a throttled anomaly sample. One row per reason+path per window (SET NX):
// the first occurrence claims the slot; the rest no-op until it expires.
export async function captureCacheAnomaly(entry: CacheAnomalyCapture): Promise<void> {
	if (!cacheStatsActiveFlag) {
		return;
	}

	const claimed = await useRedis().set(
		anomalyThrottleKey(entry.reason, entry.path),
		'1',
		'PX',
		ANOMALY_THROTTLE_MS,
		'NX',
	);

	if (claimed === null) {
		return;
	}

	await xadd({
		kind: 'a',
		reason: entry.reason,
		path: entry.path,
		collection: entry.collection ?? '',
		method: entry.method ?? '',
		keyLength: entry.keyLength == null
			? ''
			: String(entry.keyLength),
		detail: entry.detail ?? '',
		ts: String(Date.now()),
	});
}

// The per-key descriptor, emitted on a fill where every field is populated.
export async function captureCacheDescriptor(entry: CacheDescriptor): Promise<void> {
	if (!cacheStatsActiveFlag) {
		return;
	}

	// A key past the 255-char column can't be a descriptor, but the response WAS
	// cached (the SET has no cap) — record the lost visibility, don't drop it.
	if (!isKeyTrackable(entry.cacheKey)) {
		await captureCacheAnomaly({
			reason: 'key_too_long',
			path: entry.path,
			collection: entry.collection,
			method: entry.method,
			keyLength: entry.cacheKey.length,
			detail: entry.cacheKey.slice(0, 255),
		});

		return;
	}

	await xadd({
		kind: 'd',
		cacheKey: entry.cacheKey,
		method: entry.method,
		path: entry.path,
		collection: entry.collection ?? '',
		userId: entry.userId ?? '',
		query: entry.query,
		url: entry.url,
		bytes: String(entry.bytes),
		fillMs: String(entry.fillMs),
		ts: String(Date.now()),
	});
}

/**
 * Drop a tombstone that outlives the cached entry: a re-request arriving after
 * the value expired can still read `expiredAt` and see how far past it came.
 *
 * TTL = the entry's remaining life + the gap lookback, so the tombstone lives
 * until `expiry + lookback`. Keying only off the lookback (measured from fill)
 * would kill it before a long-TTL entry even expires — losing the lengthen
 * signal for exactly the entries the recommendation targets.
 */
export async function writeCacheTombstone(
	key: string,
	expiredAt: number,
): Promise<void> {
	if (!cacheStatsActiveFlag || !isKeyTrackable(key)) {
		return;
	}

	const remainingLifeMs = Math.max(expiredAt - Date.now(), 0);

	await useRedis().set(
		tombstoneKey(key),
		String(expiredAt),
		'PX',
		remainingLifeMs + gapLookbackMs(),
	);
}

// Gap since the entry expired, or null for a cold miss (no tombstone).
export async function readCacheMissGap(
	key: string,
	now: number,
): Promise<number | null> {
	const stored = await useRedis().get(tombstoneKey(key));

	if (stored === null) {
		return null;
	}

	return Math.max(now - Number(stored), 0);
}

// The expiry timestamp a live tombstone holds (when the key last expired), or
// null if none — for the admin drawer's per-key inspection.
export async function readCacheTombstone(key: string): Promise<number | null> {
	if (!redisConfigAvailable()) {
		return null;
	}

	const stored = await useRedis().get(tombstoneKey(key));

	return stored === null
		? null
		: Number(stored);
}

interface CacheEventRow {
	time: Date;
	cache_key: string;
	kind: number;
	age_ms: number | null;
	gap_ms: number | null;
	ttl_ms: number | null;
	duration_ms: number | null;
}

interface CacheDescriptorRow {
	cache_key: string;
	method: string;
	path: string;
	collection: string | null;
	user_id: string | null;
	query: string;
	url: string;
	bytes: number;
	fill_ms: number;
	last_filled: Date;
}

interface CacheAnomalyRow {
	time: Date;
	reason: string;
	path: string;
	collection: string | null;
	method: string | null;
	key_length: number | null;
	detail: string;
}

function parseFields(flat: string[]): Record<string, string> {
	const fields: Record<string, string> = {};

	for (let i = 0; i < flat.length; i += 2) {
		fields[flat[i]!] = flat[i + 1]!;
	}

	return fields;
}

function num(value: string | undefined): number | null {
	return value === undefined || value === ''
		? null
		: Number(value);
}

/**
 * Drain the buffered stream, demuxing each entry into the fact table (hits/misses)
 * or upserting the dimension (descriptors), then deleting the batch. One node.
 *
 * At-least-once: a crash between the insert and the XDEL re-runs a batch. Descriptor
 * upserts are idempotent, but duplicate fact rows DO inflate the hit COUNT for that
 * one batch — a bounded, telemetry-only skew we accept over the at-most-once
 * alternative (XDEL-before-insert would silently drop a batch on the same crash).
 *
 * A deterministically-unpersistable batch is the one exception: it's dropped (XDEL
 * after a logged warning) rather than retried, so one poison batch can't wedge the
 * whole drain.
 */
// Real queries waiting on a pool connection = the DB is the bottleneck. The
// flush draws from the same shared pool, so when callers are queued it backs off
// and leaves the batch buffered in the Redis stream (MAXLEN absorbs it) rather
// than stealing a connection from a live request. Not the event-loop pressure
// limiter (@directus/pressure) — that's the wrong signal for pool draw.
function dbPoolSaturated(db: Knex): boolean {
	const pool = db.client.pool;
	return (pool?.numPendingAcquires?.() ?? 0) > 0;
}

/**
 * Guarded entrypoint for the drain. node-schedule fires the flush every 10s with
 * no overlap guard, so a drain that outruns its interval would run concurrently
 * with the next tick — both XRANGE the same head batch and double-count it. A
 * process-local latch (JS is single-threaded) makes an overlapping tick a no-op;
 * the multi-node case is handled by scheduleSynchronizedJob picking one node.
 */
export async function flushCacheEvents(): Promise<number> {
	if (!cacheStatsConfigured() || flushInProgress) {
		return 0;
	}

	flushInProgress = true;

	try {
		return await drainCacheEvents();
	}
	finally {
		flushInProgress = false;
	}
}

async function drainCacheEvents(): Promise<number> {
	const redis = useRedis();
	const db = getDatabase();
	let drained = 0;

	for (;;) {
		// Yield to live traffic: with queued acquirers, stop draining and leave the
		// rest buffered for the next tick rather than contending for a connection.
		if (dbPoolSaturated(db)) {
			break;
		}

		const batch = (await redis.call(
			'XRANGE',
			streamKey(),
			'-',
			'+',
			'COUNT',
			String(FLUSH_BATCH),
		)) as [string, string[]][];

		if (batch.length === 0) {
			break;
		}

		const ids = batch.map(([id]) => id);
		const events: CacheEventRow[] = [];
		const descriptors = new Map<string, CacheDescriptorRow>();
		const anomalies: CacheAnomalyRow[] = [];

		for (const [, flat] of batch) {
			const f = parseFields(flat);
			const at = new Date(Number(f['ts']));

			if (f['kind'] === 'a') {
				anomalies.push({
					time: at,
					reason: f['reason'] ?? '',
					path: f['path'] ?? '',
					collection: f['collection']
						? f['collection']
						: null,
					method: f['method']
						? f['method']
						: null,
					key_length: f['keyLength']
						? Number(f['keyLength'])
						: null,
					detail: f['detail'] ?? '',
				});

				continue;
			}

			if (f['kind'] === 'd') {
				// Last write in the batch wins — a re-conflicting insert would throw.
				descriptors.set(f['cacheKey']!, {
					cache_key: f['cacheKey']!,
					method: f['method'] ?? '',
					path: f['path'] ?? '',
					collection: f['collection']
						? f['collection']
						: null,
					user_id: f['userId']
						? f['userId']
						: null,
					query: f['query'] ?? '',
					url: f['url'] ?? '',
					bytes: Number(f['bytes'] ?? 0),
					fill_ms: Number(f['fillMs'] ?? 0),
					last_filled: at,
				});

				continue;
			}

			events.push({
				time: at,
				cache_key: f['cacheKey']!,
				kind: f['kind'] === 'h'
					? 0
					: 1,
				age_ms: num(f['ageMs']),
				gap_ms: num(f['gapMs']),
				ttl_ms: num(f['ttlMs']),
				duration_ms: num(f['durationMs']),
			});
		}

		try {
			if (events.length > 0) {
				await db.batchInsert('directus_cache_events', events, FLUSH_BATCH);
			}

			if (descriptors.size > 0) {
				await db('directus_cache_descriptors')
					.insert([...descriptors.values()])
					.onConflict('cache_key')
					.merge();
			}

			if (anomalies.length > 0) {
				await db.batchInsert('directus_cache_anomalies', anomalies, FLUSH_BATCH);
			}
		}
		catch (err: any) {
			// A batch that deterministically fails to persist (bad row, constraint,
			// dialect quirk) must not wedge the drain: without the XDEL below it would
			// be re-read from the stream head every tick forever, re-inserting any rows
			// that DID land. Drop it to a warning — telemetry is lossy by design.
			useLogger().warn(
				err,
				`[cache-stats] dropped ${batch.length} unpersistable events. ${err.message}`,
			);
		}

		// Outside the try so a handled failure still advances the stream head. On
		// success this preserves the at-least-once insert→XDEL ordering.
		await redis.call('XDEL', streamKey(), ...ids);

		drained += batch.length;

		if (batch.length < FLUSH_BATCH) {
			break;
		}
	}

	return drained;
}

/**
 * Recent cache activity for the admin page: descriptor (dimension, survives
 * retention) joined to windowed hits (fact). Not a live view — an entry evicted
 * or expired inside the window still shows until its events age out.
 */
export async function listCacheEntries(): Promise<CacheEntryRecord[]> {
	if (!cacheStatsConfigured()) {
		return [];
	}

	const db = getDatabase();
	const since = new Date(Date.now() - LISTING_WINDOW);

	const selects: (string | Knex.Raw)[] = [
		'd.cache_key',
		'd.method',
		'd.path',
		'd.collection',
		'd.user_id',
		'u.email as user_email',
		'd.query',
		'd.url',
		'd.bytes',
		'd.fill_ms',
		'd.last_filled',
		db.raw('SUM(CASE WHEN e.kind = 0 THEN 1 ELSE 0 END) AS hits'),
		db.raw('MAX(CASE WHEN e.kind = 0 THEN e.time END) AS last_hit_at'),
		db.raw('MAX(e.ttl_ms) AS ttl_ms'),
		db.raw('AVG(CASE WHEN e.kind = 0 THEN e.duration_ms END) AS hit_ms'),
	];

	if (db.client.config.client === 'pg') {
		// Recommended TTL = p95 of the re-request age distribution: hit ages plus
		// near-expiry miss ages (ttl + gap). An ordered-set aggregate, so Postgres
		// only — plain-DB installs get null (the telemetry targets Timescale).
		selects.push(
			db.raw(
				'percentile_cont(0.95) WITHIN GROUP (ORDER BY '
				+ 'CASE WHEN e.kind = 0 THEN e.age_ms ELSE e.ttl_ms + e.gap_ms END) '
				+ 'FILTER (WHERE e.kind = 0 OR e.gap_ms IS NOT NULL) '
				+ 'AS recommended_ttl_ms',
			),
		);
	}

	const rows = await db('directus_cache_descriptors as d')
		.join('directus_cache_events as e', 'e.cache_key', 'd.cache_key')
		.leftJoin('directus_users as u', 'u.id', 'd.user_id')
		.where('e.time', '>', since)
		.groupBy(
			'd.cache_key',
			'd.method',
			'd.path',
			'd.collection',
			'd.user_id',
			'u.email',
			'd.query',
			'd.url',
			'd.bytes',
			'd.fill_ms',
			'd.last_filled',
		)
		.orderBy('hits', 'desc')
		.limit(LISTING_LIMIT)
		.select(selects);

	return rows.map((row: Record<string, unknown>) => {
		const createdAt = new Date(row['last_filled'] as string).getTime();

		const ttlMs = row['ttl_ms'] === null
			? null
			: Number(row['ttl_ms']);

		const lastHit = row['last_hit_at'] as string | null;
		const userId = (row['user_id'] as string | null) || null;

		return {
			key: row['cache_key'] as string,
			method: row['method'] as string,
			path: row['path'] as string,
			collection: (row['collection'] as string | null) || null,
			user: userId === null
				? null
				: { id: userId, email: (row['user_email'] as string | null) ?? null },
			query: (row['query'] as string) ?? '',
			url: (row['url'] as string) ?? '',
			size: Number(row['bytes'] ?? 0),
			hits: Number(row['hits'] ?? 0),
			fillMs: row['fill_ms'] === null
				? null
				: Number(row['fill_ms']),
			hitMs: row['hit_ms'] === null || row['hit_ms'] === undefined
				? null
				: Math.round(Number(row['hit_ms'])),
			ttlMs,
			recommendedTtlMs: row['recommended_ttl_ms'] == null
				? null
				: Math.round(Number(row['recommended_ttl_ms'])),
			createdAt,
			expiresAt: ttlMs === null
				? null
				: createdAt + ttlMs,
			lastHitAt: lastHit
				? new Date(lastHit).getTime()
				: null,
		};
	});
}

/**
 * Evict a single cached response: the value + its `__expires_at`/`__tags`
 * siblings. Best-effort — a no-op if it already expired. The descriptor lingers
 * until the reaper prunes it.
 */
export async function evictCacheEntry(cache: Keyv, key: string): Promise<void> {
	await cache.delete(key);
	await cache.delete(`${key}__expires_at`);
	await cache.delete(`${key}__tags`);
}

// Evict every currently-described entry on a path. Returns the count attempted.
export async function evictCacheEntriesForPath(
	cache: Keyv,
	path: string,
): Promise<number> {
	if (!cacheStatsConfigured()) {
		return 0;
	}

	const keys = await getDatabase()('directus_cache_descriptors')
		.where({ path })
		.pluck('cache_key');

	await Promise.all(keys.map((key: string) => evictCacheEntry(cache, key)));

	return keys.length;
}

/**
 * Prune descriptor rows whose key stopped appearing — orphans left by a Directus
 * upgrade (new key generation) or a query combo that went quiet. Reproduces the
 * old Redis sidecar's TTL self-cleanup, which the dimension lacks.
 */
export async function reapCacheDescriptors(): Promise<number> {
	if (!cacheStatsConfigured()) {
		return 0;
	}

	const db = getDatabase();
	const cutoff = new Date(Date.now() - DESCRIPTOR_REAP_AFTER);

	return db('directus_cache_descriptors')
		.where('last_filled', '<', cutoff)
		.whereNotIn('cache_key', db('directus_cache_events').distinct('cache_key'))
		.delete();
}

/**
 * Prune fact rows past the retention window. The cross-dialect bound on
 * `directus_cache_events` growth: Timescale's own retention policy only covers the
 * hypertable path, so plain PG / MySQL / SQLite rely on this daily sweep (and it's
 * a harmless belt on Timescale, where chunk-drop already reclaims older rows).
 */
export async function reapCacheEvents(): Promise<number> {
	if (!cacheStatsConfigured()) {
		return 0;
	}

	const cutoff = new Date(Date.now() - retentionMs());

	return getDatabase()('directus_cache_events')
		.where('time', '<', cutoff)
		.delete();
}

/**
 * Recent cache anomalies for the admin page, grouped by reason+path with an
 * occurrence count. Windowed like the entries listing; older rows are reaped.
 */
export async function listCacheAnomalies(): Promise<CacheAnomalyRecord[]> {
	if (!cacheStatsConfigured()) {
		return [];
	}

	const db = getDatabase();
	const since = new Date(Date.now() - LISTING_WINDOW);

	const rows = await db('directus_cache_anomalies')
		.where('time', '>', since)
		.groupBy('reason', 'path', 'collection', 'method')
		.select(
			'reason',
			'path',
			'collection',
			'method',
			db.raw('COUNT(*) AS count'),
			db.raw('MAX(key_length) AS max_key_length'),
			db.raw('MAX(detail) AS sample'),
			db.raw('MAX(time) AS last_seen'),
		)
		.orderBy('count', 'desc')
		.limit(LISTING_LIMIT);

	return rows.map((row: Record<string, unknown>) => ({
		reason: row['reason'] as CacheAnomalyReason,
		path: row['path'] as string,
		collection: (row['collection'] as string | null) || null,
		method: (row['method'] as string | null) || null,
		count: Number(row['count'] ?? 0),
		maxKeyLength: row['max_key_length'] == null
			? null
			: Number(row['max_key_length']),
		sample: (row['sample'] as string | null) || null,
		lastSeen: new Date(row['last_seen'] as string).getTime(),
	}));
}

// Prune anomaly rows past the retention window, like the events reap.
export async function reapCacheAnomalies(): Promise<number> {
	if (!cacheStatsConfigured()) {
		return 0;
	}

	const cutoff = new Date(Date.now() - retentionMs());

	return getDatabase()('directus_cache_anomalies')
		.where('time', '<', cutoff)
		.delete();
}

async function isTimescale(db: Knex): Promise<boolean> {
	if (isTimescaleCache !== null) {
		return isTimescaleCache;
	}

	if (db.client.config.client !== 'pg') {
		isTimescaleCache = false;
		return false;
	}

	const { rows } = await db.raw(
		`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has`,
	);

	isTimescaleCache = rows[0].has === true;
	return isTimescaleCache;
}

async function eventsTableBytes(db: Knex): Promise<number> {
	// Postgres-only cheap per-table size. Other dialects return 0 → the MAX_BYTES
	// autokill is a no-op there and growth is bounded by the retention reap instead.
	if (db.client.config.client !== 'pg') {
		return 0;
	}

	// hypertable_size() sums the chunks; pg_total_relation_size() on the
	// parent would miss them. Plain PG falls back to the parent size.
	const query = (await isTimescale(db))
		? `SELECT hypertable_size('directus_cache_events') AS bytes`
		: `SELECT pg_total_relation_size('directus_cache_events') AS bytes`;

	try {
		const { rows } = await db.raw(query);
		return Number(rows[0].bytes);
	}
	catch {
		return 0;
	}
}

/**
 * One-way latch: disable capture (never re-enable) when the table or the
 * buffer outgrows its budget, so a traffic spike or runaway table can't hurt.
 * Only an admin brings it back, after reclaiming space.
 */
export async function enforceCacheStatsBudget(): Promise<void> {
	if (!cacheStatsActiveFlag) {
		return;
	}

	const env = useEnv();
	const reasons: string[] = [];

	const maxBytes = parseBytes(String(env['CACHE_STATS_MAX_BYTES'] ?? ''));

	if (maxBytes) {
		const bytes = await eventsTableBytes(getDatabase());

		if (bytes > maxBytes) {
			reasons.push(`table ${bytes}B > ${maxBytes}B`);
		}
	}

	const maxBuffer = Number(env['CACHE_STATS_MAX_BUFFER']) || 0;

	if (maxBuffer > 0) {
		const length = await useRedis().xlen(streamKey());

		if (length > maxBuffer) {
			reasons.push(`buffer ${length} > ${maxBuffer}`);
		}
	}

	if (reasons.length > 0) {
		const reason = `autokill: ${reasons.join('; ')}`;
		await setCacheStatsEnabled(false, reason);
		useLogger().warn(`[cache-stats] auto-disabled — ${reason}`);
	}
}

// Bus channel that announces a flag change so every node flips at once (the
// Redis key stays the durable source of truth for a booting/missed node).
const TOGGLE_CHANNEL = 'cacheStatsToggled';

interface CacheStatsToggle {
	enabled: boolean;
}

/**
 * Re-apply the flag on every node the instant it changes — event-driven via the
 * shared bus (same pattern as cache.ts `schemaChanged`), replacing a per-node
 * poll. Boot still primes from the Redis key, so a node down for the publish
 * catches up on its next start.
 */
export function subscribeCacheStatsToggle(): void {
	if (!redisConfigAvailable()) {
		return;
	}

	useBus().subscribe<CacheStatsToggle>(TOGGLE_CHANNEL, () => {
		void refreshCacheStatsFlag();
	});
}

/**
 * Flip the runtime override for every node (bus publish) and this node now.
 * Enabling clears any autokill reason; if still over budget the watchdog re-kills.
 */
export async function setCacheStatsEnabled(
	enabled: boolean,
	reason?: string,
): Promise<void> {
	const redis = useRedis();

	if (enabled) {
		await redis.set(flagKey(), '1');
		await redis.del(reasonKey());
		cacheStatsActiveFlag = cacheStatsConfigured();
	}
	else {
		await redis.set(flagKey(), '0');

		if (reason) {
			await redis.set(reasonKey(), reason);
		}

		cacheStatsActiveFlag = false;
	}

	// Announce so the other nodes re-read the key immediately, not on a poll.
	useBus().publish<CacheStatsToggle>(TOGGLE_CHANNEL, { enabled });
}

export async function getCacheStatsState(): Promise<CacheStatsState> {
	if (!cacheStatsConfigured()) {
		return {
			configured: false,
			enabled: false,
			killedReason: null,
			bufferLength: 0,
		};
	}

	const redis = useRedis();

	return {
		configured: true,
		enabled: cacheStatsActiveFlag,
		killedReason: await redis.get(reasonKey()),
		bufferLength: await redis.xlen(streamKey()),
	};
}

// Drop all gathered telemetry — the fast way to reclaim space after autokill.
export async function truncateCacheEvents(): Promise<void> {
	const db = getDatabase();
	await db('directus_cache_events').truncate();
	await db('directus_cache_descriptors').truncate();
	await db('directus_cache_anomalies').truncate();
}
