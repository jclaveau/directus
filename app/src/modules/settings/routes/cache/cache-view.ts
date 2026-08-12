import type { Filter } from '@directus/types';
import { formatDuration } from '@/utils/format-duration';
import { matchesFilter } from './filter-entry';

export interface CacheEntry {
	key: string; // stats identity (the hash)
	redisKey: string; // the actual Redis key — inspect + evict by this
	path: string;
	method: string;
	collection: string | null;
	user: { id: string; email: string | null } | null;
	query: string;
	url: string;
	createdAt: number;
	expiresAt: number | null;
	lastHitAt: number | null;
	size: number;
	hits: number;
	misses: number;
	fills: number;
	// Purges that covered this entry's tags in the window. Read beside `hits`:
	// more purges than hits means the cache is filling this response more often
	// than it serves it.
	purges: number;
	fillMs: number | null;
	hitMs: number | null;
	ttlMs: number | null;
	recommendedTtlMs: number | null;
	coarse: boolean; // scoped collection tagged bare — over-purges (a tuning signal)
}

export type LatencyPercentile = 'p50' | 'p95' | 'p99';

export const LATENCY_PERCENTILES: LatencyPercentile[] = ['p50', 'p95', 'p99'];

// The latency chart's categories, in the funnel order the page reads them: every
// timed response, the compute a miss had to do, then the flagged and the cached
// slices of that compute, then a serve straight from cache.
export const LATENCY_METRICS = [
	'response',
	'miss',
	'anomaly',
	'fill',
	'hit',
] as const;

export type LatencyMetric = typeof LATENCY_METRICS[number];

// Null where the window holds no such event for the node, or on a dialect with no
// ordered-set aggregates (Postgres only — see listCacheGroupLatencies).
export type NodeLatencies = Record<
	LatencyMetric,
	Record<LatencyPercentile, number | null>
>;

// One row of /utils/cache/latencies. `method`/`query` null marks the endpoint
// rollup, aggregated over the path's own events rather than its query rows.
export interface GroupLatencyRecord extends NodeLatencies {
	path: string;
	method: string | null;
	query: string | null;
}

export function emptyLatencies(): NodeLatencies {
	return {
		response: { p50: null, p95: null, p99: null },
		miss: { p50: null, p95: null, p99: null },
		anomaly: { p50: null, p95: null, p99: null },
		fill: { p50: null, p95: null, p99: null },
		hit: { p50: null, p95: null, p99: null },
	};
}

// A method+query bucket within an endpoint: cached entries (one per user/version/ip
// the key varies on) plus any anomalies (not-cached requests) sharing that shape.
export interface QueryGroup {
	key: string;
	method: string;
	query: string;
	url: string;
	entries: CacheEntry[];
	anomalies: CacheAnomaly[];
	anomalyCount: number; // total not-cached/error anomaly occurrences
	coarseCount: number; // cached entries here that over-purge (bare-tagged scoped reads)
	totalHits: number;
	totalMisses: number;
	totalFills: number;
	totalPurges: number;
	totalSize: number;
	ttlMs: number | null;
	recommendedTtlMs: number | null;
	entryCount: number;
	hitRatio: number | null; // % hits/(hits+fills); null when no traffic
	maxFillMs: number | null; // slowest fill observed here, ms
	latencies: NodeLatencies;
}

export type CacheAnomalyReason =
	| 'missing_scope'
	| 'value_too_large'
	| 'redis_error';

// Normalised to its descriptor: path/method/query come from the referenced
// directus_cache_descriptors row, so it drops into the tree at the same node.
export interface CacheAnomaly {
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

export type TtlVerdict = 'shorten' | 'lengthen' | 'ok' | null;

// Compare the data-driven recommendation to the TTL in force. A ±25% band
// avoids churn on noise; null when either side is unknown.
export function ttlVerdict(
	recommendedMs: number | null,
	currentMs: number | null,
): TtlVerdict {
	if (recommendedMs === null || currentMs === null || currentMs === 0) {
		return null;
	}

	if (recommendedMs > currentMs * 1.25) {
		return 'lengthen';
	}

	if (recommendedMs < currentMs * 0.75) {
		return 'shorten';
	}

	return 'ok';
}

export interface EndpointGroup {
	path: string;
	queries: QueryGroup[];
	entryCount: number;
	anomalyCount: number;
	coarseCount: number;
	totalHits: number;
	totalMisses: number;
	totalFills: number;
	totalPurges: number;
	totalSize: number;
	hitRatio: number | null; // % hits/(hits+fills); null when no traffic
	maxFillMs: number | null; // slowest fill observed in this endpoint, ms
	latencies: NodeLatencies;
}

// Directus system surface: the dedicated system routes + reads of a `directus_*`
// collection (and the system GraphQL schema). Everything else is app data.
const SYSTEM_SEGMENTS = new Set(
	(
		'server schema auth users roles permissions policies files folders '
		+ 'fields collections relations activity revisions presets settings flows '
		+ 'operations extensions utils translations dashboards panels notifications '
		+ 'shares comments versions metrics assets'
	).split(' '),
);

export function isSystemPath(path: string): boolean {
	const segments = path.split('/').filter(Boolean);
	const head = segments[0] ?? '';

	if (head === 'items') {
		return (segments[1] ?? '').startsWith('directus_');
	}

	if (head === 'graphql') {
		return (segments[1] ?? '') === 'system';
	}

	return SYSTEM_SEGMENTS.has(head);
}

// Coarse s/m/h/d bucket for a second count (used by age + expiry).
function coarse(seconds: number): string {
	if (seconds < 60) {
		return `${Math.max(seconds, 0)}s`;
	}

	if (seconds < 3600) {
		return `${Math.round(seconds / 60)}m`;
	}

	if (seconds < 86400) {
		return `${Math.round(seconds / 3600)}h`;
	}

	return `${Math.round(seconds / 86400)}d`;
}

export function formatAge(now: number, timestamp: number): string {
	return coarse(Math.round((now - timestamp) / 1000));
}

export function formatExpiry(
	now: number,
	expiresAt: number | null,
	expiredLabel: string,
): string {
	if (expiresAt === null) {
		return '∞';
	}

	const seconds = Math.round((expiresAt - now) / 1000);

	if (seconds <= 0) {
		return expiredLabel;
	}

	return coarse(seconds);
}

export function formatLastHit(
	now: number,
	lastHitAt: number | null,
	neverLabel: string,
): string {
	if (lastHitAt === null) {
		return neverLabel;
	}

	return formatAge(now, lastHitAt);
}

export function formatUser(
	user: { email: string | null } | null,
	publicLabel: string,
): string {
	return user?.email ?? publicLabel;
}

export function shortKey(key: string): string {
	return key.length > 12
		? `${key.slice(0, 12)}…`
		: key;
}

export function formatQuery(query: string): string {
	if (!query || query === '{}') {
		return '—';
	}

	return query;
}

// Share of cache-servable requests served from cache: hits over hits plus fills
// (a cached miss's compute). Null when nothing was served either way.
export function formatHitRatio(hits: number, fills: number): string | null {
	const percent = hitRatioPercent(hits, fills);

	return percent === null
		? null
		: `${Math.round(percent)}%`;
}

export interface EndpointSection {
	key: string;
	label: string;
	groups: EndpointGroup[];
}

// Narrow the loaded list by the filter conditions, then the free-text search.
export function filterEntries(
	rows: CacheEntry[],
	filter: Filter | null,
	search: string,
	map: Record<string, keyof CacheEntry>,
): CacheEntry[] {
	const query = search.trim().toLowerCase();

	return rows.filter((entry) => {
		const row = entry as unknown as Record<string, unknown>;

		if (!matchesFilter(row, filter, map)) {
			return false;
		}

		if (!query) {
			return true;
		}

		const haystack = [
			entry.path,
			entry.query,
			entry.user?.email,
			entry.key,
			entry.redisKey,
			entry.method,
		];

		return haystack.some((field) => field?.toLowerCase().includes(query));
	});
}

// The columns the entries table can sort by, mapped to a comparable value per
// row. "Never" / "∞" / no-traffic cells sort last, whatever the direction.
export type EntrySortField =
	| 'user'
	| 'hits'
	| 'ratio'
	| 'createdAt'
	| 'lastHitAt'
	| 'expiresAt'
	| 'size'
	| 'key';

export interface EntrySort {
	field: EntrySortField;
	dir: 1 | -1;
}

// Nulls trail whatever the direction: a row with no last hit, no expiry or no
// traffic has nothing to rank on, and floating those to the top would bury the
// rows the sort was actually asked about.
function compareNullsLast(
	a: string | number | null,
	b: string | number | null,
	dir: 1 | -1,
): number {
	if (a === null && b === null) {
		return 0;
	}

	if (a === null) {
		return 1;
	}

	if (b === null) {
		return -1;
	}

	if (a < b) {
		return -1 * dir;
	}

	if (a > b) {
		return dir;
	}

	return 0;
}

export function sortEntries(entries: CacheEntry[], sort: EntrySort): CacheEntry[] {
	const pick: Record<
		EntrySortField,
		(entry: CacheEntry) => string | number | null
	> = {
		user: (entry) => entry.user?.email ?? null,
		hits: (entry) => entry.hits,
		ratio: (entry) => {
			const total = entry.hits + entry.fills;

			return total > 0
				? entry.hits / total
				: null;
		},
		createdAt: (entry) => entry.createdAt,
		lastHitAt: (entry) => entry.lastHitAt,
		expiresAt: (entry) => entry.expiresAt,
		size: (entry) => entry.size,
		key: (entry) => entry.redisKey,
	};

	const value = pick[sort.field];

	return [...entries].sort((a, b) => {
		const av = value(a);
		const bv = value(b);

		return compareNullsLast(av, bv, sort.dir);
	});
}

// Split endpoint groups into the App / System sections, dropping empties.
export function splitSections(
	groups: EndpointGroup[],
	appLabel: string,
	systemLabel: string,
): EndpointSection[] {
	return [
		{
			key: 'app',
			label: appLabel,
			groups: groups.filter((group) => !isSystemPath(group.path)),
		},
		{
			key: 'system',
			label: systemLabel,
			groups: groups.filter((group) => isSystemPath(group.path)),
		},
	].filter((section) => section.groups.length > 0);
}

function sumHits(entries: CacheEntry[]): number {
	return entries.reduce((sum, entry) => sum + entry.hits, 0);
}

function sumMisses(entries: CacheEntry[]): number {
	return entries.reduce((sum, entry) => sum + entry.misses, 0);
}

function sumFills(entries: CacheEntry[]): number {
	return entries.reduce((sum, entry) => sum + entry.fills, 0);
}

function sumPurges(entries: CacheEntry[]): number {
	return entries.reduce((sum, entry) => sum + entry.purges, 0);
}

/**
 * The normalised balance between two counts: `(a − b) / (a + b)`.
 *
 * Algebraically this is the share `a / (a + b)` re-centred on zero and rescaled
 * to [−1, +1], which buys three things a share does not. Zero is break-even, so
 * the sign alone says whether the cache is earning its keep and a zero line can
 * be drawn. It is symmetric — swapping the two flips the sign and keeps the
 * magnitude, where a plain `a / b` squashes the whole losing half into (0, 1).
 * And it is bounded, so the axis cannot clip the very cases worth seeing.
 *
 * Null when both are zero: no traffic is not break-even, and must plot as a gap
 * rather than as a 0 the eye reads as a measurement.
 */
export function countBalance(a: number, b: number): number | null {
	const total = a + b;

	if (total === 0) {
		return null;
	}

	return (a - b) / total;
}

// Hit ratio in percent: hits' share of (hits + fills). Null when there was no
// traffic at all — the tree renders that as an em-dash, not a meaningless 0%.
export function hitRatioPercent(hits: number, fills: number): number | null {
	const traffic = hits + fills;

	if (traffic > 0) {
		return (hits / traffic) * 100;
	}

	return null;
}

function sumSize(entries: CacheEntry[]): number {
	return entries.reduce((sum, entry) => sum + entry.size, 0);
}

// Group aggregate over a nullable per-entry number: the max covers the most
// demanding sibling; null when no entry has a value.
function maxOrNull(
	entries: CacheEntry[],
	pick: (entry: CacheEntry) => number | null,
): number | null {
	const values = entries
		.map(pick)
		.filter((value): value is number => value !== null);

	return values.length > 0
		? Math.max(...values)
		: null;
}

// Total not-cached/error anomaly occurrences at a node (coarse counts on its own).
function countAnomalies(anomalies: CacheAnomaly[]): number {
	return anomalies.reduce((sum, anomaly) => sum + anomaly.count, 0);
}

// Cached entries here that over-purge — a scoped read that fell back to a bare tag.
function countCoarse(entries: CacheEntry[]): number {
	return entries.filter((entry) => entry.coarse).length;
}

// Latency rows keyed the way the tree looks them up: the endpoint rollup under
// its bare path, each query row under path+method+query.
type LatencyIndex = Map<string, NodeLatencies>;

// \x00 separator, as in the QueryGroup key: a query containing spaces can't then
// collide across method boundaries.
function queryLatencyKey(path: string, method: string, query: string): string {
	return `${path}\x00${method}\x00${query}`;
}

function indexLatencies(records: GroupLatencyRecord[]): LatencyIndex {
	const index: LatencyIndex = new Map();

	for (const record of records) {
		const key = record.method === null
			? record.path
			: queryLatencyKey(record.path, record.method, record.query ?? '');

		index.set(key, {
			response: record.response,
			miss: record.miss,
			anomaly: record.anomaly,
			fill: record.fill,
			hit: record.hit,
		});
	}

	return index;
}

// Group by method+query within an endpoint. Cached entries and anomalies (not-cached
// requests) sharing a method+query share a bucket.
function buildQueryGroups(
	path: string,
	entries: CacheEntry[],
	anomalies: CacheAnomaly[],
	latencies: LatencyIndex,
): QueryGroup[] {
	interface Bucket {
		method: string;
		query: string;
		url: string;
		entries: CacheEntry[];
		anomalies: CacheAnomaly[];
	}

	const byQuery = new Map<string, Bucket>();

	// \x00 separator so a query with spaces can't collide across method boundaries.
	function bucketFor(method: string, query: string, url: string): Bucket {
		const mapKey = `${method}\x00${query}`;
		let bucket = byQuery.get(mapKey);

		if (!bucket) {
			bucket = { method, query, url, entries: [], anomalies: [] };
			byQuery.set(mapKey, bucket);
		}

		return bucket;
	}

	for (const entry of entries) {
		bucketFor(entry.method, entry.query, entry.url).entries.push(entry);
	}

	for (const anomaly of anomalies) {
		bucketFor(anomaly.method, anomaly.query, anomaly.url).anomalies.push(anomaly);
	}

	const result: QueryGroup[] = [];

	for (const bucket of byQuery.values()) {
		result.push({
			key: `${path}\x00${bucket.method}\x00${bucket.query}`,
			method: bucket.method,
			query: bucket.query,
			url: bucket.url,
			entries: bucket.entries,
			anomalies: bucket.anomalies,
			anomalyCount: countAnomalies(bucket.anomalies),
			coarseCount: countCoarse(bucket.entries),
			totalHits: sumHits(bucket.entries),
			totalMisses: sumMisses(bucket.entries),
			totalFills: sumFills(bucket.entries),
			totalPurges: sumPurges(bucket.entries),
			totalSize: sumSize(bucket.entries),
			ttlMs: maxOrNull(bucket.entries, (entry) => entry.ttlMs),
			recommendedTtlMs: maxOrNull(bucket.entries, (entry) => entry.recommendedTtlMs),
			entryCount: bucket.entries.length,
			hitRatio: hitRatioPercent(sumHits(bucket.entries), sumFills(bucket.entries)),
			maxFillMs: maxOrNull(bucket.entries, (entry) => entry.fillMs),
			latencies: latencies.get(queryLatencyKey(path, bucket.method, bucket.query))
				?? emptyLatencies(),
		});
	}

	return result.sort((a, b) => b.totalHits - a.totalHits);
}

// Bucket entries + anomalies by endpoint path -> method+query, hottest first.
export function buildGroups(
	entries: CacheEntry[],
	anomalies: CacheAnomaly[],
	latencyRecords: GroupLatencyRecord[] = [],
): EndpointGroup[] {
	const latencies = indexLatencies(latencyRecords);

	const entriesByPath = new Map<string, CacheEntry[]>();
	const anomaliesByPath = new Map<string, CacheAnomaly[]>();

	for (const entry of entries) {
		const bucket = entriesByPath.get(entry.path) ?? [];
		bucket.push(entry);
		entriesByPath.set(entry.path, bucket);
	}

	for (const anomaly of anomalies) {
		const bucket = anomaliesByPath.get(anomaly.path) ?? [];
		bucket.push(anomaly);
		anomaliesByPath.set(anomaly.path, bucket);
	}

	const paths = new Set([...entriesByPath.keys(), ...anomaliesByPath.keys()]);
	const result: EndpointGroup[] = [];

	for (const path of paths) {
		const pathEntries = entriesByPath.get(path) ?? [];
		const pathAnomalies = anomaliesByPath.get(path) ?? [];
		const queries = buildQueryGroups(path, pathEntries, pathAnomalies, latencies);

		const anomalyCount = queries.reduce((sum, group) => sum + group.anomalyCount, 0);
		const coarseCount = queries.reduce((sum, group) => sum + group.coarseCount, 0);

		result.push({
			path,
			queries,
			entryCount: pathEntries.length,
			anomalyCount,
			coarseCount,
			totalHits: sumHits(pathEntries),
			totalMisses: sumMisses(pathEntries),
			totalFills: sumFills(pathEntries),
			totalPurges: sumPurges(pathEntries),
			totalSize: sumSize(pathEntries),
			hitRatio: hitRatioPercent(sumHits(pathEntries), sumFills(pathEntries)),
			maxFillMs: maxOrNull(pathEntries, (entry) => entry.fillMs),
			latencies: latencies.get(path) ?? emptyLatencies(),
		});
	}

	return result.sort((a, b) => b.totalHits - a.totalHits);
}

// A latency field carries its metric as well as its percentile, so the field
// alone still names a column once the toolbar's metric selection moves on.
export type LatencySortField =
	`${LatencyMetric}${Capitalize<LatencyPercentile>}`;

export function latencySortField(
	metric: LatencyMetric,
	percentile: LatencyPercentile,
): LatencySortField {
	const suffix = percentile.toUpperCase() as Capitalize<LatencyPercentile>;

	return `${metric}${suffix}`;
}

// How much of the tree to keep: `all`, or the slowest tail of it.
export type LatencyBand = LatencyPercentile | 'all';

export const LATENCY_BANDS: LatencyBand[] = ['all', 'p50', 'p95', 'p99'];

// Keep only the slowest branches, cutting at the band's own percentile of the
// distribution across branches: `p99` leaves the worst 1%, `p95` the worst 5%,
// `p50` the worst half. Ranking is on the metric's median — the figure the row
// shows — so a branch the window holds no timing for cannot be placed in the
// tail at all, and a band drops it. Input order is preserved; the caller sorts.
export function filterLatencyBand(
	groups: EndpointGroup[],
	band: LatencyBand,
	metric: LatencyMetric,
): EndpointGroup[] {
	if (band === 'all') {
		return groups;
	}

	const timed = groups.filter((group) => group.latencies[metric].p50 !== null);

	if (timed.length === 0) {
		return [];
	}

	// p99 keeps the top 1%, p95 the top 5%, p50 the top 50% — always at least one
	// branch, or picking a band on a small tree would empty the page.
	const share = (100 - Number(band.slice(1))) / 100;
	const kept = Math.max(1, Math.ceil(timed.length * share));

	const slowestFirst = [...timed].sort((a, b) => {
		return b.latencies[metric].p50! - a.latencies[metric].p50!;
	});

	const survivors = new Set(slowestFirst.slice(0, kept));

	return groups.filter((group) => survivors.has(group));
}

// Fields the tree can rank on. Each maps to a numeric pick on both node shapes.
export type GroupSortField =
	| 'hits'
	| 'misses'
	| 'fills'
	| 'purges'
	| 'ratio'
	| 'anomalies'
	| 'coarse'
	| 'entries'
	| 'size'
	| 'fillMs'
	| LatencySortField;

export interface GroupSort {
	field: GroupSortField;
	dir: 1 | -1; // 1 ascending, -1 descending
}

// Numeric pick that both EndpointGroup and QueryGroup satisfy. Null (e.g. no
// traffic for a ratio) sorts last regardless of direction.
type SortableNode = {
	totalHits: number;
	totalMisses: number;
	totalFills: number;
	totalPurges: number;
	totalSize: number;
	entryCount: number;
	hitRatio: number | null;
	anomalyCount: number;
	coarseCount: number;
	maxFillMs: number | null;
	latencies: NodeLatencies;
};

// Exhaustive by construction: a new GroupSortField won't compile until it has an
// accessor here.
const SORT_VALUES: Record<GroupSortField, (node: SortableNode) => number | null> = {
	hits: (node) => node.totalHits,
	misses: (node) => node.totalMisses,
	fills: (node) => node.totalFills,
	purges: (node) => node.totalPurges,
	ratio: (node) => node.hitRatio,
	anomalies: (node) => node.anomalyCount,
	coarse: (node) => node.coarseCount,
	entries: (node) => node.entryCount,
	size: (node) => node.totalSize,
	fillMs: (node) => node.maxFillMs,
	responseP50: (node) => node.latencies.response.p50,
	responseP95: (node) => node.latencies.response.p95,
	responseP99: (node) => node.latencies.response.p99,
	missP50: (node) => node.latencies.miss.p50,
	missP95: (node) => node.latencies.miss.p95,
	missP99: (node) => node.latencies.miss.p99,
	anomalyP50: (node) => node.latencies.anomaly.p50,
	anomalyP95: (node) => node.latencies.anomaly.p95,
	anomalyP99: (node) => node.latencies.anomaly.p99,
	fillP50: (node) => node.latencies.fill.p50,
	fillP95: (node) => node.latencies.fill.p95,
	fillP99: (node) => node.latencies.fill.p99,
	hitP50: (node) => node.latencies.hit.p50,
	hitP95: (node) => node.latencies.hit.p95,
	hitP99: (node) => node.latencies.hit.p99,
};

// Stable clone + sort by a field; nulls always trail. `dir: 1` puts worst first
// for ratio (lowest %), `dir: -1` worst first for the count/max fields.
export function sortGroups<T extends SortableNode>(
	groups: T[],
	sort: GroupSort,
): T[] {
	return [...groups].sort((a, b) => {
		const av = SORT_VALUES[sort.field](a);
		const bv = SORT_VALUES[sort.field](b);

		return compareNullsLast(av, bv, sort.dir);
	});
}

export interface AnomalySummaryItem {
	reason: CacheAnomalyReason;
	count: number;
}

// Total occurrences per reason for the summary strip above the tree.
export function summariseAnomalies(anomalies: CacheAnomaly[]): AnomalySummaryItem[] {
	const byReason = new Map<CacheAnomalyReason, number>();

	for (const anomaly of anomalies) {
		byReason.set(
			anomaly.reason,
			(byReason.get(anomaly.reason) ?? 0) + anomaly.count,
		);
	}

	return [...byReason.entries()]
		.map(([reason, count]) => ({ reason, count }))
		.sort((a, b) => b.count - a.count);
}

// Narrow anomalies by the free-text search (path / query / reason).
export function filterAnomalies(
	anomalies: CacheAnomaly[],
	search: string,
): CacheAnomaly[] {
	const query = search.trim().toLowerCase();

	if (!query) {
		return anomalies;
	}

	return anomalies.filter((anomaly) => {
		return [anomaly.path, anomaly.query, anomaly.reason].some((field) => {
			return field?.toLowerCase().includes(query);
		});
	});
}

// A plotted point: [epoch ms, value] where value is null for an unsampled bucket.
export type TimeseriesPoint = [number, number | null];

// A chart value formatted by its metric's unit: a count as a plain integer, a
// seconds value as a human duration; null/undefined as an em dash.
export type TooltipUnit = 'count' | 'seconds' | 'percent' | 'balance';

export function formatTooltipValue(
	raw: number | null | undefined,
	unit: TooltipUnit,
): string {
	if (raw == null) {
		return '—';
	}

	if (unit === 'seconds') {
		return formatDuration(raw);
	}

	if (unit === 'balance') {
		// Signed and to two places: the sign is the verdict, and rounding to whole
		// numbers would collapse the whole [-1, 1] range onto three values.
		const sign = raw > 0
			? '+'
			: '';

		return `${sign}${raw.toFixed(2)}`;
	}

	return unit === 'percent'
		? `${Math.round(raw)}%`
		: String(Math.round(raw));
}

// TTL is a persistent config value: a bucket with no sample (null) hasn't changed
// it, so carry the last known value forward (and back-fill the lead) to keep the
// curve continuous instead of broken across unsampled buckets.
export function carryForward(points: TimeseriesPoint[]): TimeseriesPoint[] {
	let last: number | null = null;

	const forward = points.map(([t, value]): TimeseriesPoint => {
		if (value !== null) {
			last = value;
		}

		return [t, last];
	});

	const firstKnown = forward.find(([, value]) => value !== null)?.[1] ?? null;

	return forward.map(([t, value]): TimeseriesPoint => {
		return [t, value ?? firstKnown];
	});
}
