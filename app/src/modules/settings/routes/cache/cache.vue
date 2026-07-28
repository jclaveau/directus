<script setup lang="ts">
import api from '@/api';
import { useClipboard } from '@/composables/use-clipboard';
import { getRootPath } from '@/utils/get-root-path';
import { useSettingsStore } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
import { useLocalStorage } from '@vueuse/core';
import ApexCharts, { type ApexOptions } from 'apexcharts';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { abbreviateNumber } from '@directus/utils';
import type { CacheFlushTarget, Filter, User } from '@directus/types';
import SettingsNavigation from '../../components/navigation.vue';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import SearchInput from '@/views/private/components/search-input.vue';
import {
	buildGroups,
	filterAnomalies,
	filterEntries,
	formatAge,
	formatExpiry,
	formatLastHit,
	formatQuery,
	formatSize,
	formatUser,
	shortKey,
	splitSections,
	summariseAnomalies,
	ttlVerdict,
	type CacheAnomaly,
	type CacheAnomalyReason,
	type CacheEntry,
	type EndpointGroup,
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
const expanded = ref<Record<string, boolean>>({});
const now = ref(Date.now());
const search = ref('');
const filter = ref<Filter | null>(null);
const entryPage = ref<Record<string, number>>({});

// A search/filter change reshapes every group, so reset paging to the first page —
// else the saved deep page strands the user on a tail slice of the filtered set.
watch([search, filter], () => {
	entryPage.value = {};
});

// How far back the listing looks — sent as ?window= to the API, which clamps it.
const windowOptions = [
	{ text: t('cache_window_1h', 'Last 1h'), value: '1h' },
	{ text: t('cache_window_6h', 'Last 6h'), value: '6h' },
	{ text: t('cache_window_24h', 'Last 24h'), value: '24h' },
	{ text: t('cache_window_7d', 'Last 7d'), value: '7d' },
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

// Which endpoint prefixes to plot on the chart; empty = all. Persisted per-user
// like the window, so the self-polling /utils noise can stay filtered out.
const selectedPrefixes = useLocalStorage<string[]>(`cache-prefixes-${userId}`, []);

// Bumped per load; a superseded window's late response can't clobber a newer one.
let loadToken = 0;

// Drawer version of loadToken: a per-open token so a late /entry response (even a
// same-key reopen) can't overwrite a newer open; a close discards it entirely.
let entryToken = 0;

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
		{ label: t('size', 'Size'), value: formatSize(entry.size) },
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

		const packed = formatSize(sizes.compressed);
		const raw = formatSize(sizes.uncompressed);

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
	return buildGroups(searchedEntries.value, searchedAnomalies.value);
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
		const [entriesRes, anomaliesRes] = await Promise.all([
			api.get('/utils/cache', {
				params: { window: selectedWindow.value },
			}),
			api.get('/utils/cache/anomalies', {
				params: { window: selectedWindow.value },
			}).catch(() => ({ data: { data: [] } })),
		]);

		if (token !== loadToken) {
			return;
		}

		entries.value = entriesRes.data.data;
		anomalies.value = anomaliesRes.data.data;
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

interface TimeseriesBucket {
	t: number;
	hits: number;
	misses: number;
	anomalies: number;
	ttlMs: number | null;
}

interface ConfigMarker {
	time: number;
	kind: 'ttl_change' | 'flush';
	detail: string | null;
}

interface TimeseriesData {
	buckets: TimeseriesBucket[];
	markers: ConfigMarker[];
	// The TTL in force server-side (override, else env default) — shown as the TTL
	// input's placeholder so an empty field reveals what it inherits.
	effectiveTtl: string | null;
	// Every endpoint prefix seen in the window — the filter's option list.
	prefixes: string[];
}

const timeseries = ref<TimeseriesData>({
	buckets: [],
	markers: [],
	effectiveTtl: null,
	prefixes: [],
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

const totalAnomalies = computed(() => {
	return searchedAnomalies.value.reduce((sum, a) => sum + a.count, 0);
});

const chartEl = ref<HTMLElement | null>(null);
let chart: ApexCharts | null = null;

// Show the chart once there's anything to plot — sample counts or a config marker —
// so a stats-off page with no markers doesn't render an empty axis.
const hasTimeseries = computed(() => {
	return timeseries.value.markers.length > 0
		|| timeseries.value.buckets.some((b) => b.hits || b.misses || b.anomalies);
});

async function loadTimeseries() {
	try {
		const response = await api.get('/utils/cache/timeseries', {
			params: {
				window: selectedWindow.value,
				buckets: 60,
				// Only send the filter when it's a real subset; empty = all (omit it).
				...(selectedPrefixes.value.length > 0
					? { prefixes: selectedPrefixes.value.join(',') }
					: {}),
			},
		});

		// Normalise so the arrays the chart's series()/hasTimeseries read are never
		// undefined; keep the prefix option list for the filter.
		const data = response.data.data;

		timeseries.value = {
			buckets: Array.isArray(data?.buckets)
				? data.buckets
				: [],
			markers: Array.isArray(data?.markers)
				? data.markers
				: [],
			effectiveTtl: data?.effectiveTtl ?? null,
			prefixes: Array.isArray(data?.prefixes)
				? data.prefixes
				: [],
		};
	}
	catch {
		timeseries.value = {
			buckets: [],
			markers: [],
			effectiveTtl: null,
			prefixes: [],
		};
	}
}

const prefixOptions = computed(() => {
	return timeseries.value.prefixes.map((prefix) => {
		return { text: prefix, value: prefix };
	});
});

// Re-plot when the prefix filter changes; only the chart tracks it, so a full load
// isn't needed (the listing keeps its own search/filter).
watch(selectedPrefixes, () => void loadTimeseries());

function themeVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();

	return value || fallback;
}

function chartConfig(): ApexOptions {
	const buckets = timeseries.value.buckets;

	function series(pick: (b: TimeseriesBucket) => number | null) {
		return buckets.map((b): [number, number | null] => [b.t, pick(b)]);
	}

	// Single source of truth for each plotted metric: name, unit and line style
	// travel together so the tooltip, both y-axes and the stroke can't drift out
	// of series order (apexcharts indexes formatters by positional seriesIndex).
	const metrics: {
		name: string;
		unit: 'count' | 'seconds';
		curve: 'smooth' | 'stepline';
		color: string;
		pick: (b: TimeseriesBucket) => number | null;
	}[] = [
		{
			name: t('hits', 'Hits'),
			unit: 'count',
			curve: 'smooth',
			color: themeVar('--theme--success', '#2ecda7'),
			pick: (b) => b.hits,
		},
		{
			name: t('cache_misses', 'Misses'),
			unit: 'count',
			curve: 'smooth',
			color: themeVar('--theme--warning', '#ffa439'),
			pick: (b) => b.misses,
		},
		{
			name: t('cache_anomalies', 'Anomalies'),
			unit: 'count',
			curve: 'smooth',
			color: themeVar('--theme--danger', '#e35169'),
			pick: (b) => b.anomalies,
		},
		{
			name: t('ttl', 'TTL'),
			unit: 'seconds',
			curve: 'stepline',
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

	return {
		chart: {
			type: 'line',
			height: 240,
			toolbar: { show: false },
			animations: { enabled: false },
			fontFamily: 'inherit',
		},
		colors: metrics.map((m) => m.color),
		stroke: { width: 2, curve: metrics.map((m) => m.curve) },
		legend: {
			show: true,
			position: 'top',
			horizontalAlign: 'left',
			itemMargin: { horizontal: 12, vertical: 0 },
		},
		dataLabels: { enabled: false },
		series: metrics.map((m) => ({ name: m.name, data: series(m.pick) })),
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
				title: { text: t('cache_ttl_seconds', 'TTL (s)') },
				labels: { formatter: (v: number) => `${Math.round(v)}s` },
			},
		],
		tooltip: {
			y: {
				// Format by the metric's own unit, not seriesIndex — otherwise the
				// tooltip borrows yaxis[seriesIndex]'s formatter and a count series
				// picks up the TTL axis's `s` suffix (Misses shown as "2s").
				formatter: (v, { seriesIndex }) => {
					const value = Math.round(Number(v));

					return metrics[seriesIndex]?.unit === 'seconds'
						? `${value}s`
						: String(value);
				},
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
		void chart.updateOptions(chartConfig(), true, false);
		return;
	}

	chart = new ApexCharts(chartEl.value, chartConfig());
	void chart.render();
}

// Depend on chartEl too, not just the data: the chart's v-show container mounts a
// tick after the route transition settles, so a data-only watcher fires while the
// ref is still null. Re-firing when chartEl binds is what paints the first load.
watch([timeseries, chartEl], renderChart, { deep: true, flush: 'post' });

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
	return query.entries.slice(start, start + PAGE_SIZE);
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

function secLabel(ms: number): string {
	return `${Math.round(ms / 1000)}s`;
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
				inline
				@update:model-value="load"
			/>

			<v-select
				v-if="prefixOptions.length"
				v-model="selectedPrefixes"
				class="prefix-select"
				:items="prefixOptions"
				:placeholder="t('cache_prefixes', 'Endpoints')"
				multiple
				inline
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
				<div ref="chartEl" class="chart" />
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
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalMisses) }}</span>
						<span class="label">{{ t('cache_misses', 'Misses') }}</span>
					</div>
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalHits) }}</span>
						<span class="label">{{ t('cache_hits', 'Hits') }}</span>
					</div>
					<div class="metric">
						<span class="value">{{ abbreviateNumber(totalAnomalies) }}</span>
						<span class="label">{{ t('cache_anomalies', 'Anomalies') }}</span>
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

			<div v-else class="endpoints">
				<div v-for="section in sections" :key="section.key" class="section">
					<h2 class="section-title">{{ section.label }}</h2>

					<div v-for="group in section.groups" :key="group.path" class="endpoint">
						<div class="endpoint-header" @click="toggle(group.path)">
							<v-icon
								:name="expanded[group.path] ? 'expand_more' : 'chevron_right'"
								small
							/>
							<span class="path">{{ group.path }}</span>
							<span class="stat">
								{{ group.entryCount }} {{ t('entries', 'entries') }}
							</span>
							<span class="stat hits">
								{{ group.totalHits }} {{ t('hits', 'hits') }}
							</span>
							<span class="stat">{{ formatSize(group.totalSize) }}</span>
							<span v-if="group.anomalyCount" class="stat anomaly-count">
								{{ group.anomalyCount }} {{ t('anomalies_short', 'anomalies') }}
							</span>
							<span v-if="group.coarseCount" class="stat coarse-count">
								{{ group.coarseCount }} {{ t('coarse_short', 'coarse') }}
							</span>
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
						</div>

						<div v-if="expanded[group.path]" class="query-groups">
							<div v-for="q in group.queries" :key="q.key" class="query-group">
								<div class="query-header" @click="toggle(q.key)">
									<v-icon
										:name="expanded[q.key] ? 'expand_more' : 'chevron_right'"
										small
									/>
									<span class="method">{{ q.method }}</span>
									<span class="query" :title="q.query">
										{{ formatQuery(q.query) }}
									</span>
									<span class="stat">
										{{ q.entries.length }} {{ t('entries', 'entries') }}
									</span>
									<span class="stat hits">
										{{ q.totalHits }} {{ t('hits', 'hits') }}
									</span>
									<span class="stat">{{ formatSize(q.totalSize) }}</span>
									<span v-if="q.anomalyCount" class="stat anomaly-count">
										{{ q.anomalyCount }} {{ t('anomalies_short', 'anomalies') }}
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
								</div>

								<div
									v-if="expanded[q.key] && q.entries.length"
									class="entries-scroll"
								>
									<table class="entries">
										<thead>
											<tr>
												<th>{{ t('user_label', 'User') }}</th>
												<th class="num">{{ t('hits', 'Hits') }}</th>
												<th class="num">{{ t('age', 'Age') }}</th>
												<th class="num">{{ t('last_hit', 'Last hit') }}</th>
												<th class="num">
													{{ t('expires_in', 'Expires in') }}
												</th>
												<th class="num">{{ t('size', 'Size') }}</th>
												<th class="key">{{ t('key', 'Key') }}</th>
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
												<td class="num">{{ ageOf(entry.createdAt) }}</td>
												<td class="num">
													{{ lastHitOf(entry.lastHitAt) }}
												</td>
												<td class="num">
													{{ expiryOf(entry.expiresAt) }}
												</td>
												<td class="num">{{ formatSize(entry.size) }}</td>
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

/* Scoped over the header `.stat` grey rules, which are more specific than a bare
   `.anomaly-count` and would otherwise win. */
.endpoint-header .stat.anomaly-count,
.query-header .stat.anomaly-count {
	color: var(--theme--warning);
}

/* Coarse is a tuning hint, not a problem — primary (not amber) so it reads apart
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

.endpoint-header .stat.hits {
	color: var(--theme--primary);
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

.query-header .stat.hits {
	color: var(--theme--primary);
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

/* Scoped under .cache-toolbar to out-specify v-input's own `inline-size: max-content`
   (which, with the 20px inner input, otherwise collapses to the icons' width). */
.cache-toolbar .ttl-input {
	inline-size: 240px;
}

.flush-select {
	inline-size: 130px;
}
</style>
