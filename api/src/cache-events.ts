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
import { printableScopedCacheTags } from './utils/printable-scoped-cache-tags.js';

// The timeseries wire types live in @directus/types so the app chart shares them.
export type {
	CacheConfigEvent,
	CachePurgeMode,
	CacheTimeseries,
	CacheTimeseriesBucket,
} from '@directus/types';

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
 *   - `directus_cache_purges` — one row per purge operation (not per evicted
 *     key), carrying how far it reached and how many entries it took.
 *
 * Eight stream kinds. Latency facts in `directus_cache_events` (numeric `kind`, all
 * carrying duration_ms): `h` hit (0), `f` fill (2) a cached miss's compute, `x`
 * anomaly-miss (3) a flagged-uncacheable miss, `o` other-miss (4) a silently-skipped
 * miss — the "Misses" curve pools 2/3/4. `m` miss (1, cache.ts) is the count only.
 * `d` descriptor + `a` anomaly + `p` purge demux to the other tables. Capture is
 * gated by a
 * runtime flag refreshed
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

/** One purge operation: how far it reached, and how much it took with it. */
export interface CachePurge {
	/**
	 * Correlates the operations of ONE purge. Omitted, each operation gets its own
	 * id — right when it is its own purge. Passed, several share it: a mutation
	 * whose scope was unresolvable runs the coarse collection fallback AND a second
	 * pass for the tags a hook declared, and an entry both reach must count one
	 * purge, not two.
	 */
	purgeId?: string;
	collection: string | null; // null on a namespace-wide clear
	mode: CachePurgeMode;
	// The scoped cache tags this purge actually dropped, in the display form
	// `collection[:field=value]`, so a purge joins against an entry's own tags.
	// Null where the list is derived rather than chosen (`collection`,
	// `namespace`) and `collection` plus `mode` already state the reach.
	scopedCacheTags: string[] | null;
	scopedCacheTagCount: number; // that reach as a number, for every mode
	evicted: number | null; // entries those sets held; null = whole-namespace clear
	// Wall-clock of the purge itself. It is awaited inside the mutation, so this
	// is time added to the write, not a background cost.
	durationMs: number;
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
	// The scoped cache tags this entry was filled under, in the display form the
	// purge side records — the join that answers "was this entry covered by that
	// purge?".
	scopedCacheTags: string[];
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
	/**
	 * Purges that covered this entry's tags in the window. Read beside `hits`:
	 * more purges than hits means the cache is filling this response more often
	 * than it serves it, which is negative work.
	 */
	purges: number;
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
	misses: number;
	fills: number;
	fillMs: number | null;
	hitMs: number | null;
	ttlMs: number | null;
	recommendedTtlMs: number | null;
	createdAt: number;
	expiresAt: number | null;
	lastHitAt: number | null;
}

// What a latency percentile is measured over, in the funnel order the cache page
// reads: every timed response, the compute a miss had to do, the flagged and the
// cached slices of that compute, then a serve straight from cache.
export const CACHE_LATENCY_METRICS = [
	'response',
	'miss',
	'anomaly',
	'fill',
	'hit',
] as const;

export type CacheLatencyMetric = typeof CACHE_LATENCY_METRICS[number];

export interface CacheLatencyPercentiles {
	p50: number | null;
	p95: number | null;
	p99: number | null;
}

// Response-latency percentiles for one tree node. `method`/`query` null marks the
// endpoint rollup row, computed over the path's whole event set rather than summed
// from its query rows — a percentile of percentiles is not a percentile.
export type CacheGroupLatencyRecord = {
	path: string;
	method: string | null;
	query: string | null;
} & Record<CacheLatencyMetric, CacheLatencyPercentiles>;

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
const EVENT_KIND_CODE: Record<string, number> = { h: 0, m: 1, f: 2, x: 3, o: 4 };

const MISS_LATENCY_KIND: Record<'fill' | 'anomaly' | 'other', string> = {
	fill: 'f',
	anomaly: 'x',
	other: 'o',
};

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

// The entries listing aggregates every event in its window, so its default is
// far shorter than the shared one: the row count scales with traffic, and a day
// of a busy cache spills the aggregate to disk.
const DEFAULT_CACHE_ENTRIES_WINDOW = getMilliseconds('10m', 600_000);

// An entry pinned to a hot slice is covered by every mutation of it, so the
// purges since its fill are unbounded. The newest few answer "was this entry
// invalidated and kept anyway"; the rest are the same answer repeated.
const CACHE_ENTRY_PURGE_LIMIT = 50;

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
const tombstoneKey = (redisKey: string) => `${statsNamespace()}:tomb:${redisKey}`;

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

// The compute latency of one miss, tagged by disposition so the latency chart can
// slice the umbrella "Misses" curve: `fill` cached (kind f/2), `anomaly` flagged
// uncacheable (x/3), `other` silently skipped (o/4). duration_ms carries the time;
// none use kind `m`, so the miss count stays untouched.
export function queueMissLatency(
	durationMs: number,
	disposition: 'fill' | 'anomaly' | 'other',
	cacheKey = '',
): void {
	if (!cacheStatsActiveFlag) {
		return;
	}

	xadd({
		kind: MISS_LATENCY_KIND[disposition],
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

/**
 * Emit one purge operation — not one event per evicted key, which would put the
 * write path's fan-out onto the stream. A purge fires once per mutation, so this
 * is mutation-rate, and each row carries how far it reached and what it took.
 */
export function queueCachePurge(entry: CachePurge): void {
	// Gated on being CONFIGURED, not on the capture flag — deliberately unlike
	// the hit/miss emitters beside it. `recordCacheConfigEvent` records a flush
	// even while stats are off so it still shows once they return, and a purge is
	// the same class of event. The watchdog that kills capture kills it for
	// hit/miss volume; a purge is mutation-rate and is not what it defends
	// against, so losing purges to it would blind the page exactly when an
	// operator is looking for what evicted the cache.
	if (!cacheStatsConfigured()) {
		return;
	}

	xadd({
		kind: 'p',
		collection: entry.collection ?? '',
		mode: entry.mode,
		// One id per purge, so an entry covered by two of its tags counts it once —
		// and, where the caller supplies one, an entry covered by two operations of
		// the same purge counts it once too.
		purgeId: entry.purgeId ?? randomUUID(),
		scopedCacheTags: (entry.scopedCacheTags ?? []).join(','),
		scopedCacheTagCount: String(entry.scopedCacheTagCount),
		// Empty = unknown, which is not the same as none. Only a namespace clear
		// sends it: it has no member list to count.
		evicted: entry.evicted === null
			? ''
			: String(entry.evicted),
		durationMs: String(entry.durationMs),
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
		scopedCacheTags: entry.scopedCacheTags.join(','),
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
	redisKey: string,
	expiredAt: number,
): Promise<void> {
	if (!cacheStatsActiveFlag) {
		return;
	}

	const remainingLifeMs = Math.max(expiredAt - Date.now(), 0);

	await useRedis().set(
		tombstoneKey(redisKey),
		String(expiredAt),
		'PX',
		// Floor at 1ms: an already-expired entry with a zero lookback would otherwise
		// pass PX 0, which Redis rejects — dropping the gap (lengthen) signal.
		Math.max(remainingLifeMs + gapLookbackMs(), 1),
	);
}

// Gap since the entry expired, or null for a cold miss (no tombstone).
export async function readCacheMissGap(
	redisKey: string,
	now: number,
): Promise<number | null> {
	const stored = await useRedis().get(tombstoneKey(redisKey));

	if (stored === null) {
		return null;
	}

	return Math.max(now - Number(stored), 0);
}

// The expiry timestamp a live tombstone holds (when the key last expired), or
// null if none — for the admin drawer's per-key inspection.
export async function readCacheTombstone(
	redisKey: string,
): Promise<number | null> {
	if (!redisConfigAvailable()) {
		return null;
	}

	const stored = await useRedis().get(tombstoneKey(redisKey));

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

interface CachePurgeRow {
	time: Date;
	purge_id: string;
	collection: string | null;
	mode: CachePurgeMode;
	scoped_cache_tag_count: number;
	evicted: number | null; // null = a namespace clear, whose size is unknowable
	duration_ms: number | null;
}

/**
 * The collection a display-form scoped cache tag belongs to: `articles`, or the
 * head of `articles:owner=7`. Taken off the tag rather than off the descriptor,
 * since one entry can read across collections and carry a tag from each.
 */
function collectionOfScopedCacheTag(scopedCacheTag: string): string {
	const slice = scopedCacheTag.indexOf(':');

	return slice === -1
		? scopedCacheTag
		: scopedCacheTag.slice(0, slice);
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
	const purges: CachePurgeRow[] = [];

	const purgedScopedCacheTags: {
		purge_id: string;
		time: Date;
		scoped_cache_tag: string;
		collection: string;
	}[] = [];

	// Keyed so the last fill in a batch wins, matching the descriptor upsert: an
	// entry's tags are replaced wholesale on refill, never merged with the old set.
	const entryScopedCacheTags = new Map<string, {
		scoped_cache_tag: string;
		collection: string;
	}[]>();

	for (const [, flat] of batch) {
		const f = parseFields(flat);
		const at = new Date(Number(f['ts']));

		if (f['kind'] === 'p') {
			purges.push({
				time: at,
				collection: f['collection']
					? f['collection']
					: null,
				purge_id: f['purgeId'] ?? '',
				mode: (f['mode'] ?? 'slices') as CachePurgeMode,
				scoped_cache_tag_count: Number(f['scopedCacheTagCount'] ?? 0),
				// Empty came off a namespace clear: unknown, not none.
				evicted: f['evicted']
					? Number(f['evicted'])
					: null,
				// Absent = never measured; 0 would be an instant purge.
				duration_ms: f['durationMs']
					? Number(f['durationMs'])
					: null,
			});

			// One row per tag the purge dropped, carrying the purge's own id so an
			// entry covered by two of them still counts the purge once.
			for (const scopedCacheTag of (f['scopedCacheTags'] ?? '')
				.split(',')
				.filter(Boolean)) {
				purgedScopedCacheTags.push({
					purge_id: f['purgeId'] ?? '',
					time: at,
					// Escaped on the way into the column, not at the producer, so any
					// caller queueing a purge is covered — a raw NUL fails the whole tick.
					scoped_cache_tag: printableScopedCacheTags(scopedCacheTag),
					collection: collectionOfScopedCacheTag(scopedCacheTag),
				});
			}

			// A collection-wide purge names no tag: it dropped the bare tag AND
			// every slice, and a pinned entry carries only its slice tag. Recording
			// the bare tag alone would attribute it to global reads and miss every
			// pinned entry, which is most of what it destroyed — so it is recorded
			// against the collection, in one row rather than one per derived slice.
			if (f['mode'] === 'collection' && f['collection']) {
				purgedScopedCacheTags.push({
					purge_id: f['purgeId'] ?? '',
					time: at,
					scoped_cache_tag: '',
					collection: f['collection'],
				});
			}

			continue;
		}

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

			// Only a real fill knows the tags; a locator is written at an anomaly
			// site where the read never got far enough to resolve them.
			if (row.last_filled !== null) {
				const filledUnder = [...new Set(
					(f['scopedCacheTags'] ?? '').split(',').filter(Boolean),
				)];

				entryScopedCacheTags.set(
					row.cache_key,
					filledUnder.map((scopedCacheTag) => {
						return {
							// Same escaping as the purge side, or the two stop joining.
							scoped_cache_tag: printableScopedCacheTags(scopedCacheTag),
							collection: collectionOfScopedCacheTag(scopedCacheTag),
						};
					}),
				);
			}

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

			if (purges.length > 0) {
				await trx.batchInsert('directus_cache_purges', purges, FLUSH_BATCH);
			}

			if (purgedScopedCacheTags.length > 0) {
				await trx.batchInsert(
					'directus_scoped_cache_purge_tags',
					purgedScopedCacheTags,
					FLUSH_BATCH,
				);
			}

			// Replaced, not merged: a refill under a narrower scope must not leave
			// the old tags behind claiming coverage the entry no longer has.
			if (entryScopedCacheTags.size > 0) {
				await trx('directus_scoped_cache_entry_tags')
					.whereIn('cache_key', [...entryScopedCacheTags.keys()])
					.delete();

				const rows = [...entryScopedCacheTags]
					.flatMap(([cacheKey, filledUnder]) => {
						return filledUnder.map((tagged) => {
							return { cache_key: cacheKey, ...tagged };
						});
					});

				if (rows.length > 0) {
					await trx.batchInsert(
						'directus_scoped_cache_entry_tags',
						rows,
						FLUSH_BATCH,
					);
				}
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

/** How far a purge reached, which decides what it can be matched against. */
const SCOPED_CACHE_PURGE_REACHES = ['tag', 'collection'] as const;

type ScopedCachePurgeReach = (typeof SCOPED_CACHE_PURGE_REACHES)[number];

/**
 * The join that answers "did this purge cover that entry", as a builder the
 * caller projects. One reach per call, because the two are asked in turn.
 *
 *  - `tag` — the purge named a tag the entry was filled under.
 *  - `collection` — the purge named no tag at all (the coarse fallback dropped
 *    the bare tag AND every slice, so no single tag states its reach), and a
 *    pinned entry carries only its slice tag, so the tag reach never sees it.
 *
 * Shared rather than written per caller because it is the join CONDITION the two
 * readers must agree on: a count saying an entry was purged, beside a listing
 * that cannot name the purge, would be reporting different things.
 */
function scopedCachePurgeCoverage(
	db: Knex,
	reach: ScopedCachePurgeReach,
	cacheKeys: string[],
	since: Date,
): Knex.QueryBuilder {
	if (reach === 'tag') {
		return db('directus_scoped_cache_entry_tags as et')
			.join(
				'directus_scoped_cache_purge_tags as pt',
				'pt.scoped_cache_tag',
				'et.scoped_cache_tag',
			)
			.where('pt.time', '>', since)
			.whereIn('et.cache_key', cacheKeys);
	}

	return db('directus_scoped_cache_purge_tags as pt')
		.join(
			'directus_scoped_cache_entry_tags as et',
			'et.collection',
			'pt.collection',
		)
		.where('pt.time', '>', since)
		.where('pt.scoped_cache_tag', '')
		.whereIn('et.cache_key', cacheKeys);
}

/** One purge that covered an entry, with the reach it was fired with. */
export interface CacheEntryPurgeRecord {
	time: number;
	mode: CachePurgeMode;
	collection: string | null;
	/** The tag both sides matched on, or null where the purge named none. */
	scopedCacheTag: string | null;
	evicted: number | null;
}

/**
 * The purges that covered one entry since `since` — pass its `last_filled` and
 * the answer is what happened to it after it was written. Read beside `exists`:
 * a purge covering an entry that is still held is a missed invalidation, which
 * is the question the cached payload used to be eyeballed for.
 *
 * Ordered newest first and capped, because an entry pinned to a hot slice can
 * be covered by thousands of purges and the first few answer the question.
 */
export async function listPurgesCoveringEntry(
	cacheKey: string,
	since: Date,
): Promise<CacheEntryPurgeRecord[]> {
	if (!cacheStatsConfigured()) {
		return [];
	}

	const db = getDatabase();

	// The DB boundary: knex resolves a builder to `any`, so the row shape is
	// asserted here rather than at each field below.
	const rows: Record<string, unknown>[] = [];

	for (const reach of SCOPED_CACHE_PURGE_REACHES) {
		rows.push(...await scopedCachePurgeCoverage(db, reach, [cacheKey], since)
			.join('directus_cache_purges as p', 'p.purge_id', 'pt.purge_id')
			.distinct(
				'p.purge_id',
				'p.time',
				'p.mode',
				'p.collection',
				'pt.scoped_cache_tag',
				'p.evicted',
			)
			// Ordered by tag as well so that where a purge covered several of the
			// entry's tags, which of them the deduplication below keeps is the same
			// answer on every read rather than whichever the DB happened to emit.
			.orderBy('p.time', 'desc')
			.orderBy('pt.scoped_cache_tag', 'asc')
			.limit(CACHE_ENTRY_PURGE_LIMIT) as Record<string, unknown>[]);
	}

	// A namespace clear names neither a tag nor a collection, so neither reach
	// above can join it — and it took every entry, this one included. Read
	// straight from the purges table, which is the only trace it leaves. Not
	// counted in the listing's `purges`: that column attributes a purge to the
	// scope it named, and a clear named none.
	rows.push(...await db('directus_cache_purges as p')
		.where('p.mode', 'namespace')
		.where('p.time', '>', since)
		.select('p.purge_id', 'p.time', 'p.mode', 'p.collection', 'p.evicted')
		.orderBy('p.time', 'desc')
		.limit(CACHE_ENTRY_PURGE_LIMIT) as Record<string, unknown>[]);

	// One purge is one record however many of the entry's tags it covered: the
	// rows differ only in which tag matched, which `DISTINCT` keeps apart, and
	// the listing counts the same purge once (`COUNT(DISTINCT purge_id)`).
	const byPurgeId = new Map<string, CacheEntryPurgeRecord>();

	for (const row of rows) {
		const purgeId = row['purge_id'] as string;

		if (byPurgeId.has(purgeId)) {
			continue;
		}

		byPurgeId.set(purgeId, {
			time: new Date(row['time'] as string).getTime(),
			mode: row['mode'] as CachePurgeMode,
			collection: (row['collection'] as string | null) ?? null,
			// Empty is how the collection reach spells "named no tag"; null says
			// it outward, so a reader cannot mistake it for a tag called ''.
			scopedCacheTag: (row['scoped_cache_tag'] as string) || null,
			evicted: row['evicted'] === null
				? null
				: Number(row['evicted']),
		});
	}

	// Re-sorted across the reaches, which were each newest-first on their own.
	return [...byPurgeId.values()]
		.sort((a, b) => b.time - a.time)
		.slice(0, CACHE_ENTRY_PURGE_LIMIT);
}

/**
 * The descriptor behind a Redis key.
 *
 * `cache_key` is tried first and answers on any install that hashes, where both
 * columns hold the same digest and that one is the primary key. Only a readable
 * key (`CACHE_KEY_HASH_ENABLED=false`) falls through to `redis_key`, which is
 * TEXT — unindexed, since MySQL cannot index it without a prefix length, and the
 * scan is paid once per inspection rather than on any hot path.
 *
 * The primary-key arm goes first for a second reason: `redis_key` defaults to
 * `''` on rows written before it existed and on anomaly locators, so an empty
 * probe would match all of them at once.
 *
 * A locator answers null like a key with no descriptor at all: `last_filled` is
 * nullable exactly so that a descriptor written at an anomaly site can say the
 * response was never cached, and there is no fill to measure anything from. The
 * entries listing draws the same line with `WHERE last_filled IS NOT NULL`.
 */
export async function readCacheDescriptorForRedisKey(
	redisKey: string,
): Promise<{ cacheKey: string; lastFilled: Date } | null> {
	if (!cacheStatsConfigured() || redisKey === '') {
		return null;
	}

	const db = getDatabase();

	const byIdentity = await db('directus_cache_descriptors')
		.where('cache_key', redisKey)
		.first('cache_key', 'last_filled');

	const found = byIdentity ?? await db('directus_cache_descriptors')
		.where('redis_key', redisKey)
		.first('cache_key', 'last_filled');

	// `new Date(null)` is the epoch, so a locator would otherwise report having
	// been filled on 1970-01-01 and take every purge recorded since with it.
	if (found === undefined || found['last_filled'] === null) {
		return null;
	}

	return {
		cacheKey: found['cache_key'] as string,
		lastFilled: new Date(found['last_filled'] as string),
	};
}

/**
 * Recent cache activity for the admin page: windowed hits (fact) ranked on
 * their own, then paired with the descriptor (dimension, survives retention).
 * Not a live view — an entry evicted or expired inside the window still shows
 * until its events age out.
 */
export async function listCacheEntries(
	windowMs?: number,
): Promise<CacheEntryRecord[]> {
	if (!cacheStatsConfigured()) {
		return [];
	}

	const db = getDatabase();

	const since = new Date(
		Date.now() - clampCacheStatsWindow(windowMs ?? DEFAULT_CACHE_ENTRIES_WINDOW),
	);

	const activitySelects: (string | Knex.Raw)[] = [
		'e.cache_key',
		db.raw('SUM(CASE WHEN e.kind = 0 THEN 1 ELSE 0 END) AS hits'),
		db.raw('SUM(CASE WHEN e.kind = 1 THEN 1 ELSE 0 END) AS misses'),
		db.raw('SUM(CASE WHEN e.kind = 2 THEN 1 ELSE 0 END) AS fills'),
		db.raw('MAX(CASE WHEN e.kind = 0 THEN e.time END) AS last_hit_at'),
		db.raw('MAX(e.ttl_ms) AS ttl_ms'),
		db.raw('AVG(CASE WHEN e.kind = 0 THEN e.duration_ms END) AS hit_ms'),
	];

	if (db.client.config.client === 'pg') {
		// Recommended TTL = p95 of the re-request age distribution: hit ages plus
		// near-expiry miss ages (ttl + gap). An ordered-set aggregate, so Postgres
		// only — plain-DB installs get null (the telemetry targets Timescale).
		activitySelects.push(
			db.raw(
				'percentile_cont(0.95) WITHIN GROUP (ORDER BY '
				+ 'CASE WHEN e.kind = 0 THEN e.age_ms ELSE e.ttl_ms + e.gap_ms END) '
				+ 'FILTER (WHERE e.kind = 0 OR e.gap_ms IS NOT NULL) '
				+ 'AS recommended_ttl_ms',
			),
		);
	}

	// Grouped on the event's own key alone: folding the descriptor's wide text
	// columns into the grouping key spills the sort to disk and outruns the
	// statement timeout once the window holds millions of events.
	const activityRows = await db('directus_cache_events as e')
		.where('e.time', '>', since)
		// Anomaly locators (never filled) resolve as anomaly rows, not cache entries.
		// A semi-join, so excluding them adds no column to the grouping key.
		.whereExists((filledDescriptor) => {
			filledDescriptor
				.select(db.raw('1'))
				.from('directus_cache_descriptors as d')
				.whereRaw('?? = ??', ['d.cache_key', 'e.cache_key'])
				.whereNotNull('d.last_filled');
		})
		.groupBy('e.cache_key')
		.orderBy('hits', 'desc')
		.orderBy('e.cache_key', 'asc')
		.limit(CACHE_STATS_LISTING_LIMIT)
		.select(activitySelects);

	const listedKeys = activityRows.map((row: Record<string, unknown>) => {
		return String(row['cache_key']);
	});

	// A primary-key read over the listed keys only, so the dimension columns never
	// reach the aggregate above.
	const descriptorRows = listedKeys.length === 0
		? []
		: await db('directus_cache_descriptors as d')
			.leftJoin('directus_users as u', 'u.id', 'd.user_id')
			.whereIn('d.cache_key', listedKeys)
			.select(
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
			);

	const descriptorsByKey = new Map<string, Record<string, unknown>>(
		descriptorRows.map((row: Record<string, unknown>) => {
			return [String(row['cache_key']), row];
		}),
	);

	// Reaped between the two reads: the semi-join saw a descriptor the lookup no
	// longer finds, and an entry with no dimension row has nothing to show.
	const rows = activityRows.flatMap((row: Record<string, unknown>) => {
		const descriptor = descriptorsByKey.get(String(row['cache_key']));

		return descriptor === undefined
			? []
			: [{ ...descriptor, ...row }];
	});

	// Counted in its own pass rather than joined in above: entry_tags × purge_tags
	// multiplies the descriptor's rows, which would inflate the hit/miss/fill SUMs
	// beside it. DISTINCT on the purge id so a purge covering two of an entry's
	// tags counts once.
	const purgesByKey = new Map<string, number>();

	if (listedKeys.length > 0) {
		// Summed rather than merged: a purge names a tag or names a collection and
		// never both, so the two reaches cannot double-count one of them.
		for (const reach of SCOPED_CACHE_PURGE_REACHES) {
			const counted = await scopedCachePurgeCoverage(db, reach, listedKeys, since)
				.groupBy('et.cache_key')
				.select(
					'et.cache_key',
					db.raw('COUNT(DISTINCT pt.purge_id) AS purges'),
				);

			for (const row of counted as Record<string, unknown>[]) {
				const cacheKey = row['cache_key'] as string;
				const already = purgesByKey.get(cacheKey) ?? 0;
				purgesByKey.set(cacheKey, already + Number(row['purges'] ?? 0));
			}
		}
	}

	return rows.map((row: Record<string, unknown>) => {
		const createdAt = new Date(row['last_filled'] as string).getTime();

		const ttlMs = row['ttl_ms'] === null
			? null
			: Number(row['ttl_ms']);

		const lastHit = row['last_hit_at'] as string | null;
		const userId = (row['user_id'] as string | null) || null;

		return {
			key: row['cache_key'] as string,
			purges: purgesByKey.get(row['cache_key'] as string) ?? 0,
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
			misses: Number(row['misses'] ?? 0),
			fills: Number(row['fills'] ?? 0),
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
 * Response-latency percentiles per tree node, for ranking endpoints by what a
 * cache miss actually costs.
 *
 * - Two grouping sets in one pass: `(path, method, query)` matches the query
 *   nodes of the page's tree, `(path)` the endpoint nodes above them.
 * - Each set aggregates the raw events, so an endpoint's p95 is the p95 of its
 *   own requests — not a rollup of its children's percentiles, which would not
 *   be a percentile at all.
 * - One entry per metric the timeseries chart also draws, over the same kinds:
 *   `response` pools everything timed, `miss` the compute kinds 2/3/4, `anomaly`
 *   and `fill` the flagged and cached slices of those, `hit` a serve straight
 *   from cache.
 * - `percentile_cont` is an ordered-set aggregate: Postgres only, like
 *   `recommendedTtlMs`. Other dialects get an empty list and the tree drops the
 *   percentile columns.
 */
export async function listCacheGroupLatencies(
	windowMs?: number,
): Promise<CacheGroupLatencyRecord[]> {
	const db = getDatabase();

	if (!cacheStatsConfigured() || db.client.config.client !== 'pg') {
		return [];
	}

	const since = new Date(Date.now() - clampCacheStatsWindow(windowMs));

	const pct = (p: number, filter: string) => {
		return `percentile_cont(${p}) WITHIN GROUP (ORDER BY e.duration_ms) `
			+ `FILTER (WHERE ${filter})`;
	};

	// Kind 1 is a bare miss count with no timing, so `response` pools 0/2/3/4 —
	// the same set the chart's Response curve draws.
	const metricKinds: Record<CacheLatencyMetric, string> = {
		response: 'e.kind IN (0, 2, 3, 4)',
		miss: 'e.kind IN (2, 3, 4)',
		anomaly: 'e.kind = 3',
		fill: 'e.kind = 2',
		hit: 'e.kind = 0',
	};

	const percentileSelects = CACHE_LATENCY_METRICS.flatMap((metric) => {
		return [0.5, 0.95, 0.99].map((quantile) => {
			const column = `${metric}_p${Math.round(quantile * 100)}`;

			return db.raw(`${pct(quantile, metricKinds[metric])} AS ${column}`);
		});
	});

	const rows = await db('directus_cache_descriptors as d')
		.join('directus_cache_events as e', 'e.cache_key', 'd.cache_key')
		.where('e.time', '>', since)
		.whereIn('e.kind', [0, 2, 3, 4])
		.whereNotNull('e.duration_ms')
		.whereNotNull('d.last_filled')
		.groupByRaw('GROUPING SETS ((d.path, d.method, d.query), (d.path))')
		.select(
			'd.path',
			// Null in a grouping-set row is ambiguous — it can be the rolled-up
			// column or a genuinely null value. GROUPING() disambiguates: 1 = this
			// row aggregates over the column.
			db.raw('GROUPING(d.method) AS method_rolled_up'),
			'd.method',
			'd.query',
			...percentileSelects,
		);

	function metricPercentiles(
		row: Record<string, unknown>,
		metric: CacheLatencyMetric,
	): CacheLatencyPercentiles {
		function millis(column: string): number | null {
			const value = row[`${metric}_${column}`];

			return value == null
				? null
				: Math.round(Number(value));
		}

		return { p50: millis('p50'), p95: millis('p95'), p99: millis('p99') };
	}

	return rows.map((row: Record<string, unknown>) => {
		const rolledUp = Number(row['method_rolled_up']) === 1;

		return {
			path: row['path'] as string,
			method: rolledUp
				? null
				: (row['method'] as string),
			query: rolledUp
				? null
				: ((row['query'] as string) ?? ''),
			response: metricPercentiles(row, 'response'),
			miss: metricPercentiles(row, 'miss'),
			anomaly: metricPercentiles(row, 'anomaly'),
			fill: metricPercentiles(row, 'fill'),
			hit: metricPercentiles(row, 'hit'),
		};
	});
}

/**
 * Evict a single cached response: the value + its `__expires_at`/`__tags`
 * siblings. Best-effort — a no-op if it already expired. The descriptor lingers
 * until the reaper prunes it.
 */
export async function evictCacheEntry(
	cache: Keyv,
	redisKey: string,
): Promise<void> {
	await cache.delete(redisKey);
	await cache.delete(`${redisKey}__expires_at`);
	await cache.delete(`${redisKey}__tags`);
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
 * Prune purge-tag rows past the retention window, alongside the purges they
 * belong to — the join half ages out with the fact half or it would outlive it
 * and keep claiming coverage for purges nothing remembers.
 */
export async function reapScopedCachePurgeTags(): Promise<number> {
	if (!cacheStatsConfigured()) {
		return 0;
	}

	const cutoff = new Date(Date.now() - retentionMs());

	return getDatabase()('directus_scoped_cache_purge_tags')
		.where('time', '<', cutoff)
		.delete();
}

/**
 * Drop tag rows whose entry no longer has a descriptor. The tags are a dimension
 * of the entry, so they follow it out rather than accumulating for keys that
 * stopped appearing.
 */
export async function reapScopedCacheEntryTags(): Promise<number> {
	if (!cacheStatsConfigured()) {
		return 0;
	}

	const db = getDatabase();

	return db('directus_scoped_cache_entry_tags')
		.whereNotIn('cache_key', db('directus_cache_descriptors').distinct('cache_key'))
		.delete();
}

/**
 * Prune purge rows past the retention window. Bounded like every other fact
 * table here: a purge row is written per mutation, so an unswept table grows
 * with the write workload rather than with the cache.
 */
export async function reapCachePurges(): Promise<number> {
	if (!cacheStatsConfigured()) {
		return 0;
	}

	const cutoff = new Date(Date.now() - retentionMs());

	return getDatabase()('directus_cache_purges')
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

/**
 * The range a requested bucket count has to fall in. Exported so that the schema
 * publishing the argument, the guard refusing it and the clamp below all name
 * one bound rather than three that can drift.
 */
export const CACHE_TIMESERIES_MIN_BUCKETS = 1;
export const CACHE_TIMESERIES_MAX_BUCKETS = 500;

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
 * A `ttl_change` marker's value in ms. `null` detail is a CLEARED override, which
 * hands the TTL back to env `CACHE_TTL` — so it resolves to the env value, not to
 * "unknown".
 *
 * That env value is read NOW, not as of the marker: a clear recorded while
 * `CACHE_TTL` was `5m`, replayed after a deploy moved it to `1h`, draws `1h` over a
 * period that ran at `5m`. Closing that would mean recording the resolved value in
 * `detail` at write time; until then a clear is only as accurate as env is stable.
 */
function markerTtlMs(detail: string | null): number | null {
	const env = useEnv();

	return getMilliseconds(detail ?? env['CACHE_TTL']) ?? null;
}

/**
 * The TTL in force over each bucket, replaying the `ttl_change` markers across the
 * grid. `seedTtlMs` is what the window opened on — the last change before it, or
 * `null` when none is recorded, in which case the leading buckets stay `null` rather
 * than inheriting a value from a change that had not happened yet.
 *
 * A change applies from the bucket that CONTAINS it onward: a bucket is a span, and
 * the value that ends it is the one a reader is asking about when the marker sits on
 * it. Exported for its own tests — the reconstruction is the whole point of the
 * series and is worth pinning without a database.
 */
export function effectiveTtlByBucket(
	bucketTimes: number[],
	changes: { time: number; ttlMs: number | null }[],
	seedTtlMs: number | null,
): (number | null)[] {
	const ordered = [...changes].sort((a, b) => a.time - b.time);
	let pending = 0;
	let inForce = seedTtlMs;

	return bucketTimes.map((_bucketTime, index) => {
		// Every change landing before this bucket ends has applied by the time the
		// bucket closes. The last bucket has no successor, so it runs to the window end.
		const bucketEnd = bucketTimes[index + 1] ?? Infinity;

		while (pending < ordered.length && ordered[pending]!.time < bucketEnd) {
			inForce = ordered[pending]!.ttlMs;
			pending++;
		}

		return inForce;
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
		Math.max(Math.trunc(buckets), CACHE_TIMESERIES_MIN_BUCKETS),
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
				fills: 0,
				anomalies: 0,
				purges: 0,
				coarsePurges: 0,
				purgedEntries: 0,
				purgeP50: null,
				purgeP95: null,
				purgeP99: null,
				ttlMs: null,
				effectiveTtlMs: null,
				hitP50: null,
				hitP95: null,
				hitP99: null,
				fillP50: null,
				fillP95: null,
				fillP99: null,
				anomalyP50: null,
				anomalyP95: null,
				anomalyP99: null,
				missP50: null,
				missP95: null,
				missP99: null,
				bothP50: null,
				bothP95: null,
				bothP99: null,
			};
		},
	);

	// The window's own markers only say what changed INSIDE it; the value it opened on
	// comes from the last change before it. Without that lookup every window would
	// start unknown and the chart would back-fill its lead with a later value — the
	// exact conflation this series exists to stop (#343).
	const priorChange = await db('directus_cache_config_events')
		.where('kind', 'ttl_change')
		.andWhere('time', '<=', since)
		.orderBy('time', 'desc')
		.first();

	const ttlChanges = markers
		.filter((marker) => marker.kind === 'ttl_change')
		.map((marker) => {
			return { time: marker.time, ttlMs: markerTtlMs(marker.detail) };
		});

	// No change inside the window means the value in force now held across all of it,
	// whatever the marker history — which is the ordinary case for a deployment that
	// never edited the TTL and so has no markers at all. Falling back to `null` there
	// would leave the series empty and the page looking broken. The lead is genuinely
	// unknown only when the window contains changes but nothing precedes them.
	function windowOpenedOn(): number | null {
		if (priorChange) {
			return markerTtlMs((priorChange['detail'] as string | null) ?? null);
		}

		return ttlChanges.length === 0
			? getMilliseconds(effective) ?? null
			: null;
	}

	const seedTtlMs = windowOpenedOn();

	effectiveTtlByBucket(dense.map((bucket) => bucket.t), ttlChanges, seedTtlMs)
		.forEach((ttlMs, index) => {
			dense[index]!.effectiveTtlMs = ttlMs;
		});

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
			db.raw('SUM(CASE WHEN kind = 2 THEN 1 ELSE 0 END) AS fills'),
			db.raw('MAX(ttl_ms) AS ttl_ms'),
		);

	// Response-latency percentiles per bucket over duration_ms. Kind 0 = hit serve;
	// 2/3/4 = miss compute (fill / anomaly / other); the unfiltered aggregate pools
	// hits + all misses (both). Those kinds only, so the miss count (1) is skipped.
	const pct = (p: number, filter?: string) => {
		const base = `percentile_cont(${p}) WITHIN GROUP (ORDER BY duration_ms)`;

		return filter
			? `${base} FILTER (WHERE ${filter})`
			: base;
	};

	const latencyRows = await db('directus_cache_events')
		.where('time', '>', since)
		.whereIn('kind', [0, 2, 3, 4])
		.whereNotNull('duration_ms')
		.groupByRaw('1')
		.select(
			db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]),
			db.raw(`${pct(0.5, 'kind = 0')} AS hit_p50`),
			db.raw(`${pct(0.95, 'kind = 0')} AS hit_p95`),
			db.raw(`${pct(0.99, 'kind = 0')} AS hit_p99`),
			db.raw(`${pct(0.5, 'kind = 2')} AS fill_p50`),
			db.raw(`${pct(0.95, 'kind = 2')} AS fill_p95`),
			db.raw(`${pct(0.99, 'kind = 2')} AS fill_p99`),
			db.raw(`${pct(0.5, 'kind = 3')} AS anomaly_p50`),
			db.raw(`${pct(0.95, 'kind = 3')} AS anomaly_p95`),
			db.raw(`${pct(0.99, 'kind = 3')} AS anomaly_p99`),
			db.raw(`${pct(0.5, 'kind IN (2, 3, 4)')} AS miss_p50`),
			db.raw(`${pct(0.95, 'kind IN (2, 3, 4)')} AS miss_p95`),
			db.raw(`${pct(0.99, 'kind IN (2, 3, 4)')} AS miss_p99`),
			db.raw(`${pct(0.5)} AS both_p50`),
			db.raw(`${pct(0.95)} AS both_p95`),
			db.raw(`${pct(0.99)} AS both_p99`),
		);

	const anomalyRows = await db('directus_cache_anomalies')
		.where('time', '>', since)
		.groupByRaw('1')
		.select(
			db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]),
			db.raw('COUNT(*) AS count'),
		);

	// The drain is at-least-once: it acks the Redis stream only after the insert
	// commits, so a crash in between redelivers the batch and writes each purge
	// twice. Aggregating the rows straight would then double both the count and the
	// eviction total. A purge carries an id, and a redelivery repeats it verbatim,
	// so reading DISTINCT rows collapses the copies before anything is summed.
	// (The events fact has no id and cannot do this — hence the id here.)
	const distinctPurges = db('directus_cache_purges')
		.where('time', '>', since)
		.distinct('purge_id', 'time', 'mode', 'evicted', 'duration_ms')
		.as('p');

	// A purge is one operation however many entries it deleted, so the count and
	// the eviction total are different questions and both are answered. The coarse
	// modes are split out here rather than in the app: they are what turns a purge
	// from the cache working into a hit ratio falling off a cliff.
	const purgeRows = await db(distinctPurges)
		.groupByRaw('1')
		.select(
			db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]),
			db.raw('COUNT(*) AS count'),
			db.raw(
				"SUM(CASE WHEN mode IN ('collection', 'namespace') THEN 1 ELSE 0 END) "
				+ 'AS coarse',
			),
			db.raw('SUM(evicted) AS evicted'),
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
		dense[index]!.fills += Number(row['fills'] ?? 0);

		if (row['ttl_ms'] != null) {
			dense[index]!.ttlMs = Number(row['ttl_ms']);
		}
	}

	for (const row of anomalyRows as Record<string, unknown>[]) {
		dense[slotOf(row['bucket'])]!.anomalies += Number(row['count'] ?? 0);
	}

	for (const row of purgeRows as Record<string, unknown>[]) {
		const index = slotOf(row['bucket']);
		dense[index]!.purges += Number(row['count'] ?? 0);
		dense[index]!.coarsePurges += Number(row['coarse'] ?? 0);
		dense[index]!.purgedEntries += Number(row['evicted'] ?? 0);
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
		slot.hitP99 = pctVal(row['hit_p99']);
		slot.fillP50 = pctVal(row['fill_p50']);
		slot.fillP95 = pctVal(row['fill_p95']);
		slot.fillP99 = pctVal(row['fill_p99']);
		slot.anomalyP50 = pctVal(row['anomaly_p50']);
		slot.anomalyP95 = pctVal(row['anomaly_p95']);
		slot.anomalyP99 = pctVal(row['anomaly_p99']);
		slot.missP50 = pctVal(row['miss_p50']);
		slot.missP95 = pctVal(row['miss_p95']);
		slot.missP99 = pctVal(row['miss_p99']);
		slot.bothP50 = pctVal(row['both_p50']);
		slot.bothP95 = pctVal(row['both_p95']);
		slot.bothP99 = pctVal(row['both_p99']);
	}

	// A pass of its own because the durations live on the purges table, not on the
	// events fact every percentile above comes from — same `pct` window function,
	// a different grid. `pctVal`, so a bucket whose purges were never timed keeps
	// its null: an untimed purge is not an instant one.
	const purgeLatencyRows = await db(distinctPurges)
		.groupByRaw('1')
		.select(
			db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]),
			db.raw(`${pct(0.5)} AS purge_p50`),
			db.raw(`${pct(0.95)} AS purge_p95`),
			db.raw(`${pct(0.99)} AS purge_p99`),
		);

	for (const row of purgeLatencyRows as Record<string, unknown>[]) {
		const slot = dense[slotOf(row['bucket'])]!;
		slot.purgeP50 = pctVal(row['purge_p50']);
		slot.purgeP95 = pctVal(row['purge_p95']);
		slot.purgeP99 = pctVal(row['purge_p99']);
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
	// Purges are telemetry of the same class, so they go with it. Left behind,
	// they would count against entries whose own history was just cleared —
	// purges without hits, on a window that reports no traffic at all.
	await db('directus_cache_purges').truncate();
	await db('directus_scoped_cache_purge_tags').truncate();
	await db('directus_scoped_cache_entry_tags').truncate();

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
