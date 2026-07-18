import type { Filter } from '@directus/types';
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
	fillMs: number | null;
	hitMs: number | null;
	ttlMs: number | null;
	recommendedTtlMs: number | null;
	coarse: boolean; // scoped collection tagged bare — over-purges (a tuning signal)
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
	totalSize: number;
	ttlMs: number | null;
	recommendedTtlMs: number | null;
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
	totalSize: number;
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
		return path.startsWith('/graphql/system');
	}

	return SYSTEM_SEGMENTS.has(head);
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export interface EndpointSection {
	key: string;
	label: string;
	groups: EndpointGroup[];
}

// Narrow the loaded list by the filter conditions, then the free-text search.
export function filterEntries(
	entries: CacheEntry[],
	filter: Filter | null,
	search: string,
	fieldMap: Record<string, string>,
): CacheEntry[] {
	const query = search.trim().toLowerCase();

	return entries.filter((entry) => {
		const row = entry as unknown as Record<string, unknown>;

		if (!matchesFilter(row, filter, fieldMap)) {
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

// Group by method+query within an endpoint. Cached entries and anomalies (not-cached
// requests) sharing a method+query share a bucket.
function buildQueryGroups(
	path: string,
	entries: CacheEntry[],
	anomalies: CacheAnomaly[],
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
			key: `${path} ${bucket.method} ${bucket.query}`,
			method: bucket.method,
			query: bucket.query,
			url: bucket.url,
			entries: bucket.entries,
			anomalies: bucket.anomalies,
			anomalyCount: countAnomalies(bucket.anomalies),
			coarseCount: countCoarse(bucket.entries),
			totalHits: sumHits(bucket.entries),
			totalSize: sumSize(bucket.entries),
			ttlMs: maxOrNull(bucket.entries, (entry) => entry.ttlMs),
			recommendedTtlMs: maxOrNull(bucket.entries, (entry) => entry.recommendedTtlMs),
		});
	}

	return result.sort((a, b) => b.totalHits - a.totalHits);
}

// Bucket entries + anomalies by endpoint path -> method+query, hottest first.
export function buildGroups(
	entries: CacheEntry[],
	anomalies: CacheAnomaly[],
): EndpointGroup[] {
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
		const queries = buildQueryGroups(path, pathEntries, pathAnomalies);

		const anomalyCount = queries.reduce((sum, group) => sum + group.anomalyCount, 0);
		const coarseCount = queries.reduce((sum, group) => sum + group.coarseCount, 0);

		result.push({
			path,
			queries,
			entryCount: pathEntries.length,
			anomalyCount,
			coarseCount,
			totalHits: sumHits(pathEntries),
			totalSize: sumSize(pathEntries),
		});
	}

	return result.sort((a, b) => b.totalHits - a.totalHits);
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
