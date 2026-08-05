<script setup lang="ts">
import api from '@/api';
import { useClipboard } from '@/composables/use-clipboard';
import { formatDuration } from '@/utils/format-duration';
import { formatFilesize } from '@/utils/format-filesize';
import { getRootPath } from '@/utils/get-root-path';
import { useSettingsStore } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
import { useLocalStorage } from '@vueuse/core';
import ApexCharts, { type ApexOptions } from 'apexcharts';
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { abbreviateNumber } from '@directus/utils';
import type {
	CacheFlushTarget,
	CacheTimeseries,
	CacheTimeseriesBucket,
	Filter,
	User,
} from '@directus/types';
import SettingsNavigation from '../../components/navigation.vue';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import SearchInput from '@/views/private/components/search-input.vue';
import {
	buildGroups,
	carryForward,
	filterAnomalies,
	filterEntries,
	filterLatencyBand,
	formatAge,
	formatExpiry,
	formatLastHit,
	formatQuery,
	formatHitRatio,
	formatTooltipValue,
	type TooltipUnit,
	formatUser,
	hitRatioPercent,
	shortKey,
	sortEntries,
	sortGroups,
	LATENCY_BANDS,
	LATENCY_METRICS,
	LATENCY_PERCENTILES,
	latencySortField,
	splitSections,
	summariseAnomalies,
	ttlVerdict,
	type CacheAnomaly,
	type CacheAnomalyReason,
	type CacheEntry,
	type EndpointGroup,
	type EntrySort,
	type EntrySortField,
	type GroupSort,
	type GroupSortField,
	type GroupLatencyRecord,
	type LatencyBand,
	type LatencyMetric,
	type QueryGroup,
} from './cache-view';

// The filter builder is keyed by the descriptor collection's field names; map
// them back to this page's row shape so its conditions can run client-side.
const FILTER_FIELD_MAP: Record<string, keyof CacheEntry> = {
	cache_key: 'key',
	method: 'method',
	path: 'path',
	collection: 'collection',
	user_id: 'user',
	query: 'query',
	url: 'url',
	bytes: 'size',
	last_filled: 'createdAt',
};

const PAGE_SIZE = 25;

defineOptions({ name: 'SettingsCache' });

const { t } = useI18n();
const { copyToClipboard } = useClipboard();

const loading = ref(false);
const error = ref<string | null>(null);
const entries = ref<CacheEntry[]>([]);
const anomalies = ref<CacheAnomaly[]>([]);
const latencies = ref<GroupLatencyRecord[]>([]);
const expanded = ref<Record<string, boolean>>({});
const now = ref(Date.now());
const search = ref('');
const filter = ref<Filter | null>(null);
const entryPage = ref<Record<string, number>>({});

// Per-query sort state for the entries table; empty = the API's original order.
const entrySort = ref<Record<string, EntrySort>>({});

// A search/filter change reshapes every group, so reset paging + sorting to the
// first/original state — else the saved deep page and column order strand the user
// on a tail slice of the filtered set.
watch([search, filter], () => {
	entryPage.value = {};
	entrySort.value = {};
});

// How far back the listing looks — sent as ?window= to the API, which clamps it
// to [1m, max]. The sub-hour steps pair with a live short refresh interval. The
// select's allow-other entry accepts any ms()-parsable duration (e.g. "90m",
// "3h30m"); unparseable input falls back to the 24h default server-side.
const windowOptions = [
	{ text: t('cache_window_1m', 'Last 1m'), value: '1m' },
	{ text: t('cache_window_3m', 'Last 3m'), value: '3m' },
	{ text: t('cache_window_5m', 'Last 5m'), value: '5m' },
	{ text: t('cache_window_10m', 'Last 10m'), value: '10m' },
	{ text: t('cache_window_15m', 'Last 15m'), value: '15m' },
	{ text: t('cache_window_30m', 'Last 30m'), value: '30m' },
	{ text: t('cache_window_1h', 'Last 1h'), value: '1h' },
	{ text: t('cache_window_6h', 'Last 6h'), value: '6h' },
	{ text: t('cache_window_24h', 'Last 24h'), value: '24h' },
	{ text: t('cache_window_7d', 'Last 7d'), value: '7d' },
	{ text: t('cache_window_15d', 'Last 15d'), value: '15d' },
	{ text: t('cache_window_21d', 'Last 21d'), value: '21d' },
	{ text: t('cache_window_30d', 'Last 30d'), value: '30d' },
];

const userStore = useUserStore();
const userId = (userStore.currentUser as User | null)?.id ?? 'anon';

// Persist the window + refresh interval per-user so a reload restores the same
// view (like the flush targets below).
const selectedWindow = useLocalStorage(`cache-window-${userId}`, '24h');

// vueuse's serializer for a null default is identity (stores/returns a raw string),
// which would break the number|null contract; coerce so the interval round-trips as
// a real number (empty = off).
const refreshInterval = useLocalStorage<number | null>(
	`cache-refresh-${userId}`,
	null,
	{
		serializer: {
			read: (value) => {
				return value
					? Number(value)
					: null;
			},
			write: (value) => {
				return value === null
					? ''
					: String(value);
			},
		},
	},
);

// Bumped per load; a superseded window's late response can't clobber a newer one.
let loadToken = 0;

// Drawer version of loadToken: a per-open token so a late /entry response (even a
// same-key reopen) can't overwrite a newer open; a close discards it entirely.
let entryToken = 0;

// Chart's own token: loadTimeseries fires from load() (per window/refresh) and from
// saveTtl(); a superseded fetch can't clobber the chart with out-of-order buckets.
let timeseriesToken = 0;

// Runtime collection state (Redis-backed). `configured` is the env opt-in: when
// false the toggle is hidden, since the flag can only narrow, never widen it.
const statsState = ref<{
	configured: boolean;
	enabled: boolean;
	killedReason: string | null;
	bufferLength: number;
} | null>(null);

const statsToggling = ref(false);

const statsTooltip = computed(() => {
	if (statsState.value?.killedReason) {
		return t('cache_stats_killed', 'Cache stats auto-disabled: {reason}', {
			reason: statsState.value.killedReason,
		});
	}

	if (statsState.value?.enabled) {
		const base = t('cache_stats_disable', 'Disable cache stats collection');

		// Surface the un-flushed Redis buffer backlog (watchdog territory).
		return statsState.value.bufferLength > 0
			? `${base} · ${t('cache_stats_buffered', '{count} buffered', {
				count: statsState.value.bufferLength,
			})}`
			: base;
	}

	return t('cache_stats_enable', 'Enable cache stats collection');
});

const selectedEntry = ref<CacheEntry | null>(null);
const cachedValue = ref<unknown>(null);
const cachedValueExists = ref(false);
const cachedTags = ref<string[] | null>(null);
const cachedTagCounts = ref<Record<string, number>>({});
const cachedTombstone = ref<number | null>(null);

const cachedExpiry = ref<
	{ exp: number; createdAt: number; ttlMs: number | null } | null
>(null);

const cachedSizes = ref<
	{ uncompressed: number; compressed: number } | null
>(null);

const valueLoading = ref(false);

// Descriptor columns (from Postgres) shown as readonly rows in the detail drawer.
const detailFields = computed(() => {
	const entry = selectedEntry.value;

	if (!entry) {
		return [];
	}

	return [
		{ label: t('method', 'Method'), value: entry.method },
		{ label: t('path', 'Path'), value: entry.path },
		{ label: t('collection', 'Collection'), value: entry.collection ?? '—' },
		{ label: t('user_label', 'User'), value: userOf(entry.user) },
		{ label: t('query', 'Query'), value: formatQuery(entry.query) },
		{ label: t('url', 'URL'), value: entry.url || '—' },
		{ label: t('size', 'Size'), value: formatFilesize(entry.size) },
		{ label: t('hits', 'Hits'), value: String(entry.hits) },
		{ label: t('compute_miss', 'Compute (miss)'), value: msLabel(entry.fillMs) },
		{ label: t('serve_hit', 'Serve (hit avg)'), value: msLabel(entry.hitMs) },
		{ label: t('recommended_ttl', 'Recommended TTL'), value: recTtlLabel(entry) },
		{ label: t('age', 'Age'), value: ageOf(entry.createdAt) },
		{ label: t('last_hit', 'Last hit'), value: lastHitOf(entry.lastHitAt) },
		{ label: t('expires_in', 'Expires in'), value: expiryOf(entry.expiresAt) },
		{ label: t('key', 'Key'), value: entry.redisKey },
	];
});

const prettyValue = computed(() => {
	try {
		return JSON.stringify(cachedValue.value, null, 2);
	}
	catch {
		return String(cachedValue.value);
	}
});

// Why the live value is gone: expiry is certain (past its TTL); a coarse key gone
// before its TTL was almost surely over-purged by a sibling collection mutation.
const absentReason = computed(() => {
	const entry = selectedEntry.value;

	if (!entry) {
		return t('cache_value_absent', 'Not in the cache');
	}

	// Round to whole seconds like the "Expires in" column so both flip to "expired"
	// at the same instant, not up to a second apart.
	if (
		entry.expiresAt !== null
		&& Math.round((entry.expiresAt - now.value) / 1000) <= 0
	) {
		return t('cache_value_expired', 'Not in the cache — expired (TTL elapsed)');
	}

	if (entry.coarse) {
		return t(
			'cache_value_coarse',
			'Evicted before TTL — likely a coarse-scope purge (a collection mutation)',
		);
	}

	return t(
		'cache_value_evicted',
		'Evicted before TTL — a scoped purge or memory eviction',
	);
});

// Configured TTL off the live Redis __expires_at sidecar (null = no sidecar).
const ttlLabel = computed(() => {
	if (!cachedExpiry.value) {
		return null;
	}

	return cachedExpiry.value.ttlMs === null
		? '∞'
		: `${Math.round(cachedExpiry.value.ttlMs / 1000)}s`;
});

function formatTime(ms: number): string {
	return new Date(ms).toLocaleString();
}

// Live Redis metadata rows for the drawer (footprint, precise timestamps, the
// tombstone, and which dimensions the opaque cache key varies on).
const redisFields = computed(() => {
	const rows: { label: string; value: string }[] = [];
	const sizes = cachedSizes.value;
	const expiry = cachedExpiry.value;

	if (sizes) {
		const ratio = sizes.uncompressed > 0
			? Math.round((sizes.compressed / sizes.uncompressed) * 100)
			: 0;

		const packed = formatFilesize(sizes.compressed);
		const raw = formatFilesize(sizes.uncompressed);

		rows.push({
			label: t('size', 'Size'),
			value: `${packed} / ${raw} raw (${ratio}%)`,
		});
	}

	if (expiry) {
		rows.push({
			label: t('filled_at', 'Filled at'),
			value: formatTime(expiry.createdAt),
		});

		rows.push({
			label: t('expires_at', 'Expires at'),
			value: formatTime(expiry.exp),
		});
	}

	if (ttlLabel.value) {
		rows.push({ label: t('ttl', 'TTL'), value: ttlLabel.value });
	}

	if (cachedTombstone.value) {
		rows.push({
			label: t('last_expired', 'Last expired'),
			value: formatTime(cachedTombstone.value),
		});
	}

	rows.push({
		label: t('key_varies_on', 'Key varies on'),
		value: 'version · user · path · query · ip',
	});

	return rows;
});

const searchedEntries = computed(() => {
	return filterEntries(entries.value, filter.value, search.value, FILTER_FIELD_MAP);
});

const searchedAnomalies = computed(() => {
	return filterAnomalies(anomalies.value, search.value);
});

const anomalySummary = computed(() => summariseAnomalies(searchedAnomalies.value));

const groups = computed<EndpointGroup[]>(() => {
	const built = filterLatencyBand(
		buildGroups(searchedEntries.value, searchedAnomalies.value, latencies.value),
		treeBand.value,
		selectedMetric.value,
	);

	const sort: GroupSort = {
		field: treeSortField.value,
		dir: treeSortDir.value,
	};

	return sortGroups(built, sort).map((endpoint) => {
		return {
			...endpoint,
			queries: sortGroups(endpoint.queries, sort),
		};
	});
});

// Tree discovery control: rank both tree levels by the same field, worst-first
// for the discovery fields.
const treeSortField = useLocalStorage<GroupSortField>(
	`cache-tree-sort-field-${userId}`,
	'hits',
);

const treeSortDir = useLocalStorage<1 | -1>(`cache-tree-sort-dir-${userId}`, -1);

// Which measurement the tree's latency column reports, named as the chart above
// names its curves so one word means one thing on the whole page.
const treeLatencyMetric = useLocalStorage<LatencyMetric>(
	`cache-tree-latency-metric-${userId}`,
	'response',
);

// A stored preference outlives the code that wrote it, so a metric that has since
// been renamed or dropped must not reach the row as an undefined percentile set.
const selectedMetric = computed<LatencyMetric>(() => {
	return LATENCY_METRICS.includes(treeLatencyMetric.value)
		? treeLatencyMetric.value
		: 'response';
});

const treeMetricOptions: { text: string; value: LatencyMetric }[] = [
	{ text: t('cache_lat_response', 'Response'), value: 'response' },
	{ text: t('cache_lat_miss', 'Misses'), value: 'miss' },
	{ text: t('cache_lat_anomaly', 'Anomalies'), value: 'anomaly' },
	{ text: t('cache_lat_fill', 'Fills'), value: 'fill' },
	{ text: t('cache_lat_hit', 'Hits'), value: 'hit' },
];

// How much of the tree to keep: everything, or only its slowest tail. One band at
// a time — two bands at once would just mean the wider of the two.
const treeBand = useLocalStorage<LatencyBand>(`cache-tree-band-${userId}`, 'all');

const treeBandOptions = LATENCY_BANDS.map((band) => {
	if (band === 'all') {
		return { text: t('cache_tree_band_all', 'All'), value: band };
	}

	// The percentile names where the cut falls, the label what survives it: p99
	// keeps the slowest 1%.
	const keptPercent = 100 - Number(band.slice(1));

	return {
		text: t(`cache_tree_band_${band}`, `${band}: Slowest ${keptPercent}%`),
		value: band,
	};
});

function metricName(metric: LatencyMetric): string {
	const option = treeMetricOptions.find((candidate) => {
		return candidate.value === metric;
	});

	return option?.text ?? metric;
}

const metricLabel = computed(() => metricName(selectedMetric.value));

const treeSortOptions = computed<{ text: string; value: GroupSortField }[]>(() => {
	const latencyOptions = LATENCY_PERCENTILES.map((percentile) => {
		return {
			text: `${metricLabel.value} ${percentile}`,
			value: latencySortField(selectedMetric.value, percentile),
		};
	});

	return [
		// The funnel first, in the tree's own column order, then the fields that
		// don't sit on it.
		{ text: t('cache_tree_sort_misses', 'Misses'), value: 'misses' },
		{ text: t('cache_tree_sort_anomalies', 'Anomalies'), value: 'anomalies' },
		{ text: t('cache_tree_sort_fills', 'Fills'), value: 'fills' },
		{ text: t('cache_tree_sort_hits', 'Hits'), value: 'hits' },
		{ text: t('cache_tree_sort_ratio', 'Hit ratio'), value: 'ratio' },
		{ text: t('cache_tree_sort_coarse', 'Coarse'), value: 'coarse' },
		{ text: t('cache_tree_sort_entries', 'Entries'), value: 'entries' },
		{ text: t('cache_tree_sort_size', 'Size'), value: 'size' },
		{ text: t('cache_tree_sort_fill_ms', 'Slowest fill'), value: 'fillMs' },
		...latencyOptions,
	];
});

// Deselecting the percentile — or switching metric — leaves the tree ranked by a
// column the toolbar no longer offers; fall back to the default ranking instead.
watch(treeSortOptions, (options) => {
	const stillOffered = options.some((option) => {
		return option.value === treeSortField.value;
	});

	if (!stillOffered) {
		treeSortField.value = 'hits';
	}
});

const sections = computed(() => {
	return splitSections(
		groups.value,
		t('app_label', 'App'),
		t('system_label', 'System'),
	);
});

// Totals track the filtered list, matching the endpoint count under a filter.
const totalEntries = computed(() => searchedEntries.value.length);

async function load() {
	const token = ++loadToken;
	loading.value = true;
	error.value = null;

	// The chart tracks the same window; fetch it alongside (its own error handling).
	void loadTimeseries();

	try {
		// Fetch both together and assign in one go: entries + anomalies feed one group
		// tree, so a staggered assign would flash a phantom old-window anomaly node.
		const [entriesRes, anomaliesRes, latenciesRes] = await Promise.all([
			api.get('/utils/cache', {
				params: { window: selectedWindow.value },
			}),
			api.get('/utils/cache/anomalies', {
				params: { window: selectedWindow.value },
			}).catch(() => ({ data: { data: [] } })),
			api.get('/utils/cache/latencies', {
				params: { window: selectedWindow.value },
			}).catch(() => ({ data: { data: [] } })),
		]);

		if (token !== loadToken) {
			return;
		}

		entries.value = entriesRes.data.data;
		anomalies.value = anomaliesRes.data.data;
		latencies.value = latenciesRes.data.data;
		now.value = Date.now();
	}
	catch (err: any) {
		if (token === loadToken) {
			error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
		}
	}
	finally {
		if (token === loadToken) {
			loading.value = false;
		}
	}
}

function anomalyLabel(reason: CacheAnomalyReason): string {
	const labels: Record<CacheAnomalyReason, string> = {
		missing_scope: t('cache_anomaly_missing_scope', 'Not cached · missing scope'),
		value_too_large: t('cache_anomaly_value_too_large', 'Not cached · too large'),
		redis_error: t('cache_anomaly_redis_error', 'Redis error'),
	};

	return labels[reason] ?? reason;
}

const coarseHint = computed(() => {
	return t(
		'cache_coarse_hint',
		'Not value-pinned — over-purges; add a filter on the scoped field.',
	);
});

async function loadStatsState() {
	try {
		const response = await api.get('/utils/cache/stats');
		statsState.value = response.data.data;
	}
	catch {
		statsState.value = null;
	}
}

// Flip collection at runtime (Redis flag; every node picks it up at once via the
// bus). Re-enabling also clears an autokill reason server-side.
async function toggleStats() {
	if (!statsState.value || statsToggling.value) {
		return;
	}

	statsToggling.value = true;

	try {
		await api.patch('/utils/cache/stats', {
			enabled: !statsState.value.enabled,
		});

		await loadStatsState();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		statsToggling.value = false;
	}
}

async function evictEntry(entry: CacheEntry) {
	error.value = null;
	closeEntry(); // the value is about to be gone; don't leave the drawer showing it as live

	try {
		await api.delete('/utils/cache', { params: { key: entry.redisKey } });
		await load();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
}

async function evictPath(path: string) {
	error.value = null;
	closeEntry(); // the open entry may belong to this path; don't leave it showing as live

	try {
		await api.delete('/utils/cache', { params: { path } });
		await load();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
}

const settingsStore = useSettingsStore();

// The persisted global TTL. `ttlDraft` edits the input; saving PATCHes
// directus_settings.cache_ttl, which the API broadcasts so every node's live
// override flips at once. Empty = inherit env CACHE_TTL; only new entries take it.
const ttlDraft = ref('');
const ttlSaving = ref(false);

watch(
	() => settingsStore.settings?.cache_ttl,
	(value) => {
		ttlDraft.value = value ?? '';
	},
	{ immediate: true },
);

const ttlDirty = computed(() => {
	return ttlDraft.value !== (settingsStore.settings?.cache_ttl ?? '');
});

async function saveTtl() {
	if (!ttlDirty.value || ttlSaving.value) {
		return;
	}

	ttlSaving.value = true;

	try {
		await settingsStore.updateSettings({ cache_ttl: ttlDraft.value.trim() || null });
		// Surface the new ttl-change marker on the chart without a full reload.
		await loadTimeseries();
	}
	finally {
		ttlSaving.value = false;
	}
}

const flushTargetOptions = [
	{ text: t('cache_flush_response', 'Response'), value: 'response' },
	{ text: t('cache_flush_system', 'System'), value: 'system' },
	{ text: t('cache_flush_locks', 'Locks'), value: 'locks' },
];

// The flush target subset is a pure UI preference → per-user localStorage, so
// chained purges keep the last selection without re-picking it each time.
const flushTargets = useLocalStorage<CacheFlushTarget[]>(
	`cache-flush-targets-${userId}`,
	['response'],
);

const flushing = ref(false);

async function flush() {
	if (flushing.value || flushTargets.value.length === 0) {
		return;
	}

	flushing.value = true;
	error.value = null;

	try {
		await api.post('/utils/cache/clear', null, {
			params: { targets: flushTargets.value },
		});

		await load();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		flushing.value = false;
	}
}

const timeseries = ref<CacheTimeseries>({
	buckets: [],
	markers: [],
	effectiveTtl: null,
});

const ttlPlaceholder = computed(() => {
	// Concatenated, not interpolated: the inline i18n fallback doesn't fill {ttl}.
	return timeseries.value.effectiveTtl
		? `${t('cache_ttl_default', 'Default')}: ${timeseries.value.effectiveTtl}`
		: t('cache_ttl_placeholder', 'TTL e.g. 30m');
});

// Hits + misses are the window's request outcomes — both summed off the same
// timeseries the chart plots, so the two metrics stay comparable (the entries
// listing only carries per-entry hit counts, never misses).
const totalHits = computed(() => {
	return timeseries.value.buckets.reduce((sum, b) => sum + b.hits, 0);
});

const totalMisses = computed(() => {
	return timeseries.value.buckets.reduce((sum, b) => sum + b.misses, 0);
});

const totalFills = computed(() => {
	return timeseries.value.buckets.reduce((sum, b) => sum + b.fills, 0);
});

// Share of cache-servable traffic served from cache — hits over hits plus fills.
const totalRatio = computed(() => {
	return formatHitRatio(totalHits.value, totalFills.value) ?? '—';
});

// Median of the per-bucket p50s over the window — a single central response-time
// number for the summary, formatted or an em-dash when nothing was sampled.
function medianMs(values: (number | null)[]): string {
	const nums = values.filter((v): v is number => v != null).sort((a, b) => a - b);

	if (nums.length === 0) {
		return '—';
	}

	const mid = Math.floor(nums.length / 2);

	const median = nums.length % 2 === 0
		? (nums[mid - 1]! + nums[mid]!) / 2
		: nums[mid]!;

	return `${Math.round(median)}ms`;
}

const medianResponse = computed(() => {
	return medianMs(timeseries.value.buckets.map((b) => b.bothP50));
});

const medianMiss = computed(() => {
	return medianMs(timeseries.value.buckets.map((b) => b.missP50));
});

const medianHit = computed(() => {
	return medianMs(timeseries.value.buckets.map((b) => b.hitP50));
});

const totalAnomalies = computed(() => {
	return searchedAnomalies.value.reduce((sum, a) => sum + a.count, 0);
});

const chartEl = ref<HTMLElement | null>(null);
let chart: ApexCharts | null = null;

const latencyChartEl = ref<HTMLElement | null>(null);
let latencyChart: ApexCharts | null = null;

// Legend visibility persisted per chart, so a hidden/shown series survives a reload
// and the per-second refresh. Latency defaults to the p50 medians plus the p99 tail
// (only the p95 bands are hidden until the user opts in via the legend).
const countsHiddenSeries = useLocalStorage<string[]>(
	`cache-counts-hidden-${userId}`,
	[],
);

const latencyHiddenSeries = useLocalStorage<string[]>(
	`cache-latency-hidden-${userId}`,
	latencyLines()
		.filter((line) => line.dash === 4)
		.map((line) => line.name),
);

function toggleHiddenSeries(store: Ref<string[]>, name: string) {
	store.value = store.value.includes(name)
		? store.value.filter((entry) => entry !== name)
		: [...store.value, name];
}

// The latency chart's legend is 3 rows — one per percentile (p50/p95/p99) — each
// listing its 5 category curves. The rows and entries come from latencyLines() so
// a future percentile or category stays in sync.
const latencyPercentiles = computed(() => {
	const seen: string[] = [];

	for (const line of latencyLines()) {
		const percentile = line.name.split(' ').pop()!;

		if (!seen.includes(percentile)) {
			seen.push(percentile);
		}
	}

	return seen;
});

// The per-category legend entries of one percentile row ("Hits", "Fills", ...).
function latencyEntries(
	percentile: string,
): { name: string; label: string; color: string }[] {
	return latencyLines()
		.filter((line) => line.name.endsWith(` ${percentile}`))
		.map((line) => {
			return {
				name: line.name,
				label: line.name.slice(0, -percentile.length - 1),
				color: line.color,
			};
		});
}

function isLatencyEntryHidden(name: string): boolean {
	return latencyHiddenSeries.value.includes(name);
}

function toggleLatencyEntry(name: string) {
	toggleHiddenSeries(latencyHiddenSeries, name);

	if (!latencyChart) {
		return;
	}

	try {
		if (isLatencyEntryHidden(name)) {
			latencyChart.hideSeries(name);
		}
		else {
			latencyChart.showSeries(name);
		}
	}
	catch {
		// A series with no samples in the window isn't rendered; apex then
		// derefs a null node. Nothing to toggle — skip it.
	}
}

// Reassert stored visibility after each (re)render — apex resets legend toggles on
// updateOptions, so this re-hides on every refresh and on first paint.
function applyHiddenSeries(instance: ApexCharts | null, hidden: string[]) {
	if (!instance) {
		return;
	}

	// apex resolves its render/updateOptions promise before the internal series
	// registry (`w.globals.seriesNames`) is populated — reliably so in a production
	// build — and hideSeries then derefs a null legend node. Wait a frame for the
	// series to register before hiding, so the toggle actually lands.
	const seriesReady = () => {
		const names = (instance as ApexCharts & {
			w?: { globals?: { seriesNames?: string[] } };
		}).w?.globals?.seriesNames;

		return Array.isArray(names) && names.length > 0;
	};

	const hide = (tries: number) => {
		if (!seriesReady() && tries > 0) {
			requestAnimationFrame(() => hide(tries - 1));
			return;
		}

		for (const name of hidden) {
			try {
				instance.hideSeries(name);
			}
			catch {
				// A series with no samples in the window isn't rendered; apex's
				// hideSeries then derefs a null node. Nothing to hide — skip it.
			}
		}
	};

	hide(12);
}

// Show the chart once there's anything to plot — sample counts or a config marker —
// so a stats-off page with no markers doesn't render an empty axis.
const hasTimeseries = computed(() => {
	return timeseries.value.markers.length > 0
		|| timeseries.value.buckets.some((b) => b.hits || b.misses || b.anomalies);
});

// The latency chart appears only once a bucket carries a percentile sample.
const hasLatency = computed(() => {
	return timeseries.value.buckets.some((b) => {
		return typeof b.hitP50 === 'number' || typeof b.missP50 === 'number';
	});
});

async function loadTimeseries() {
	const token = ++timeseriesToken;

	try {
		const response = await api.get('/utils/cache/timeseries', {
			params: { window: selectedWindow.value, buckets: 60 },
		});

		if (token !== timeseriesToken) {
			return;
		}

		// Normalise so buckets/markers are always arrays — the chart's series() and
		// hasTimeseries read them directly and must never see an undefined.
		const data = response.data.data;

		timeseries.value = {
			buckets: Array.isArray(data?.buckets)
				? data.buckets
				: [],
			markers: Array.isArray(data?.markers)
				? data.markers
				: [],
			effectiveTtl: data?.effectiveTtl ?? null,
		};
	}
	catch {
		if (token !== timeseriesToken) {
			return;
		}

		timeseries.value = { buckets: [], markers: [], effectiveTtl: null };
	}
}

function themeVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();

	return value || fallback;
}

function chartConfig(): ApexOptions {
	const buckets = timeseries.value.buckets;

	function series(pick: (b: CacheTimeseriesBucket) => number | null) {
		return buckets.map((b): [number, number | null] => [b.t, pick(b)]);
	}

	// Single source of truth for each plotted metric: name, unit and line style
	// travel together so the tooltip, both y-axes and the stroke can't drift out
	// of series order (apexcharts indexes formatters by positional seriesIndex).
	const metrics: {
		name: string;
		unit: TooltipUnit;
		curve: 'straight' | 'stepline';
		// Dashed marks a line that isn't on the Count axis, so a percentage can't
		// be read against the counts it sits among.
		dash: number;
		color: string;
		pick: (b: CacheTimeseriesBucket) => number | null;
	}[] = [
		{
			// Every request the cache answered, however it answered it — the line the
			// hit/miss split below adds up to.
			name: t('cache_responses', 'Responses'),
			unit: 'count',
			curve: 'straight',
			dash: 0,
			color: themeVar('--theme--foreground-subdued', '#a2b5cd'),
			pick: (b) => b.hits + b.misses,
		},
		{
			name: t('cache_misses', 'Misses'),
			unit: 'count',
			curve: 'straight',
			dash: 0,
			color: themeVar('--theme--warning', '#ffa439'),
			pick: (b) => b.misses,
		},
		{
			name: t('cache_anomalies', 'Anomalies'),
			unit: 'count',
			curve: 'straight',
			dash: 0,
			color: themeVar('--theme--danger', '#e35169'),
			pick: (b) => b.anomalies,
		},
		{
			name: t('cache_fills', 'Fills'),
			unit: 'count',
			curve: 'straight',
			dash: 0,
			color: themeVar('--theme--secondary', '#3399ff'),
			pick: (b) => b.fills,
		},
		{
			name: t('hits', 'Hits'),
			unit: 'count',
			curve: 'straight',
			dash: 0,
			color: themeVar('--theme--success', '#2ecda7'),
			pick: (b) => b.hits,
		},
		{
			// Same definition as the summary metric and the tree column: the share of
			// cache-servable requests that were served from cache.
			name: t('cache_hit_ratio', 'Hit ratio'),
			unit: 'percent',
			curve: 'straight',
			dash: 6,
			// The other five theme hues are taken by the count series and TTL; the
			// accent reads as the headline metric it is, and flips with the theme.
			color: themeVar('--theme--foreground-accent', '#172940'),
			pick: (b) => hitRatioPercent(b.hits, b.fills),
		},
		{
			name: t('ttl', 'TTL'),
			unit: 'seconds',
			curve: 'stepline',
			dash: 0,
			color: themeVar('--theme--primary', '#6644ff'),
			pick: (b) => {
				return b.ttlMs === null
					? null
					: Math.round(b.ttlMs / 1000);
			},
		},
	];

	const countNames = metrics.filter((m) => m.unit === 'count').map((m) => m.name);

	const secondsNames = metrics
		.filter((m) => m.unit === 'seconds')
		.map((m) => m.name);

	const percentNames = metrics
		.filter((m) => m.unit === 'percent')
		.map((m) => m.name);

	return {
		chart: {
			type: 'line',
			height: 240,
			toolbar: { show: false },
			animations: { enabled: false },
			fontFamily: 'inherit',
			events: {
				legendClick: (_ctx: unknown, index: number) => {
					toggleHiddenSeries(countsHiddenSeries, metrics[index]!.name);
				},
			},
		},
		colors: metrics.map((m) => m.color),
		stroke: {
			width: 2,
			curve: metrics.map((m) => m.curve),
			dashArray: metrics.map((m) => m.dash),
		},
		legend: {
			show: true,
			position: 'top',
			horizontalAlign: 'left',
			itemMargin: { horizontal: 12, vertical: 0 },
		},
		dataLabels: { enabled: false },
		series: metrics.map((m) => {
			const data = series(m.pick);

			return {
				name: m.name,
				data: m.unit === 'seconds'
					? carryForward(data)
					: data,
			};
		}),
		xaxis: { type: 'datetime' },
		yaxis: [
			{
				// Bind every count series to this axis; without an explicit
				// seriesName map apexcharts indexes a missing y-axis per series
				// (misses/anomalies) and crashes on render.
				seriesName: countNames,
				title: { text: t('cache_count', 'Count') },
				labels: { formatter: (v: number) => String(Math.round(v)) },
			},
			{
				opposite: true,
				seriesName: secondsNames,
				title: { text: t('cache_ttl_label', 'TTL') },
				labels: { formatter: (v: number) => formatDuration(v) },
			},
			{
				// A percentage carries its own scale, so this axis exists only to keep
				// the ratio off the count scale — nothing is drawn for it. The ceiling
				// sits above 100 on purpose: a cache at 95-100% would otherwise ride
				// the plot's top edge and clip its own stroke out of the frame.
				opposite: true,
				seriesName: percentNames,
				show: false,
				min: 0,
				max: 115,
			},
		],
		tooltip: {
			// Custom compact tooltip: apex's shared layout right-aligns each value to
			// the widest row (TTL 3600s), which spreads the short rows and pushes their
			// marker out. Render one tight "dot name: value" line per metric instead,
			// each value formatted by the metric's own unit.
			custom: ({ series, dataPointIndex, w }) => {
				const ts = w.globals.seriesX[0]?.[dataPointIndex];

				const head = ts
					? new Date(ts).toLocaleString()
					: '';

				const rows = metrics.map((metric, index) => {
					const raw = series[index]?.[dataPointIndex];
					const shown = formatTooltipValue(raw, metric.unit);

					return [
						`<div class="cache-tt-row">`,
						`<span class="cache-tt-dot" style="background:${metric.color}"></span>`,
						`${metric.name}: ${shown}`,
						`</div>`,
					].join('');
				}).join('');

				return [
					`<div class="cache-tt">`,
					`<div class="cache-tt-head">${head}</div>`,
					rows,
					`</div>`,
				].join('');
			},
		},
		annotations: {
			xaxis: timeseries.value.markers.map((m) => {
				const flush = m.kind === 'flush';

				return {
					x: m.time,
					borderColor: flush
						? themeVar('--theme--danger', '#e35169')
						: themeVar('--theme--primary', '#6644ff'),
					label: {
						text: flush
							? `⚑ ${m.detail ?? ''}`
							: `TTL ${m.detail ?? '∅'}`,
						style: { fontSize: '10px' },
					},
				};
			}),
		},
	};
}

function renderChart() {
	if (!chartEl.value) {
		return;
	}

	if (chart) {
		void chart.updateOptions(chartConfig(), true, false).then(() => {
			applyHiddenSeries(chart, countsHiddenSeries.value);
		});

		return;
	}

	chart = new ApexCharts(chartEl.value, chartConfig());

	void chart.render().then(() => {
		applyHiddenSeries(chart, countsHiddenSeries.value);
	});
}

type LatencyLine = {
	name: string;
	color: string;
	dash: number;
	pick: (b: CacheTimeseriesBucket) => number | null;
};

// Colour by category, ordered as the funnel a request falls through: every
// response, the misses pooled, the flagged ones, the fills they produced, and the
// hits served straight from cache. p50 solid (dash 0), p95 dashed
// (dash 4), p99 dotted (dash 8). The p95 bands start hidden — see
// renderLatencyChart; p99 is visible so the tail is on screen without opting in.
function latencyLines(): LatencyLine[] {
	const hitColor = themeVar('--theme--success', '#2ecda7');
	const fillColor = themeVar('--theme--secondary', '#3399ff');
	const anomalyColor = themeVar('--theme--danger', '#e35169');
	const missColor = themeVar('--theme--warning', '#ffa439');
	const bothColor = themeVar('--theme--foreground-subdued', '#a2b5cd');

	const categories: {
		id: string;
		label: string;
		color: string;
		p50: (b: CacheTimeseriesBucket) => number | null;
		p95: (b: CacheTimeseriesBucket) => number | null;
		p99: (b: CacheTimeseriesBucket) => number | null;
	}[] = [
		{
			id: 'both',
			label: t('cache_lat_response', 'Response'),
			color: bothColor,
			p50: (b) => b.bothP50,
			p95: (b) => b.bothP95,
			p99: (b) => b.bothP99,
		},
		{
			id: 'miss',
			label: t('cache_lat_miss', 'Misses'),
			color: missColor,
			p50: (b) => b.missP50,
			p95: (b) => b.missP95,
			p99: (b) => b.missP99,
		},
		{
			id: 'anomaly',
			label: t('cache_lat_anomaly', 'Anomalies'),
			color: anomalyColor,
			p50: (b) => b.anomalyP50,
			p95: (b) => b.anomalyP95,
			p99: (b) => b.anomalyP99,
		},
		{
			id: 'fill',
			label: t('cache_lat_fill', 'Fills'),
			color: fillColor,
			p50: (b) => b.fillP50,
			p95: (b) => b.fillP95,
			p99: (b) => b.fillP99,
		},
		{
			id: 'hit',
			label: t('cache_lat_hit', 'Hits'),
			color: hitColor,
			p50: (b) => b.hitP50,
			p95: (b) => b.hitP95,
			p99: (b) => b.hitP99,
		},
	];

	return categories.flatMap((c): LatencyLine[] => {
		return [
			{ name: `${c.label} p50`, color: c.color, dash: 0, pick: c.p50 },
			{ name: `${c.label} p95`, color: c.color, dash: 4, pick: c.p95 },
			{ name: `${c.label} p99`, color: c.color, dash: 8, pick: c.p99 },
		];
	});
}

function latencyChartConfig(): ApexOptions {
	const buckets = timeseries.value.buckets;

	function series(pick: (b: CacheTimeseriesBucket) => number | null) {
		return buckets.map((b): [number, number] => [b.t, pick(b) ?? 0]);
	}

	// Drop series with no sample in the window — an all-null line adds a legend
	// entry + a "—" tooltip row for data that isn't there.
	const lines = latencyLines().filter((line) => {
		return buckets.some((bucket) => line.pick(bucket) != null);
	});

	// A marker only where a bucket has a real sample — never on the 0-fill that
	// keeps the line continuous through idle gaps.
	const markerPoints = lines.flatMap((line, seriesIndex) => {
		return buckets.flatMap((bucket, dataPointIndex) => {
			return line.pick(bucket) == null
				? []
				: [{ seriesIndex, dataPointIndex, size: 3, fillColor: line.color }];
		});
	});

	return {
		chart: {
			type: 'line',
			height: 240,
			toolbar: { show: false },
			animations: { enabled: false },
			fontFamily: 'inherit',
		},
		colors: lines.map((l) => l.color),
		stroke: { width: 2, curve: 'straight', dashArray: lines.map((l) => l.dash) },
		// Continuous line via 0-fill (idle gaps drop to zero); markers only on the
		// real samples, so the zero-fill points carry no dot.
		markers: { size: 0, discrete: markerPoints },
		// The legend is custom — one entry per percentile, each toggling its whole
		// curve group — so apex's per-series legend is off.
		legend: { show: false },
		dataLabels: { enabled: false },
		// 0-fill keeps the line continuous; an idle bucket drops to zero rather than
		// interpolating a fake value between distant real samples.
		series: lines.map((l) => {
			return { name: l.name, data: series(l.pick) };
		}),
		xaxis: { type: 'datetime' },
		yaxis: {
			min: 0,
			title: { text: t('cache_lat_axis', 'Response (ms)') },
			labels: { formatter: (v: number) => `${Math.round(v)}ms` },
		},
		tooltip: {
			custom: ({ dataPointIndex }) => {
				const bucket = buckets[dataPointIndex];

				const head = bucket
					? new Date(bucket.t).toLocaleString()
					: '';

				const rows = lines.map((line) => {
					const raw = bucket
						? line.pick(bucket)
						: null;

					// Skip a series with no sample at this bucket — no "—" clutter.
					if (raw == null) {
						return '';
					}

					return [
						`<div class="cache-tt-row">`,
						`<span class="cache-tt-dot" style="background:${line.color}"></span>`,
						`${line.name}: ${Math.round(raw)}ms`,
						`</div>`,
					].join('');
				}).join('');

				return [
					`<div class="cache-tt">`,
					`<div class="cache-tt-head">${head}</div>`,
					rows,
					`</div>`,
				].join('');
			},
		},
	};
}

// Depend on chartEl too, not just the data: the chart's v-show container mounts a
// tick after the route transition settles, so a data-only watcher fires while the
// ref is still null. Re-firing when chartEl binds is what paints the first load.
watch([timeseries, chartEl], renderChart, { deep: true, flush: 'post' });

function renderLatencyChart() {
	if (!latencyChartEl.value) {
		return;
	}

	if (latencyChart) {
		void latencyChart
			.updateOptions(latencyChartConfig(), true, false)
			.then(() => {
				applyHiddenSeries(latencyChart, latencyHiddenSeries.value);
			});

		return;
	}

	latencyChart = new ApexCharts(latencyChartEl.value, latencyChartConfig());

	void latencyChart.render().then(() => {
		applyHiddenSeries(latencyChart, latencyHiddenSeries.value);
	});
}

watch(
	[timeseries, latencyChartEl],
	renderLatencyChart,
	{ deep: true, flush: 'post' },
);

function toggle(path: string) {
	expanded.value[path] = !expanded.value[path];
}

function pageCount(query: QueryGroup): number {
	return Math.ceil(query.entries.length / PAGE_SIZE);
}

// Clamp to the available pages so a shrinking group (after a filter/search)
// never lands on an empty page.
function currentPage(query: QueryGroup): number {
	return Math.min(entryPage.value[query.key] ?? 1, Math.max(pageCount(query), 1));
}

function pagedEntries(query: QueryGroup): CacheEntry[] {
	const start = (currentPage(query) - 1) * PAGE_SIZE;
	const sort = entrySort.value[query.key];

	const ordered = sort
		? sortEntries(query.entries, sort)
		: query.entries;

	return ordered.slice(start, start + PAGE_SIZE);
}

// Column header click: first click asc, second desc, third returns to the API order.
function toggleEntrySort(query: QueryGroup, field: EntrySortField) {
	const current = entrySort.value[query.key];

	if (!current || current.field !== field) {
		entrySort.value[query.key] = { field, dir: 1 };
	}
	else if (current.dir === 1) {
		entrySort.value[query.key] = { field, dir: -1 };
	}
	else {
		delete entrySort.value[query.key];
	}
}

function sortActive(query: QueryGroup, field: EntrySortField): boolean {
	return entrySort.value[query.key]?.field === field;
}

function sortArrow(query: QueryGroup, field: EntrySortField): string {
	const sort = entrySort.value[query.key];

	if (!sort || sort.field !== field) {
		return '';
	}

	return sort.dir === 1
		? '↑'
		: '↓';
}

function setEntryPage(query: QueryGroup, page: number) {
	entryPage.value[query.key] = page;
}

// Thin template adapters: bind the reactive clock + i18n labels so the deeply
// nested table cells stay one short call; the formatting logic lives in cache-view.
function ageOf(timestamp: number): string {
	return formatAge(now.value, timestamp);
}

function lastHitOf(lastHitAt: number | null): string {
	return formatLastHit(now.value, lastHitAt, t('never', 'never'));
}

function expiryOf(expiresAt: number | null): string {
	return formatExpiry(now.value, expiresAt, t('expired', 'expired'));
}

function userOf(user: CacheEntry['user']): string {
	return formatUser(user, t('public_label', 'public'));
}

function msLabel(ms: number | null): string {
	return ms === null
		? '—'
		: `${ms} ms`;
}

// The tree columns are narrow and fixed-width, so every figure in them is shown
// compact and carries the exact one in its title.
function countLabel(value: number): string {
	return abbreviateNumber(value, 1);
}

function compactMs(ms: number | null): string {
	if (ms === null) {
		return '—';
	}

	return ms < 1000
		? `${ms}ms`
		: formatDuration(ms / 1000);
}

// The tree's funnel columns. Colour is the legend — the same hue the charts give
// each metric — so a row shows figures alone and the name lives in the title,
// alongside the count and the whole percentile tail.
function funnelColumns(node: EndpointGroup | QueryGroup) {
	const counts: Record<LatencyMetric, number> = {
		response: node.totalHits + node.totalMisses,
		miss: node.totalMisses,
		anomaly: node.anomalyCount,
		fill: node.totalFills,
		hit: node.totalHits,
	};

	return LATENCY_METRICS.map((metric) => {
		const count = counts[metric];
		const percentiles = node.latencies[metric];

		const tail = LATENCY_PERCENTILES.map((percentile) => {
			return `${percentile}  ${msLabel(percentiles[percentile])}`;
		});

		return {
			metric,
			count: countLabel(count),
			// A zero count has no duration to pair with, and an em-dash on every
			// row would drown the columns that do carry traffic.
			duration: count === 0
				? ''
				: compactMs(percentiles.p50),
			title: [
				metricName(metric),
				`${t('cache_count', 'Count')}  ${count}`,
				...tail,
			].join('\n'),
		};
	});
}

function secLabel(ms: number): string {
	return `${Math.round(ms / 1000)}s`;
}

// Same adapter pattern as ageOf/lastHitOf: the ratio formatter lives in cache-view,
// this collapses its "no traffic" null to the page's em-dash.
function ratioOf(hits: number, fills: number): string {
	return formatHitRatio(hits, fills) ?? '—';
}

// The data-driven TTL plus its shorten/lengthen verdict against the TTL in force.
function recTtlLabel(entry: CacheEntry): string {
	if (entry.recommendedTtlMs === null) {
		return '—';
	}

	const verdict = ttlVerdict(entry.recommendedTtlMs, entry.ttlMs);
	const base = secLabel(entry.recommendedTtlMs);

	return verdict && verdict !== 'ok'
		? `${base} (${verdict})`
		: base;
}

// The stored `url` is the raw request path — resolve it against the API root so the
// link opens the exact endpoint in a new tab (the session cookie authenticates it).
function hrefFor(item: { url: string }): string {
	return `${getRootPath().replace(/\/$/, '')}${item.url}`;
}

function openQuery(query: QueryGroup) {
	window.open(hrefFor(query), '_blank', 'noopener');
}

function copyQuery(query: QueryGroup) {
	let json = query.query;

	try {
		// Pretty-print the stored query so the clipboard gets readable JSON.
		json = JSON.stringify(JSON.parse(query.query), null, 2);
	}
	catch {
		// Leave the raw stored value if it isn't valid JSON.
	}

	copyToClipboard(json, { success: t('copy_query_success', 'Query copied') });
}

// Open the detail drawer for a row and fetch its live cached value from Redis
// (the descriptor outlives the value, so it may already be gone).
async function openEntry(entry: CacheEntry) {
	const token = ++entryToken;
	selectedEntry.value = entry;
	now.value = Date.now(); // fresh clock so absentReason's expired-vs-evicted verdict is current
	cachedValue.value = null;
	cachedValueExists.value = false;
	cachedTags.value = null;
	cachedTagCounts.value = {};
	cachedExpiry.value = null;
	cachedSizes.value = null;
	cachedTombstone.value = null;
	valueLoading.value = true;

	try {
		const response = await api.get('/utils/cache/entry', {
			params: { key: entry.redisKey },
		});

		// A newer open (or a close) supersedes this fetch; ignore a late response so it
		// can't overwrite the currently-open entry — even a re-open of the same key.
		if (token !== entryToken) {
			return;
		}

		const data = response.data.data;
		cachedValueExists.value = data.exists;
		cachedValue.value = data.value;
		cachedTags.value = data.tags;
		cachedTagCounts.value = data.tagCounts ?? {};
		cachedExpiry.value = data.expiry;
		cachedSizes.value = data.sizes;
		cachedTombstone.value = data.tombstone;
	}
	catch {
		if (token === entryToken) {
			cachedValueExists.value = false;
		}
	}
	finally {
		if (token === entryToken) {
			valueLoading.value = false;
		}
	}
}

function closeEntry() {
	entryToken += 1; // discard any in-flight /entry fetch
	selectedEntry.value = null;
	valueLoading.value = false;
}

onMounted(() => {
	void load();
	void loadStatsState();
});

onUnmounted(() => {
	chart?.destroy();
	chart = null;
	latencyChart?.destroy();
	latencyChart = null;
});
</script>

<template>
	<private-view :title="t('cache', 'Cache')">
		<template #headline>
			<v-breadcrumb :items="[{ name: t('settings'), to: '/settings' }]" />
		</template>

		<template #title-outer:prepend>
			<v-button class="header-icon" rounded icon exact disabled>
				<v-icon name="database" />
			</v-button>
		</template>

		<template #actions>
			<v-select
				v-model="selectedWindow"
				class="window-select"
				:items="windowOptions"
				allow-other
				inline
				@update:model-value="load"
			/>

			<search-input
				v-model="search"
				v-model:filter="filter"
				collection="directus_cache_descriptors"
			/>

			<v-button
				v-tooltip.bottom="t('refresh')"
				rounded
				icon
				secondary
				:loading="loading"
				@click="load"
			>
				<v-icon name="refresh" />
			</v-button>

			<v-button
				v-if="statsState?.configured"
				v-tooltip.bottom="statsTooltip"
				class="stats-toggle"
				rounded
				icon
				:secondary="!statsState.enabled"
				:kind="statsState.killedReason ? 'warning' : undefined"
				:loading="statsToggling"
				@click="toggleStats"
			>
				<v-icon :name="statsState.enabled ? 'toggle_on' : 'toggle_off'" />
			</v-button>
		</template>

		<template #navigation>
			<settings-navigation />
		</template>

		<template #sidebar>
			<auto-refresh
				v-model="refreshInterval"
				:intervals="[null, 1, 3, 5, 10, 30, 60, 300]"
				@refresh="load"
			/>
		</template>

		<div class="cache-page">
			<v-notice v-if="error" type="danger">{{ error }}</v-notice>

			<div v-show="hasTimeseries" class="timeseries">
				<div class="summary">
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalMisses) }}</span>
						<span class="label">{{ t('cache_misses', 'Misses') }}</span>
					</div>
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalHits) }}</span>
						<span class="label">{{ t('cache_hits', 'Hits') }}</span>
					</div>
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalFills) }}</span>
						<span class="label">{{ t('cache_fills', 'Fills') }}</span>
					</div>
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalAnomalies) }}</span>
						<span class="label">{{ t('cache_anomalies', 'Anomalies') }}</span>
					</div>
					<div class="metric-separator" />
					<div class="metric">
						<span class="value">{{ totalRatio }}</span>
						<span class="label">{{ t('cache_hit_ratio', 'Hit ratio') }}</span>
					</div>
				</div>
				<div ref="chartEl" class="chart" />
			</div>

			<div v-show="hasLatency" class="timeseries">
				<div class="summary">
					<div class="metric">
						<span class="value">{{ medianResponse }}</span>
						<span class="label">
							{{ t('cache_lat_median_response', 'Median response') }}
						</span>
					</div>
					<div class="metric">
						<span class="value">{{ medianMiss }}</span>
						<span class="label">
							{{ t('cache_lat_median_miss', 'Median miss') }}
						</span>
					</div>
					<div class="metric">
						<span class="value">{{ medianHit }}</span>
						<span class="label">
							{{ t('cache_lat_median_hit', 'Median hit') }}
						</span>
					</div>
				</div>
				<div class="cache-chart-legend">
					<div
						v-for="percentile in latencyPercentiles"
						:key="percentile"
						class="cache-chart-legend-row"
					>
						<span class="cache-chart-legend-percentile">
							<span class="cache-chart-legend-line" :class="`dash-${percentile}`" />
							{{ percentile }}
						</span>
						<span
							v-for="entry in latencyEntries(percentile)"
							:key="entry.name"
							class="cache-chart-legend-entry"
							:class="{ 'is-muted': isLatencyEntryHidden(entry.name) }"
							role="button"
							tabindex="0"
							@click="toggleLatencyEntry(entry.name)"
							@keydown.enter="toggleLatencyEntry(entry.name)"
						>
							<span
								class="cache-chart-legend-dot"
								:style="{ background: entry.color }"
							/>
							{{ entry.label }}
						</span>
					</div>
				</div>
				<div ref="latencyChartEl" class="chart" />
			</div>

			<div style="display: flex; justify-content:space-between;">
				<div class="summary">
					<div class="metric">
						<span class="value">{{ abbreviateNumber(groups.length) }}</span>
						<span class="label">{{ t('endpoints', 'Endpoints') }}</span>
					</div>
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalEntries) }}</span>
						<span class="label">{{ t('cached_entries', 'Cached entries') }}</span>
					</div>
				</div>

				<div style="display: flex; align-items: center; gap: 16px 32px;">
					<v-input
						v-model="ttlDraft"
						class="ttl-input"
						small
						inline
						:placeholder="ttlPlaceholder"
						style="width: 100px;"
						@keydown.enter="saveTtl"
					>
						<template #append>
							<v-icon
								v-tooltip.bottom="t('cache_ttl_save', 'Save global TTL')"
								name="check"
								:disabled="!ttlDirty || ttlSaving"
								clickable
								@click="saveTtl"
							/>
						</template>
					</v-input>

					<div class="flush-group">
						<v-select
							v-model="flushTargets"
							class="flush-select"
							:items="flushTargetOptions"
							:placeholder="t('cache_flush_targets', 'Flush')"
							multiple
							inline
						/>

						<v-button
							v-tooltip.bottom="t('cache_flush', 'Flush selected caches')"
							rounded
							icon
							secondary
							kind="danger"
							:loading="flushing"
							:disabled="flushTargets.length === 0"
							@click="flush"
						>
							<v-icon name="cleaning_services" />
						</v-button>
					</div>
				</div>
			</div>

			<div v-if="anomalySummary.length" class="anomaly-summary">
				<v-icon name="warning" small />
				<span class="label">{{ t('cache_anomalies', 'Anomalies') }}</span>
				<span
					v-for="item in anomalySummary"
					:key="item.reason"
					class="reason"
					:class="item.reason"
				>{{ anomalyLabel(item.reason) }} ×{{ item.count }}</span>
			</div>

			<v-info
				v-if="!loading && groups.length === 0"
				:title="t('no_cached_entries', 'No cached entries')"
				icon="database"
				center
			>
				{{
					t(
						'no_cached_entries_copy',
						'Nothing is cached yet, or cache stats are off. '
							+ 'Needs CACHE_STORE=redis and CACHE_STATS_ENABLED.',
					)
				}}
			</v-info>

			<div v-if="groups.length > 0" class="tree-controls">
				<span class="tree-controls-group">
					<v-select
						v-model="treeLatencyMetric"
						class="tree-metric-select"
						:items="treeMetricOptions"
						inline
					/>

					<v-select
						v-model="treeBand"
						class="tree-band-select"
						:items="treeBandOptions"
						inline
					/>
				</span>

				<span class="tree-controls-group">
					<v-select
						v-model="treeSortField"
						class="tree-sort-select"
						:items="treeSortOptions"
						inline
					/>
					<v-button
						v-tooltip.bottom="
							treeSortDir === -1
								? t('cache_tree_sort_asc', 'Ascending')
								: t('cache_tree_sort_desc', 'Descending')
						"
						rounded
						icon
						x-small
						@click="treeSortDir = treeSortDir === -1 ? 1 : -1"
					>
						<v-icon :name="treeSortDir === -1 ? 'arrow_downward' : 'arrow_upward'" />
					</v-button>
				</span>
			</div>

			<div class="endpoints">
				<div v-for="section in sections" :key="section.key" class="section">
					<h2 class="section-title">{{ section.label }}</h2>

					<div v-for="group in section.groups" :key="group.path" class="endpoint">
						<div class="endpoint-header" @click="toggle(group.path)">
							<v-icon
								:name="expanded[group.path] ? 'expand_more' : 'chevron_right'"
								small
							/>
							<span v-tooltip="`${group.entryCount} entries`" class="stat entries">
								{{ countLabel(group.entryCount) }}
							</span>
							<span class="path">{{ group.path }}</span>
							<span v-if="group.coarseCount" class="stat coarse-count">
								{{ group.coarseCount }} {{ t('coarse_short', 'coarse') }}
							</span>
							<span
								v-for="column in funnelColumns(group)"
								:key="column.metric"
								v-tooltip="column.title"
								class="stat funnel"
								:class="column.metric"
							>
								<span class="count">{{ column.count }}</span>
								<span class="duration">{{ column.duration }}</span>
							</span>
							<span
								v-tooltip="
									t('cache_hit_ratio_tip', 'Hit ratio: hits / (hits + fills)')
								"
								class="stat ratio"
							>{{ ratioOf(group.totalHits, group.totalFills) }}</span>
							<span v-tooltip="`${group.totalSize} bytes`" class="stat size">
								{{ formatFilesize(group.totalSize) }}
							</span>
							<span class="row-actions">
								<v-button
									v-tooltip.bottom="t('evict_endpoint', 'Evict this endpoint')"
									x-small
									kind="danger"
									secondary
									:disabled="group.entryCount === 0"
									@click.stop="evictPath(group.path)"
								>
									<v-icon name="delete" x-small />
								</v-button>
							</span>
						</div>

						<div v-if="expanded[group.path]" class="query-groups">
							<div v-for="q in group.queries" :key="q.key" class="query-group">
								<div class="query-header" @click="toggle(q.key)">
									<v-icon
										:name="expanded[q.key] ? 'expand_more' : 'chevron_right'"
										small
									/>
									<span
										v-tooltip="`${q.entries.length} entries`"
										class="stat entries"
									>
										{{ countLabel(q.entries.length) }}
									</span>
									<span class="method">{{ q.method }}</span>
									<span class="query" :title="q.query">
										{{ formatQuery(q.query) }}
									</span>
									<span v-if="q.coarseCount" class="stat coarse-count">
										{{ q.coarseCount }} {{ t('coarse_short', 'coarse') }}
									</span>
									<span
										v-if="q.recommendedTtlMs !== null"
										class="stat rec"
										:class="ttlVerdict(q.recommendedTtlMs, q.ttlMs)"
										:title="t('recommended_ttl', 'Recommended TTL')"
									>
										rec {{ secLabel(q.recommendedTtlMs) }}
									</span>
									<span
										v-for="column in funnelColumns(q)"
										:key="column.metric"
										v-tooltip="column.title"
										class="stat funnel"
										:class="column.metric"
									>
										<span class="count">{{ column.count }}</span>
										<span class="duration">{{ column.duration }}</span>
									</span>
									<span
										v-tooltip="
											t(
												'cache_hit_ratio_tip',
												'Hit ratio: hits / (hits + fills)',
											)
										"
										class="stat ratio"
									>{{ ratioOf(q.totalHits, q.totalFills) }}</span>
									<span v-tooltip="`${q.totalSize} bytes`" class="stat size">
										{{ formatFilesize(q.totalSize) }}
									</span>
									<span class="row-actions">
										<v-icon
											v-if="q.url"
											v-tooltip.bottom="t('open_in_new_tab', 'Open in new tab')"
											name="open_in_new"
											small
											clickable
											@click.stop="openQuery(q)"
										/>
										<v-icon
											v-tooltip.bottom="t('copy_query', 'Copy query as JSON')"
											name="content_copy"
											small
											clickable
											@click.stop="copyQuery(q)"
										/>
									</span>
								</div>

								<div
									v-if="expanded[q.key] && q.entries.length"
									class="entries-scroll"
								>
									<table class="entries">
										<thead>
											<tr>
												<th
													class="sortable"
													:class="{ sorted: sortActive(q, 'user') }"
													@click="toggleEntrySort(q, 'user')"
												>
													{{ t('user_label', 'User') }}
													<span class="arrow">{{ sortArrow(q, 'user') }}</span>
												</th>
												<th
													class="num sortable"
													:class="{ sorted: sortActive(q, 'hits') }"
													@click="toggleEntrySort(q, 'hits')"
												>
													{{ t('hits', 'Hits') }}
													<span class="arrow">{{ sortArrow(q, 'hits') }}</span>
												</th>
												<th
													class="num sortable"
													:class="{ sorted: sortActive(q, 'ratio') }"
													@click="toggleEntrySort(q, 'ratio')"
												>
													{{ t('cache_hit_ratio', 'Hit ratio') }}
													<span class="arrow">{{ sortArrow(q, 'ratio') }}</span>
												</th>
												<th
													class="num sortable"
													:class="{ sorted: sortActive(q, 'createdAt') }"
													@click="toggleEntrySort(q, 'createdAt')"
												>
													{{ t('age', 'Age') }}
													<span class="arrow">{{ sortArrow(q, 'createdAt') }}</span>
												</th>
												<th
													class="num sortable"
													:class="{ sorted: sortActive(q, 'lastHitAt') }"
													@click="toggleEntrySort(q, 'lastHitAt')"
												>
													{{ t('last_hit', 'Last hit') }}
													<span class="arrow">{{ sortArrow(q, 'lastHitAt') }}</span>
												</th>
												<th
													class="num sortable"
													:class="{ sorted: sortActive(q, 'expiresAt') }"
													@click="toggleEntrySort(q, 'expiresAt')"
												>
													{{ t('expires_in', 'Expires in') }}
													<span class="arrow">{{ sortArrow(q, 'expiresAt') }}</span>
												</th>
												<th
													class="num sortable"
													:class="{ sorted: sortActive(q, 'size') }"
													@click="toggleEntrySort(q, 'size')"
												>
													{{ t('size', 'Size') }}
													<span class="arrow">{{ sortArrow(q, 'size') }}</span>
												</th>
												<th
													class="key sortable"
													:class="{ sorted: sortActive(q, 'key') }"
													@click="toggleEntrySort(q, 'key')"
												>
													{{ t('key', 'Key') }}
													<span class="arrow">{{ sortArrow(q, 'key') }}</span>
												</th>
												<th></th>
											</tr>
										</thead>
										<tbody>
											<tr
												v-for="entry in pagedEntries(q)"
												:key="entry.key"
												class="entry-row"
												@click="openEntry(entry)"
											>
												<td>{{ userOf(entry.user) }}</td>
												<td class="num">{{ entry.hits }}</td>
												<td class="num">
													{{ ratioOf(entry.hits, entry.fills) }}
												</td>
												<td class="num">{{ ageOf(entry.createdAt) }}</td>
												<td class="num">
													{{ lastHitOf(entry.lastHitAt) }}
												</td>
												<td class="num">
													{{ expiryOf(entry.expiresAt) }}
												</td>
												<td class="num">{{ formatFilesize(entry.size) }}</td>
												<td class="key" :title="entry.redisKey">
													{{ shortKey(entry.redisKey) }}
													<span
														v-if="entry.coarse"
														v-tooltip.bottom="coarseHint"
														class="reason inline coarse"
													>{{ t('cache_coarse', 'coarse') }}</span>
												</td>
												<td class="num">
													<v-icon
														v-tooltip.bottom="
															t('evict_entry', 'Evict this entry')
														"
														name="delete"
														small
														clickable
														@click.stop="evictEntry(entry)"
													/>
												</td>
											</tr>
										</tbody>
									</table>
								</div>

								<div
									v-if="expanded[q.key] && q.anomalies.length"
									class="anomaly-rows"
								>
									<div
										v-for="anomaly in q.anomalies"
										:key="anomaly.cacheKey + anomaly.reason"
										class="anomaly-row"
									>
										<span class="reason" :class="anomaly.reason">
											{{ anomalyLabel(anomaly.reason) }}
										</span>
										<span class="stat count">×{{ anomaly.count }}</span>
										<span
											v-if="anomaly.sample"
											class="sample"
											:title="anomaly.sample"
										>{{ anomaly.sample }}</span>
									</div>
								</div>

								<v-pagination
									v-if="expanded[q.key] && pageCount(q) > 1"
									class="pagination"
									:length="pageCount(q)"
									:model-value="currentPage(q)"
									:total-visible="7"
									@update:model-value="setEntryPage(q, $event)"
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<v-drawer
			:model-value="!!selectedEntry"
			:title="selectedEntry ? selectedEntry.path : ''"
			:subtitle="selectedEntry ? selectedEntry.method : ''"
			icon="database"
			@cancel="closeEntry"
			@update:model-value="closeEntry"
		>
			<div v-if="selectedEntry" class="entry-detail">
				<div class="fields">
					<div
						v-for="field in detailFields"
						:key="field.label"
						class="field"
					>
						<span class="field-label">{{ field.label }}</span>
						<span class="field-value">{{ field.value }}</span>
					</div>
				</div>

				<div class="redis-block">
					<div class="fields">
						<div
							v-for="field in redisFields"
							:key="field.label"
							class="field"
						>
							<span class="field-label">{{ field.label }}</span>
							<span class="field-value">{{ field.value }}</span>
						</div>
					</div>

					<div class="value-head tags-head">
						{{ t('scoped_cache_tags', 'Scoped cache tags') }}
					</div>
					<div v-if="cachedTags && cachedTags.length" class="tags">
						<span v-for="tag in cachedTags" :key="tag" class="tag">
							{{ tag }}
							<template v-if="cachedTagCounts[tag]">
								({{ cachedTagCounts[tag] }})
							</template>
						</span>
					</div>
					<div v-else class="value-note">
						{{ t('no_scoped_cache_tags', 'None (needs CACHE_TAGS_HEADER)') }}
					</div>
				</div>

				<div class="value-block">
					<div class="value-head">
						{{ t('cached_value', 'Cached value') }}
					</div>
					<div v-if="valueLoading" class="value-note">
						{{ t('loading', 'Loading…') }}
					</div>
					<div v-else-if="!cachedValueExists" class="value-note">
						{{ absentReason }}
					</div>
					<pre v-else class="value">{{ prettyValue }}</pre>
				</div>
			</div>
		</v-drawer>
	</private-view>
</template>

<style scoped>
.cache-page {
	padding: var(--content-padding);
	padding-block-start: 0;
}

.summary {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 16px 32px;
	margin-block-end: 24px;
}

/* A dedicated row under the metrics, left-aligned — body content pushed to the far
   right hides behind the auto-refresh sidebar, so keep these on the left. */
.cache-toolbar {
	display: flex;
	align-items: center;
	gap: 20px;
	margin-block-end: 24px;
}

/* The flush select + button read as one control, set apart from the TTL field. */
.flush-group {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 4px 4px 10px;
	background-color: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}

.metric {
	display: flex;
	flex-direction: column;
}

/* Sets the derived hit ratio apart from the raw outcome counts. */
.metric-separator {
	align-self: stretch;
	border-inline-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.metric .value {
	font-size: 28px;
	font-weight: 700;
	line-height: 1.2;
}

.metric .label {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}

.anomaly-summary {
	align-items: center;
	background-color: color-mix(in srgb, var(--theme--warning) 12%, transparent);
	border: var(--theme--border-width) solid var(--theme--warning);
	border-radius: var(--theme--border-radius);
	color: var(--theme--warning);
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-block-end: 24px;
	padding: 8px 12px;
}

.anomaly-summary .label {
	font-weight: 700;
	text-transform: uppercase;
}

.reason {
	color: var(--theme--warning);
	font-weight: 600;
	white-space: nowrap;
}

.reason.inline {
	font-size: 11px;
	margin-inline-start: 8px;
}

.reason.inline.coarse {
	color: var(--theme--primary);
}

.tree-controls {
	align-items: center;
	display: flex;
	flex-wrap: wrap;
	gap: 8px 12px;
	justify-content: space-between;
	margin-block-end: 16px;
}

/* A v-select's root is a `v-menu` with no layout box of its own, so it can't be
   pushed with an auto margin. The two groups are what the row actually lays out:
   metric + percentile pick what the tree reports, the sort pair acts on the rows
   below and so sits at the far edge, over their figures. */
.tree-controls-group {
	align-items: center;
	display: flex;
	flex-wrap: wrap;
	gap: 8px 12px;
}

.tree-sort-select {
	inline-size: 160px;
}

.tree-metric-select {
	inline-size: 120px;
}

.tree-band-select {
	inline-size: 120px;
}

.anomaly-rows {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 4px 12px 8px;
}

.anomaly-row {
	align-items: center;
	color: var(--theme--warning);
	display: flex;
	gap: 12px;
}

.anomaly-row .stat {
	color: var(--theme--foreground-subdued);
	flex-shrink: 0;
	font-size: 13px;
}

.anomaly-row .count {
	font-variant-numeric: tabular-nums;
}

.anomaly-row .sample {
	color: var(--theme--foreground-subdued);
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 12px;
	margin-inline-start: auto;
	max-inline-size: 40%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* Coarse is a tuning hint, not a problem — primary (not red) so it reads apart
   from anomalies. */
.endpoint-header .stat.coarse-count,
.query-header .stat.coarse-count {
	color: var(--theme--primary);
}

.section {
	margin-block-end: 24px;
}

.section-title {
	color: var(--theme--foreground-subdued);
	font-size: 16px;
	font-weight: 700;
	margin-block-end: 8px;
	text-transform: uppercase;
}

.endpoint {
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	margin-block-end: 8px;
}

.endpoint-header {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 12px;
	cursor: pointer;
}

.endpoint-header:hover {
	background-color: var(--theme--background-subdued);
}

.endpoint-header .path {
	font-family: var(--theme--fonts--monospace--font-family);
	flex-grow: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.endpoint-header .stat {
	color: var(--theme--foreground-subdued);
	font-size: 13px;
	white-space: nowrap;
}

/* The numeric run is a fixed-width column set anchored to the right of the row,
   so the figures line up down the tree instead of drifting with path length.
   Variable chips (anomalies, coarse, rec) sit left of it, against the path, where
   their width is absorbed by the growing path cell rather than shifting a column.
   `.entries` opens the run left-aligned; everything after it reads as a number. */
/* The figures carry the row; the labels around them are already muted, so weight
   is what separates a number from its surroundings at 13px. Left off the coarse
   and rec chips, which are words with a number in them rather than figures. */
.endpoint-header .stat.entries,
.endpoint-header .stat.funnel,
.endpoint-header .stat.ratio,
.endpoint-header .stat.size,
.query-header .stat.entries,
.query-header .stat.funnel,
.query-header .stat.ratio,
.query-header .stat.size {
	font-weight: 700;
}

/* Never shrink a stat: the widths below are flex-bases, and a query row (deeper
   indent, plus a `rec` chip) overflows where its endpoint row did not — flex would
   then shave each column by a different amount and the two levels would stop
   lining up. The path/query cell absorbs the deficit instead; it ellipsises. */
.endpoint-header .stat,
.query-header .stat {
	flex-shrink: 0;
	font-variant-numeric: tabular-nums;
	text-align: end;
}

/* Leads the row rather than joining the numeric run: a constant width here is
   what keeps every path — and every method one level down — starting at the same
   x. The "entries" wording lives in the title, the column is just the count. */
.endpoint-header .stat.entries,
.query-header .stat.entries {
	inline-size: 36px;
	text-align: end;
}

/* The funnel a request falls through — every response, the misses, the flagged
   and cached slices of those, the hits — each pairing a count with its median.
   One width for all five: a metric with no traffic still holds its column, or
   every row's figures would shift against the one above. */
.endpoint-header .stat.funnel,
.query-header .stat.funnel {
	display: inline-flex;
	gap: 6px;
	inline-size: 82px;
	justify-content: flex-end;
}

/* Counts read down one edge and durations down another, so a row can be compared
   against the rows above it without reading the pairs apart. */
.endpoint-header .stat.funnel .count,
.query-header .stat.funnel .count {
	inline-size: 32px;
}

.endpoint-header .stat.funnel .duration,
.query-header .stat.funnel .duration {
	inline-size: 44px;
}

/* Colour is the legend: the same hue each metric carries in the charts above. */
.endpoint-header .stat.miss,
.query-header .stat.miss {
	color: var(--theme--warning);
}

.endpoint-header .stat.anomaly,
.query-header .stat.anomaly {
	color: var(--theme--danger);
}

.endpoint-header .stat.fill,
.query-header .stat.fill {
	color: var(--theme--secondary);
}

.endpoint-header .stat.hit,
.query-header .stat.hit {
	color: var(--theme--success);
}

.endpoint-header .stat.ratio,
.query-header .stat.ratio {
	inline-size: 40px;
}

.endpoint-header .stat.size,
.query-header .stat.size {
	inline-size: 62px;
}

/* One action slot of the same width at both levels, so the columns line up across
   endpoint and query rows. It is fixed because `open_in_new` only renders for a
   query carrying a URL, and its absence would otherwise slide every column right. */
.endpoint-header .row-actions,
.query-header .row-actions {
	display: flex;
	flex-shrink: 0;
	gap: 12px;
	align-items: center;
	justify-content: flex-end;
	inline-size: 60px;
}

.query-groups {
	border-block-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.query-group + .query-group {
	border-block-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.query-header {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 6px 12px 6px 28px;
	cursor: pointer;
	font-size: 13px;
}

.query-header:hover {
	background-color: var(--theme--background-subdued);
}

.query-header .method {
	font-family: var(--theme--fonts--monospace--font-family);
	font-weight: 700;
	color: var(--theme--primary);
}

.query-header .query {
	font-family: var(--theme--fonts--monospace--font-family);
	flex-grow: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.query-header .stat {
	color: var(--theme--foreground-subdued);
	white-space: nowrap;
}

.query-header .stat.rec {
	font-weight: 600;
}

.query-header .stat.rec.lengthen {
	color: var(--theme--warning);
}

.query-header .stat.rec.shorten {
	color: var(--theme--success);
}

.query-header .stat.rec.ok {
	color: var(--theme--foreground-subdued);
}

.entries-scroll {
	overflow-x: auto;
	border-block-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

table.entries {
	inline-size: 100%;
	border-collapse: collapse;
	font-size: 13px;
}

table.entries .key {
	font-family: var(--theme--fonts--monospace--font-family);
	color: var(--theme--foreground-subdued);
}

table.entries th,
table.entries td {
	padding: 6px 12px;
	text-align: start;
}

table.entries th {
	color: var(--theme--foreground-subdued);
	font-weight: 600;
}

table.entries th.sortable {
	cursor: pointer;
	user-select: none;
}

table.entries th.sortable:hover,
table.entries th.sortable.sorted {
	color: var(--theme--foreground);
}

table.entries .arrow {
	font-size: 11px;
	margin-inline-start: 4px;
}

table.entries .num {
	text-align: end;
	font-variant-numeric: tabular-nums;
}

table.entries tbody tr:hover {
	background-color: var(--theme--background-subdued);
}

table.entries .entry-row {
	cursor: pointer;
}

.pagination {
	margin: 12px;
}

.entry-detail {
	padding: var(--content-padding);
}

.fields {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 8px 24px;
	margin-block-end: 32px;
}

.field {
	display: contents;
}

.field-label {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}

.field-value {
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 13px;
	overflow-wrap: anywhere;
}

.value-head {
	color: var(--theme--foreground-subdued);
	font-size: 16px;
	font-weight: 700;
	margin-block-end: 8px;
	text-transform: uppercase;
}

.value-note {
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.redis-block {
	margin-block-end: 24px;
}

.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.tag {
	padding: 2px 8px;
	background-color: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 12px;
}

.tags-head {
	margin-block-start: 16px;
}

.value {
	max-block-size: 60vh;
	padding: 12px;
	background-color: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 13px;
	white-space: pre;
	overflow: auto;
}

.timeseries {
	margin-block-end: 24px;
}

/* The chart has two y-axes (counts + TTL seconds), so ApexCharts splits the legend
   into a per-axis group and stacks each one vertically. Override its runtime-built
   markup (hence :deep) so the four series read as a single horizontal row. */
.chart :deep(.apexcharts-legend-group-vertical) {
	flex-direction: row;
}

/* Compact custom tooltip (see chartConfig): one tight row per metric, no spread. */
.chart :deep(.cache-tt) {
	padding: 6px 10px;
	font-size: 12px;
	line-height: 1.6;
}

/* Latency chart legend: 3 rows — one per percentile (p50/p95/p99) — each listing
   its 5 category curves. Apex's per-series legend is disabled; this replaces it.
   A muted entry is hidden; clicking it toggles that single curve. */
.cache-chart-legend {
	display: grid;
	gap: 4px;
	margin-block-end: 8px;
}

.cache-chart-legend-row {
	display: flex;
	align-items: center;
	gap: 10px;
}

.cache-chart-legend-percentile {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	inline-size: 40px;
	flex-shrink: 0;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.cache-chart-legend-entry {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 2px 6px;
	border: none;
	background: none;
	cursor: pointer;
	font-size: 12px;
	color: var(--theme--foreground);
}

.cache-chart-legend-entry.is-muted {
	opacity: 0.4;
}

.cache-chart-legend-dot {
	inline-size: 8px;
	block-size: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}

.cache-chart-legend-line {
	inline-size: 16px;
	block-size: 0;
	border-block-end: 2px solid var(--theme--foreground-subdued);
}

.cache-chart-legend-line.dash-p95 {
	border-block-end-style: dashed;
}

.cache-chart-legend-line.dash-p99 {
	border-block-end-style: dotted;
}

.chart :deep(.cache-tt-head) {
	font-weight: 600;
	margin-block-end: 2px;
}

.chart :deep(.cache-tt-row) {
	display: flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
}

.chart :deep(.cache-tt-dot) {
	inline-size: 8px;
	block-size: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}

/* Scoped under .cache-toolbar to out-specify v-input's own `inline-size: max-content`
   (which, with the 20px inner input, otherwise collapses to the icons' width). */
.cache-toolbar .ttl-input {
	inline-size: 240px;
}

.flush-select {
	inline-size: 130px;
}
</style>
