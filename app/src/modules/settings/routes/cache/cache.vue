<script setup lang="ts">
import api from '@/api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SettingsNavigation from '../../components/navigation.vue';

interface CacheEntry {
	key: string;
	path: string;
	method: string;
	user: string | null;
	createdAt: number;
	expiresAt: number | null;
	size: number;
	hits: number;
}

interface EndpointGroup {
	path: string;
	entries: CacheEntry[];
	totalHits: number;
	totalSize: number;
}

defineOptions({ name: 'SettingsCache' });

const { t } = useI18n();

const loading = ref(false);
const error = ref<string | null>(null);
const entries = ref<CacheEntry[]>([]);
const expanded = ref<Record<string, boolean>>({});
const now = ref(Date.now());

const groups = computed<EndpointGroup[]>(() => {
	const byPath = new Map<string, CacheEntry[]>();

	for (const entry of entries.value) {
		const bucket = byPath.get(entry.path) ?? [];
		bucket.push(entry);
		byPath.set(entry.path, bucket);
	}

	const result: EndpointGroup[] = [];

	for (const [path, groupEntries] of byPath) {
		result.push({
			path,
			entries: groupEntries,
			totalHits: groupEntries.reduce((sum, entry) => sum + entry.hits, 0),
			totalSize: groupEntries.reduce((sum, entry) => sum + entry.size, 0),
		});
	}

	return result.sort((a, b) => b.totalHits - a.totalHits);
});

const totalEntries = computed(() => entries.value.length);

const totalHits = computed(() => {
	return entries.value.reduce((sum, entry) => sum + entry.hits, 0);
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

async function evictEntry(entry: CacheEntry) {
	await api.delete('/utils/cache', { params: { key: entry.key } });
	await load();
}

async function evictPath(path: string) {
	await api.delete('/utils/cache', { params: { path } });
	await load();
}

function toggle(path: string) {
	expanded.value[path] = !expanded.value[path];
}

function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExpiry(expiresAt: number | null): string {
	if (expiresAt === null) {
		return '∞';
	}

	const seconds = Math.round((expiresAt - now.value) / 1000);

	if (seconds <= 0) {
		return t('expired', 'expired');
	}

	if (seconds < 60) {
		return `${seconds}s`;
	}

	if (seconds < 3600) {
		return `${Math.round(seconds / 60)}m`;
	}

	return `${Math.round(seconds / 3600)}h`;
}

function formatUser(user: string | null): string {
	return user ?? t('public_label', 'public');
}

onMounted(load);
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
		</template>

		<template #navigation>
			<settings-navigation />
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
				<div v-for="group in groups" :key="group.path" class="endpoint">
					<div class="endpoint-header" @click="toggle(group.path)">
						<v-icon
							:name="expanded[group.path] ? 'expand_more' : 'chevron_right'"
							small
						/>
						<span class="path">{{ group.path }}</span>
						<span class="stat">
							{{ group.entries.length }} {{ t('entries', 'entries') }}
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

					<table v-if="expanded[group.path]" class="entries">
						<thead>
							<tr>
								<th>{{ t('user_label', 'User') }}</th>
								<th class="num">{{ t('hits', 'Hits') }}</th>
								<th class="num">{{ t('expires_in', 'Expires in') }}</th>
								<th class="num">{{ t('size', 'Size') }}</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="entry in group.entries" :key="entry.key">
								<td>{{ formatUser(entry.user) }}</td>
								<td class="num">{{ entry.hits }}</td>
								<td class="num">{{ formatExpiry(entry.expiresAt) }}</td>
								<td class="num">{{ formatSize(entry.size) }}</td>
								<td class="num">
									<v-icon
										v-tooltip.bottom="t('evict_entry', 'Evict this entry')"
										name="delete"
										small
										clickable
										@click="evictEntry(entry)"
									/>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		</div>
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

table.entries {
	inline-size: 100%;
	border-collapse: collapse;
	border-block-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
	font-size: 13px;
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
</style>
