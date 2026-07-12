<script setup lang="ts">
import api from '@/api';
import { useClipboard } from '@/composables/use-clipboard';
import { getRootPath } from '@/utils/get-root-path';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Filter } from '@directus/types';
import SettingsNavigation from '../../components/navigation.vue';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import SearchInput from '@/views/private/components/search-input.vue';
import {
	buildGroups,
	filterEntries,
	formatAge,
	formatExpiry,
	formatLastHit,
	formatQuery,
	formatSize,
	formatUser,
	shortKey,
	splitSections,
	ttlVerdict,
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
const expanded = ref<Record<string, boolean>>({});
const now = ref(Date.now());
const refreshInterval = ref<number | null>(null);
const search = ref('');
const filter = ref<Filter | null>(null);
const entryPage = ref<Record<string, number>>({});

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

		// Surface the un-flushed Redis buffer so a backlog (watchdog territory) is visible.
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
		{ label: t('key', 'Key'), value: entry.key },
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

const groups = computed<EndpointGroup[]>(() => buildGroups(searchedEntries.value));

const sections = computed(() => {
	return splitSections(
		groups.value,
		t('app_label', 'App'),
		t('system_label', 'System'),
	);
});

// Track the filtered list so entries/hits agree with the endpoint count under a filter.
const totalEntries = computed(() => searchedEntries.value.length);

const totalHits = computed(() => {
	return searchedEntries.value.reduce((sum, entry) => sum + entry.hits, 0);
});

async function load() {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get('/utils/cache');
		entries.value = response.data.data;
		now.value = Date.now();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		loading.value = false;
	}
}

async function loadStatsState() {
	try {
		const response = await api.get('/utils/cache/stats');
		statsState.value = response.data.data;
	}
	catch {
		statsState.value = null;
	}
}

// Flip collection at runtime (Redis flag; every node picks it up within a poll
// tick). Re-enabling also clears an autokill reason server-side.
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

	try {
		await api.delete('/utils/cache', { params: { key: entry.key } });
		await load();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
}

async function evictPath(path: string) {
	error.value = null;

	try {
		await api.delete('/utils/cache', { params: { path } });
		await load();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
}

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
	selectedEntry.value = entry;
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
			params: { key: entry.key },
		});

		// A quick second row click supersedes this fetch; ignore a late response for a
		// no-longer-selected entry so it can't overwrite the currently-open one.
		if (selectedEntry.value?.key !== entry.key) {
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
		if (selectedEntry.value?.key === entry.key) {
			cachedValueExists.value = false;
		}
	}
	finally {
		if (selectedEntry.value?.key === entry.key) {
			valueLoading.value = false;
		}
	}
}

function closeEntry() {
	selectedEntry.value = null;
}

onMounted(() => {
	void load();
	void loadStatsState();
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
			<auto-refresh v-model="refreshInterval" @refresh="load" />
		</template>

		<div class="cache-page">
			<v-notice v-if="error" type="danger">{{ error }}</v-notice>

			<div class="summary">
				<div class="metric">
					<span class="value">{{ totalEntries }}</span>
					<span class="label">{{ t('cached_entries', 'Cached entries') }}</span>
				</div>
				<div class="metric">
					<span class="value">{{ totalHits }}</span>
					<span class="label">{{ t('total_hits', 'Total hits') }}</span>
				</div>
				<div class="metric">
					<span class="value">{{ groups.length }}</span>
					<span class="label">{{ t('endpoints', 'Endpoints') }}</span>
				</div>
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
							<v-button
								v-tooltip.bottom="t('evict_endpoint', 'Evict this endpoint')"
								x-small
								kind="danger"
								secondary
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

								<div v-if="expanded[q.key]" class="entries-scroll">
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
												<td class="key" :title="entry.key">
													{{ shortKey(entry.key) }}
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
						{{ t('cache_value_absent', 'Not in the cache (evicted or expired)') }}
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
	gap: 32px;
	margin-block-end: 24px;
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
</style>
