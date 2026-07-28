import { randomUUID } from 'node:crypto';
import { useEnv } from '@directus/env';
import { parse as parseBytes } from 'bytes';
import type { Knex } from 'knex';
import type Keyv from 'keyv';
import { useBus } from './bus/index.js';
import { resolvedCacheTtl } from './cache-config.js';
import getDatabase from './database/index.js';
import { useLogger } from './logger/index.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

/**
 * Cache telemetry buffered in a Redis Stream and drained to three PG tables so a
 * hit/miss never touches the DB on the hot path:
 *
 *   - `directus_cache_events` — lean fact, one row per hit/miss: cache key +
 *     age-at-hit (shorten signal), gap-since-expiry (lengthen signal, from a
 *     tombstone), effective TTL. Timescale hypertable + retention where present;
 *     a daily app-level reap (CACHE_STATS_RETENTION) bounds it on every dialect.
 *   - `directus_cache_descriptors` — dimension, one row per key: the request
 *     descriptor (method/path/collection/user/query/url/size), upserted on fill.
 *   - `directus_cache_anomalies` — silent not-cached / redis-error events.
 *
 * Five stream kinds: `h` hit + `m` miss (cache.ts), `f` fill-latency (respond.ts, the
 * compute time of a filled miss → events kind 2), `d` descriptor (respond.ts on a
 * fill, or report-cache-anomaly.ts as an unfilled locator), `a` anomaly. The drainer
 * demuxes them into the three tables. Capture is gated by a runtime flag refreshed
 * from Redis, killable live by an admin or the size/buffer watchdog.
 */

export interface CacheHit {
	cacheKey: string;
	ageMs: number;
	ttlMs: number | null;
	durationMs: number | null;
}

export interface CacheMiss {
	cacheKey: string;
	gapMs: number | null;
	ttlMs: number | null;
}

export interface CacheDescriptor {
	cacheKey: string; // stats identity (getCacheKey().hash) — always fixed-length
	redisKey: string; // the actual Redis key, for inspection + eviction
	coarse: boolean; // scoped collection tagged bare (no value slice) — over-purges
	method: string;
	path: string;
	collection: string | null;
	userId: string | null;
	query: string;
	url: string;
	bytes: number;
	fillMs: number;
	// null = an anomaly locator, never filled (bytes/fillMs 0). It stamps last_filled
	// NULL, which alone marks it: never clobbers a real fill, hidden from the listing.
	lastFilled?: Date | null;
}

// A silent cache anomaly (not cached, or a Redis error) surfaced on the dashboard
// rather than dropped. Coarse scope is a descriptor flag, not an anomaly.
//   - missing_scope: scoped mode, response has no scope tag (can't be purged).
//   - unautopurgeable_scope: a read hook scoped TO a tag no write auto-purges (a
//     value slice on a non-scoped field) without `manuallyPurged` — left uncached.
//   - value_too_large: payload over CACHE_VALUE_MAX_SIZE.
//   - redis_error: a Redis write failed.
export type CacheAnomalyReason =
	| 'missing_scope'
	| 'unautopurgeable_scope'
	| 'value_too_large'
	| 'redis_error';

export interface CacheAnomaly {
	cacheKey: string;
	reason: CacheAnomalyReason;
	detail?: string | null; // byte size / error message
}

// One grouped anomaly for the admin cache tree: a (cache_key, reason) pair joined to
// its descriptor for path/method/query, with an occurrence count.
export interface CacheAnomalyRecord {
	cacheKey: string;
	reason: CacheAnomalyReason;
	path: string;
	method: string;
	query: string;
	url: string;
	count: number;
	sample: string | null;
	lastSeen: number;
}

export interface CacheEntryRecord {
	key: string; // stats identity (the hash)
	redisKey: string; // the actual Redis key, for inspect + evict
	coarse: boolean; // scoped collection tagged bare — over-purges (a tuning signal)
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

export interface CacheTimeseriesBucket {
	t: number; // bucket-start epoch ms
	hits: number;
	misses: number;
	anomalies: number;
	ttlMs: number | null; // effective TTL in force during the bucket
	// Response-latency percentiles (ms): hit = serve-from-cache, miss = compute/fill,
	// both = the two pooled. null when the bucket had no sample of that kind.
	hitP50: number | null;
	hitP95: number | null;
	missP50: number | null;
	missP95: number | null;
	bothP50: number | null;
	bothP95: number | null;
}

export interface CacheConfigEvent {
	time: number;
	kind: 'ttl_change' | 'flush';
	detail: string | null;
}

export interface CacheTimeseries {
	buckets: CacheTimeseriesBucket[];
	markers: CacheConfigEvent[];
	// The TTL in force (override, else env default) — for the page's TTL input.
	effectiveTtl: string | null;
}

export interface CacheStatsState {
	configured: boolean;
	enabled: boolean;
	killedReason: string | null;
	bufferLength: number;
	// Hot-path events dropped when the buffer hit its cap mid-flush (slow Redis).
	// Lifetime counter — a non-zero value means telemetry went lossy.
	droppedEvents: number;
}

const STREAM_HARD_CAP = 1_000_000;

// Stream kind → the fact table's integer `kind`: 0 hit, 1 miss, 2 fill (the compute
// latency of a filled miss). Descriptors ('d') / anomalies ('a') demux elsewhere.
const EVENT_KIND_CODE: Record<string, number> = { h: 0, m: 1, f: 2 };

// One shared consumer group across all nodes: XREADGROUP '>' hands each entry to
// a single consumer, so overlapping drains on other nodes take disjoint slices —
// the append-only tables can't double-insert. Consumer name = per-process PEL owner.
const STREAM_GROUP = 'drain';
const CONSUMER_NAME = randomUUID();

// A consumer that read a batch then died leaves it pending; reclaim + re-drive it
// once idle this long (at-least-once, like the pre-group insert→XDEL semantics).
const PENDING_RECLAIM_AFTER = getMilliseconds('60s', 60_000);

const FLUSH_BATCH = 500;
const DEFAULT_GAP_LOOKBACK = getMilliseconds('1h', 3_600_000);

// The admin listing groups recent activity; older keys are reaped, not shown.
const DEFAULT_CACHE_STATS_WINDOW = getMilliseconds('24h', 86_400_000);
const MIN_CACHE_STATS_WINDOW = getMilliseconds('1m', 60_000);
const CACHE_STATS_LISTING_LIMIT = 200;

// A descriptor with no fill in this window AND no live event or anomaly is an
// orphan (past a Directus upgrade, or a query combo that stopped being requested).
const DESCRIPTOR_REAP_AFTER = getMilliseconds('90d', 7_776_000_000);

// Fallback event-retention window if CACHE_STATS_RETENTION is unset/unparsable.
const DEFAULT_RETENTION = getMilliseconds('30d', 2_592_000_000);

// A hot uncached path emits an anomaly per request; throttle to one sample per
// reason+key per minute so anomalies can't crowd out hit/miss telemetry.
const ANOMALY_THROTTLE_MS = getMilliseconds('1m', 60_000);

// Refreshed from Redis so a live toggle/autokill flips capture without a
// restart. Seeded false; the schedule primes it before the first request.
let cacheStatsActiveFlag = false;
let isTimescaleCache: boolean | null = null;

// Single-flight latch for the drain (see drainCacheEvents).
let cacheEventDrainInProgress = false;

function statsNamespace(): string {
	return `${useEnv()['CACHE_NAMESPACE']}:stats`;
}

const streamKey = () => `${statsNamespace()}:events`;
const flagKey = () => `${statsNamespace()}:enabled`;
const reasonKey = () => `${statsNamespace()}:killed_reason`;
const tombstoneKey = (key: string) => `${statsNamespace()}:tomb:${key}`;

const anomalyThrottleKey = (reason: string, cacheKey: string) =>
	`${statsNamespace()}:anom:${reason}:${cacheKey}`;

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
 * Clamp a caller-requested listing window (how far back entries + anomalies are
 * shown) to [1m, retention]: the admin can't ask for less than a minute, nor for
 * data already reaped past the retention cutoff. Undefined falls back to 24h.
 */
export function clampCacheStatsWindow(requested: number | undefined): number {
	if (requested === undefined || !Number.isFinite(requested)) {
		return DEFAULT_CACHE_STATS_WINDOW;
	}

	// Keep the ceiling at/above the floor: a sub-1m retention would otherwise invert
	// the clamp and return a window below MIN.
	return Math.min(
		Math.max(requested, MIN_CACHE_STATS_WINDOW),
		Math.max(retentionMs(), MIN_CACHE_STATS_WINDOW),
	);
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

// Per-tick XADD batching: captures buffer here; one pipelined flush per event-loop
// tick collapses N round-trips into one. A crash loses ≤1 tick (telemetry is lossy).
const CACHE_EVENT_BUFFER_CAP = 1000;

let cacheEventBuffer: string[][] = [];
let cacheEventBufferFlushScheduled = false;
let cacheEventBufferFlushInProgress = false;
let cacheEventBufferDropped = 0;

// Buffer one entry's fields; flush now if full, else at the tick boundary.
function xadd(fields: Record<string, string>): void {
	// Full while a flush is in flight (slow Redis): drop rather than grow the heap
	// unbounded on the hot path. Lossy by design; the drop surfaces on the state.
	if (cacheEventBufferFlushInProgress
		&& cacheEventBuffer.length >= CACHE_EVENT_BUFFER_CAP) {
		cacheEventBufferDropped += 1;
		return;
	}

	const flat: string[] = [];

	for (const [field, value] of Object.entries(fields)) {
		flat.push(field, value);
	}

	cacheEventBuffer.push(flat);

	if (cacheEventBuffer.length >= CACHE_EVENT_BUFFER_CAP) {
		void flushCacheEventBuffer();
	}
	else if (!cacheEventBufferFlushScheduled) {
		cacheEventBufferFlushScheduled = true;
		setImmediate(() => void flushCacheEventBuffer());
	}
}

// Flush the buffered XADDs in one pipelined round-trip. Errors are swallowed + the
// buffer cleared either way, so a failing Redis can't wedge it (telemetry is lossy).
export async function flushCacheEventBuffer(): Promise<void> {
	// One pipeline in flight at a time: under a slow (not down) Redis, defer instead
	// of stacking concurrent exec()s + their batches on the heap. Backpressure.
	if (cacheEventBufferFlushInProgress) {
		return;
	}

	cacheEventBufferFlushScheduled = false;

	if (cacheEventBuffer.length === 0) {
		return;
	}

	cacheEventBufferFlushInProgress = true;
	const batch = cacheEventBuffer;
	cacheEventBuffer = [];

	const pipe = useRedis().pipeline();

	for (const flat of batch) {
		// MAXLEN ~ caps stream memory; .call() over xadd() (spread trips its overloads).
		pipe.call(
			'XADD',
			streamKey(),
			'MAXLEN',
			'~',
			String(STREAM_HARD_CAP),
			'*',
			...flat,
		);
	}

	try {
		await pipe.exec();
	}
	catch (err: any) {
		useLogger().warn(err, `[cache-stats] XADD flush failed. ${err.message}`);
	}
	finally {
		cacheEventBufferFlushInProgress = false;

		// Anything buffered while the pipeline was in flight → chain a follow-up flush.
		if (cacheEventBuffer.length > 0) {
			setImmediate(() => void flushCacheEventBuffer());
		}
	}
}

export async function queueCacheHit(hit: CacheHit): Promise<void> {
	if (!cacheStatsActiveFlag) {
		return;
	}

	xadd({
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

// The compute latency of a cache fill (a miss that produced + cached a response),
// as its own event kind ('f') so it never inflates the miss count. duration_ms
// carries the fill time; the latency chart reads it beside the hit serve latency.
export function queueCacheFillLatency(cacheKey: string, durationMs: number): void {
	if (!cacheStatsActiveFlag) {
		return;
	}

	xadd({
		kind: 'f',
		cacheKey,
		durationMs: String(durationMs),
		ts: String(Date.now()),
	});
}

export async function queueCacheMiss(miss: CacheMiss): Promise<void> {
	if (!cacheStatsActiveFlag) {
		return;
	}

	xadd({
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

// Claim the once-per-window anomaly slot for a reason+key (SET NX): true for the
// first caller in the window, false when the slot is already taken.
export async function claimCacheAnomalyThrottleSlot(
	reason: CacheAnomalyReason,
	cacheKey: string,
): Promise<boolean> {
	if (!cacheStatsActiveFlag) {
		return false;
	}

	const claimed = await useRedis().set(
		anomalyThrottleKey(reason, cacheKey),
		'1',
		'PX',
		ANOMALY_THROTTLE_MS,
		'NX',
	);

	return claimed !== null;
}

// Emit an anomaly sample keyed by the request's cache key (the descriptor ref).
// Caller must have claimed the throttle slot first.
export function queueCacheAnomaly(entry: CacheAnomaly): void {
	if (!cacheStatsActiveFlag) {
		return;
	}

	xadd({
		kind: 'a',
		cacheKey: entry.cacheKey,
		reason: entry.reason,
		detail: entry.detail ?? '',
		ts: String(Date.now()),
	});
}

// The per-key descriptor, emitted on a fill where every field is populated.
export async function queueCacheDescriptor(entry: CacheDescriptor): Promise<void> {
	if (!cacheStatsActiveFlag) {
		return;
	}

	xadd({
		kind: 'd',
		cacheKey: entry.cacheKey,
		redisKey: entry.redisKey,
		coarse: entry.coarse
			? '1'
			: '0',
		method: entry.method,
		path: entry.path,
		collection: entry.collection ?? '',
		userId: entry.userId ?? '',
		query: entry.query,
		url: entry.url,
		bytes: String(entry.bytes),
		fillMs: String(entry.fillMs),
		// Empty ts = no fill time = a locator; the drain reads last_filled off it.
		ts: entry.lastFilled === null
			? ''
			: String(Date.now()),
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
	if (!cacheStatsActiveFlag) {
		return;
	}

	const remainingLifeMs = Math.max(expiredAt - Date.now(), 0);

	await useRedis().set(
		tombstoneKey(key),
		String(expiredAt),
		'PX',
		// Floor at 1ms: an already-expired entry with a zero lookback would otherwise
		// pass PX 0, which Redis rejects — dropping the gap (lengthen) signal.
		Math.max(remainingLifeMs + gapLookbackMs(), 1),
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
	redis_key: string;
	coarse: boolean;
	method: string;
	path: string;
	collection: string | null;
	user_id: string | null;
	query: string;
	url: string;
	bytes: number;
	fill_ms: number;
	last_filled: Date | null; // null = anomaly locator, never filled
}

interface CacheAnomalyRow {
	time: Date;
	cache_key: string;
	reason: string;
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
 * Guarded entrypoint for the drain. A process-local latch makes an overlapping
 * tick on the same node a no-op; cross-node overlap is safe because the drain
 * reads through a shared consumer group (each entry to one consumer), not XRANGE.
 */
export async function drainCacheEvents(): Promise<number> {
	if (!cacheStatsConfigured() || cacheEventDrainInProgress) {
		return 0;
	}

	cacheEventDrainInProgress = true;

	try {
		return await drainCacheEventStream();
	}
	finally {
		cacheEventDrainInProgress = false;
	}
}

async function drainCacheEventStream(): Promise<number> {
	const db = getDatabase();

	// Yield entirely to live traffic when the pool is already contended.
	if (dbPoolSaturated(db)) {
		return 0;
	}

	const redis = useRedis();
	await ensureStreamGroup(redis);

	// Re-drive anything a crashed consumer left pending, then never-delivered ones.
	let drained = await reclaimStalePending(redis, db);

	for (;;) {
		if (dbPoolSaturated(db)) {
			break;
		}

		// '>' = entries never handed to any consumer, so a concurrent drain on another
		// node gets a disjoint slice, never this same batch.
		const response = (await redis.call(
			'XREADGROUP',
			'GROUP',
			STREAM_GROUP,
			CONSUMER_NAME,
			'COUNT',
			String(FLUSH_BATCH),
			'STREAMS',
			streamKey(),
			'>',
		)) as [string, [string, string[]][]][] | null;

		const batch = response?.[0]?.[1] ?? [];

		if (batch.length === 0) {
			break;
		}

		await persistStreamBatch(redis, db, batch);
		drained += batch.length;

		if (batch.length < FLUSH_BATCH) {
			break;
		}
	}

	return drained;
}

// Create the shared group idempotently before each drain. '0' + MKSTREAM so it
// also adopts entries already in the stream and survives a truncate that dropped
// it; BUSYGROUP just means another node (or an earlier tick) got there first.
async function ensureStreamGroup(redis: ReturnType<typeof useRedis>): Promise<void> {
	try {
		await redis.call('XGROUP', 'CREATE', streamKey(), STREAM_GROUP, '0', 'MKSTREAM');
	}
	catch (err: any) {
		if (!String(err?.message).includes('BUSYGROUP')) {
			throw err;
		}
	}
}

// Reclaim entries a dead consumer left pending past the idle window and re-drive
// them through the same persist path (at-least-once). XAUTOCLAIM transfers PEL
// ownership atomically, so two nodes reclaiming at once take disjoint slices.
async function reclaimStalePending(
	redis: ReturnType<typeof useRedis>,
	db: Knex,
): Promise<number> {
	let reclaimed = 0;
	let cursor = '0-0';

	for (;;) {
		if (dbPoolSaturated(db)) {
			break;
		}

		const [nextCursor, batch] = (await redis.call(
			'XAUTOCLAIM',
			streamKey(),
			STREAM_GROUP,
			CONSUMER_NAME,
			String(PENDING_RECLAIM_AFTER),
			cursor,
			'COUNT',
			String(FLUSH_BATCH),
		)) as [string, [string, string[]][], string[]];

		if (batch.length > 0) {
			await persistStreamBatch(redis, db, batch);
			reclaimed += batch.length;
		}

		// '0-0' = the scan wrapped back to the start; nothing left to reclaim.
		if (nextCursor === '0-0') {
			break;
		}

		cursor = nextCursor;
	}

	return reclaimed;
}

// Demux one stream batch into the three tables, then ack + delete its entries.
// Shared by the new-entry drain and the crashed-consumer reclaim.
async function persistStreamBatch(
	redis: ReturnType<typeof useRedis>,
	db: Knex,
	batch: [string, string[]][],
): Promise<void> {
	const ids = batch.map(([id]) => id);
	const events: CacheEventRow[] = [];
	const descriptors = new Map<string, CacheDescriptorRow>();
	const locators = new Map<string, CacheDescriptorRow>();
	const anomalies: CacheAnomalyRow[] = [];

	for (const [, flat] of batch) {
		const f = parseFields(flat);
		const at = new Date(Number(f['ts']));

		if (f['kind'] === 'a') {
			anomalies.push({
				time: at,
				cache_key: f['cacheKey']!,
				reason: f['reason'] ?? '',
				detail: f['detail'] ?? '',
			});

			continue;
		}

		if (f['kind'] === 'd') {
			const row: CacheDescriptorRow = {
				cache_key: f['cacheKey']!,
				redis_key: f['redisKey'] ?? '',
				coarse: f['coarse'] === '1',
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
				// Empty ts = never filled = a locator: NULL keeps Age honest + non-entry.
				last_filled: f['ts']
					? at
					: null,
			};

			// Last write in the batch wins — a re-conflicting insert would throw.
			// Locators (last_filled null) insert-if-absent, never clobber a real fill.
			(row.last_filled === null
				? locators
				: descriptors).set(row.cache_key, row);

			continue;
		}

		events.push({
			time: at,
			cache_key: f['cacheKey']!,
			kind: EVENT_KIND_CODE[f['kind']!] ?? 1,
			age_ms: num(f['ageMs']),
			gap_ms: num(f['gapMs']),
			ttl_ms: num(f['ttlMs']),
			duration_ms: num(f['durationMs']),
		});
	}

	try {
		// One transaction so a mid-batch failure rolls back atomically, never leaving
		// the fact events persisted while descriptors/anomalies are dropped.
		await db.transaction(async (trx) => {
			if (events.length > 0) {
				await trx.batchInsert('directus_cache_events', events, FLUSH_BATCH);
			}

			if (descriptors.size > 0) {
				await trx('directus_cache_descriptors')
					.insert([...descriptors.values()])
					.onConflict('cache_key')
					.merge();
			}

			// After real fills, so a locator only creates a row when none exists yet;
			// its zeros must never overwrite a cached entry's bytes/coarse/fill_ms.
			if (locators.size > 0) {
				await trx('directus_cache_descriptors')
					.insert([...locators.values()])
					.onConflict('cache_key')
					.ignore();
			}

			if (anomalies.length > 0) {
				await trx.batchInsert('directus_cache_anomalies', anomalies, FLUSH_BATCH);
			}
		});
	}
	catch (err: any) {
		// A batch that deterministically fails (bad row, constraint, dialect quirk) must
		// not wedge the drain: without the ack/del below it is redelivered every tick
		// forever. The transaction rolled back, so nothing landed — drop it to a warning
		// (telemetry is lossy by design).
		useLogger().warn(
			err,
			`[cache-stats] dropped ${batch.length} unpersistable events. ${err.message}`,
		);
	}

	// Outside the try so a handled failure still clears the entries. XACK settles the
	// group's pending record; XDEL reclaims the stream memory.
	await redis.call('XACK', streamKey(), STREAM_GROUP, ...ids);
	await redis.call('XDEL', streamKey(), ...ids);
}

/**
 * Recent cache activity for the admin page: descriptor (dimension, survives
 * retention) joined to windowed hits (fact). Not a live view — an entry evicted
 * or expired inside the window still shows until its events age out.
 */
export async function listCacheEntries(
	windowMs?: number,
): Promise<CacheEntryRecord[]> {
	if (!cacheStatsConfigured()) {
		return [];
	}

	const db = getDatabase();
	const since = new Date(Date.now() - clampCacheStatsWindow(windowMs));

	const selects: (string | Knex.Raw)[] = [
		'd.cache_key',
		'd.redis_key',
		'd.coarse',
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
		// Anomaly locators (never filled) resolve as anomaly rows, not cache entries.
		.whereNotNull('d.last_filled')
		.groupBy(
			'd.cache_key',
			'd.redis_key',
			'd.coarse',
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
		.orderBy('d.cache_key', 'asc')
		.limit(CACHE_STATS_LISTING_LIMIT)
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
			redisKey: row['redis_key'] as string,
			coarse: Boolean(row['coarse']),
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
		.pluck('redis_key');

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

	// Filled descriptor: an orphan once stale AND no event or anomaly references
	// it — a re-anomalied dormant key keeps its descriptor for the anomaly join.
	const filled = await db('directus_cache_descriptors')
		.where('last_filled', '<', cutoff)
		.whereNotIn('cache_key', db('directus_cache_events').distinct('cache_key'))
		.whereNotIn('cache_key', db('directus_cache_anomalies').distinct('cache_key'))
		.delete();

	// Locators (last_filled NULL) never match the cutoff, so reap them on the orphan
	// rule alone: no event AND no anomaly still references them (both reaped at their
	// own retention, so nothing left ⇒ no activity within the retention window).
	const locators = await db('directus_cache_descriptors')
		.whereNull('last_filled')
		.whereNotIn('cache_key', db('directus_cache_events').distinct('cache_key'))
		.whereNotIn('cache_key', db('directus_cache_anomalies').distinct('cache_key'))
		.delete();

	return filled + locators;
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
 * Recent cache anomalies for the admin page, grouped by cache_key+reason and shown
 * under each path/method/query node, with an occurrence count. Windowed like the
 * entries listing; older rows are reaped.
 */
export async function listCacheAnomalies(
	windowMs?: number,
): Promise<CacheAnomalyRecord[]> {
	if (!cacheStatsConfigured()) {
		return [];
	}

	const db = getDatabase();
	const since = new Date(Date.now() - clampCacheStatsWindow(windowMs));

	// Join the descriptor for path/method/query (reaped at 90d, so an inner join never
	// hides a live 24h-window anomaly) — a (cache_key, reason) pair lands at its node.
	const rows = await db('directus_cache_anomalies as a')
		.join('directus_cache_descriptors as d', 'd.cache_key', 'a.cache_key')
		.where('a.time', '>', since)
		.groupBy('a.cache_key', 'a.reason', 'd.path', 'd.method', 'd.query', 'd.url')
		.select(
			'a.cache_key',
			'a.reason',
			'd.path',
			'd.method',
			'd.query',
			'd.url',
			db.raw('COUNT(*) AS count'),
			db.raw('MAX(a.detail) AS sample'),
			db.raw('MAX(a.time) AS last_seen'),
		)
		.orderBy('count', 'desc')
		.orderBy('a.cache_key', 'asc')
		.orderBy('a.reason', 'asc')
		.limit(CACHE_STATS_LISTING_LIMIT);

	return rows.map((row: Record<string, unknown>) => {
		return {
			cacheKey: row['cache_key'] as string,
			reason: row['reason'] as CacheAnomalyReason,
			path: row['path'] as string,
			method: row['method'] as string,
			query: (row['query'] as string) ?? '',
			url: (row['url'] as string) ?? '',
			count: Number(row['count'] ?? 0),
			sample: (row['sample'] as string | null) || null,
			lastSeen: new Date(row['last_seen'] as string).getTime(),
		};
	});
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

const CACHE_TIMESERIES_MAX_BUCKETS = 500;

/**
 * Append a marker for an admin cache action (a TTL change, a flush) so the cache
 * page can plot it over the timeseries. Recorded unconditionally — NOT gated on
 * cache-stats — so a change made while stats were off still shows once they return.
 * `detail` carries the new TTL value (`ttl_change`) or the joined targets (`flush`).
 */
export async function recordCacheConfigEvent(
	kind: CacheConfigEvent['kind'],
	detail: string | null,
): Promise<void> {
	await getDatabase()('directus_cache_config_events').insert({
		time: new Date(),
		kind,
		detail,
	});
}

/**
 * Bucketed hits / misses / anomalies + the effective TTL curve over `windowMs`, plus
 * the discrete config-event markers in the same window. The curves come from the
 * stats tables (only populated when stats are configured) and the bucketing is
 * Postgres-only, like `recommended_ttl`; markers come from their own always-recorded
 * table, so they surface even with stats off (over otherwise-empty curves).
 */
export async function readCacheTimeseries(
	windowMs?: number,
	buckets = 60,
): Promise<CacheTimeseries> {
	const db = getDatabase();
	const windowLen = clampCacheStatsWindow(windowMs);
	const now = Date.now();

	const bucketCount = Math.min(
		Math.max(Math.trunc(buckets), 1),
		CACHE_TIMESERIES_MAX_BUCKETS,
	);

	const bucketSec = Math.max(1, Math.ceil(windowLen / bucketCount / 1000));
	const bucketMs = bucketSec * 1000;

	// Anchor the grid to a fixed bucketSec boundary so a fast (1s) refresh doesn't
	// re-quantize every bucket — otherwise the whole curve crawls on each tick. Only
	// the newest bucket fills as `now` advances; the grid steps by one whole bucket
	// when `now` crosses a boundary. The last slot is the bucket CONTAINING now, so
	// the most recent traffic is never dropped off the edge.
	const anchorMs = Math.floor(now / bucketMs) * bucketMs;
	const sinceMs = anchorMs - (bucketCount - 1) * bucketMs;
	const since = new Date(sinceMs);

	const markerRows = await db('directus_cache_config_events')
		.where('time', '>', since)
		.orderBy('time', 'asc')
		.select('time', 'kind', 'detail');

	const markers: CacheConfigEvent[] = markerRows.map(
		(row: Record<string, unknown>) => {
			return {
				time: new Date(row['time'] as string).getTime(),
				kind: row['kind'] as CacheConfigEvent['kind'],
				detail: (row['detail'] as string | null) ?? null,
			};
		},
	);

	const effective = resolvedCacheTtl();

	const effectiveTtl = typeof effective === 'string' && effective !== ''
		? effective
		: null;

	// Bucket by whole seconds ELAPSED since the anchored `since` (an interval
	// difference): index is 0-based (0 = oldest, bucketCount-1 = the bucket holding
	// now) and immune to the column's storage timezone. `since` itself is bucket-
	// aligned above so the grid is stable across refreshes.
	const dense: CacheTimeseriesBucket[] = Array.from(
		{ length: bucketCount },
		(_unused, index) => {
			return {
				t: sinceMs + index * bucketSec * 1000,
				hits: 0,
				misses: 0,
				anomalies: 0,
				ttlMs: null,
				hitP50: null,
				hitP95: null,
				missP50: null,
				missP95: null,
				bothP50: null,
				bothP95: null,
			};
		},
	);

	if (!cacheStatsConfigured() || db.client.config.client !== 'pg') {
		return { buckets: dense, markers, effectiveTtl };
	}

	const bucketExpr = 'floor(extract(epoch from (time - ?::timestamptz)) / ?)';

	const eventRows = await db('directus_cache_events')
		.where('time', '>', since)
		.groupByRaw('1')
		.select(
			db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]),
			db.raw('SUM(CASE WHEN kind = 0 THEN 1 ELSE 0 END) AS hits'),
			db.raw('SUM(CASE WHEN kind = 1 THEN 1 ELSE 0 END) AS misses'),
			db.raw('MAX(ttl_ms) AS ttl_ms'),
		);

	// Response-latency percentiles per bucket over duration_ms: kind 0 = hit serve,
	// kind 2 = miss compute (fill); the unfiltered aggregate pools both. Scoped to
	// kinds 0/2 so the miss-count kind (1) is ignored here.
	const pct = (p: number, filter?: string) => {
		const base = `percentile_cont(${p}) WITHIN GROUP (ORDER BY duration_ms)`;

		return filter
			? `${base} FILTER (WHERE ${filter})`
			: base;
	};

	const latencyRows = await db('directus_cache_events')
		.where('time', '>', since)
		.whereIn('kind', [0, 2])
		.whereNotNull('duration_ms')
		.groupByRaw('1')
		.select(
			db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]),
			db.raw(`${pct(0.5, 'kind = 0')} AS hit_p50`),
			db.raw(`${pct(0.95, 'kind = 0')} AS hit_p95`),
			db.raw(`${pct(0.5, 'kind = 2')} AS miss_p50`),
			db.raw(`${pct(0.95, 'kind = 2')} AS miss_p95`),
			db.raw(`${pct(0.5)} AS both_p50`),
			db.raw(`${pct(0.95)} AS both_p95`),
		);

	const anomalyRows = await db('directus_cache_anomalies')
		.where('time', '>', since)
		.groupByRaw('1')
		.select(
			db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]),
			db.raw('COUNT(*) AS count'),
		);

	// Defensive clamp: a row at/after the next boundary (clock skew) would exceed the
	// last slot; fold it into the last bucket rather than drop it. `+=` in the count
	// loop because the fold can still collapse two DB buckets into one.
	function slotOf(bucket: unknown): number {
		return Math.min(Math.max(Number(bucket), 0), bucketCount - 1);
	}

	for (const row of eventRows as Record<string, unknown>[]) {
		const index = slotOf(row['bucket']);
		dense[index]!.hits += Number(row['hits'] ?? 0);
		dense[index]!.misses += Number(row['misses'] ?? 0);

		if (row['ttl_ms'] != null) {
			dense[index]!.ttlMs = Number(row['ttl_ms']);
		}
	}

	for (const row of anomalyRows as Record<string, unknown>[]) {
		dense[slotOf(row['bucket'])]!.anomalies += Number(row['count'] ?? 0);
	}

	// A distinct grid (only kinds 0/2), so a latency bucket can't collide with a
	// count bucket — assign, don't accumulate. Null percentiles (no sample) stay null.
	function pctVal(value: unknown): number | null {
		return value == null
			? null
			: Number(value);
	}

	for (const row of latencyRows as Record<string, unknown>[]) {
		const slot = dense[slotOf(row['bucket'])]!;
		slot.hitP50 = pctVal(row['hit_p50']);
		slot.hitP95 = pctVal(row['hit_p95']);
		slot.missP50 = pctVal(row['miss_p50']);
		slot.missP95 = pctVal(row['miss_p95']);
		slot.bothP50 = pctVal(row['both_p50']);
		slot.bothP95 = pctVal(row['both_p95']);
	}

	return { buckets: dense, markers, effectiveTtl };
}

// Prune config-event markers past the retention window. Ungated (they are recorded
// unconditionally); wired into the stats reap cycle, so it only runs when stats are
// on — acceptable given how rarely admin cache actions happen.
export async function reapCacheConfigEvents(): Promise<number> {
	const cutoff = new Date(Date.now() - retentionMs());

	return getDatabase()('directus_cache_config_events')
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

	try {
		// hypertable_size() sums the chunks; pg_total_relation_size() misses them on
		// the parent. A failed timescale probe (in this try) falls back to plain PG.
		const query = (await isTimescale(db))
			? `SELECT hypertable_size('directus_cache_events') AS bytes`
			: `SELECT pg_total_relation_size('directus_cache_events') AS bytes`;

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
			droppedEvents: cacheEventBufferDropped,
		};
	}

	const redis = useRedis();

	return {
		configured: true,
		enabled: cacheStatsActiveFlag,
		killedReason: await redis.get(reasonKey()),
		bufferLength: await redis.xlen(streamKey()),
		droppedEvents: cacheEventBufferDropped,
	};
}

// Delete every stats key matching a glob (throttle slots, tombstones). SCAN, not
// KEYS, so it never blocks the shared Redis thread on a big keyspace; UNLINK frees
// the keys off-thread.
async function deleteStatsKeysByPattern(
	redis: ReturnType<typeof useRedis>,
	pattern: string,
): Promise<void> {
	let cursor = '0';

	do {
		const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
		cursor = next;

		if (keys.length > 0) {
			await redis.unlink(...keys);
		}
	} while (cursor !== '0');
}

// Drop all gathered telemetry — the fast way to reclaim space after autokill.
export async function truncateCacheEvents(): Promise<void> {
	const db = getDatabase();
	await db('directus_cache_events').truncate();
	await db('directus_cache_descriptors').truncate();
	await db('directus_cache_anomalies').truncate();

	// Full reset: also drop the Redis transients tied to those rows — else buffered
	// events drain back in and a held throttle slot suppresses the next sample.
	if (!redisConfigAvailable()) {
		return;
	}

	const redis = useRedis();
	await redis.del(streamKey());
	await deleteStatsKeysByPattern(redis, `${statsNamespace()}:anom:*`);
	await deleteStatsKeysByPattern(redis, `${statsNamespace()}:tomb:*`);
}
