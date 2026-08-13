<script setup lang="ts">
import api from '@/api';
import { formatDuration } from '@/utils/format-duration';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import type {
	PgBouncerInstance,
	PgBouncerPool,
	PgBouncerReport,
} from '@directus/types';
import ApexCharts, { type ApexOptions } from 'apexcharts';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import SettingsNavigation from '../../components/navigation.vue';
import {
	type PgBouncerSample,
	appendSample,
	clientsOfPool,
	isPoolNearCapacity,
	isPoolQueueing,
	pgbouncerTotals,
	poolSaturation,
	serverConnections,
	serversOfPool,
	statsForDatabase,
} from './pgbouncer-view';

defineOptions({ name: 'SettingsPgBouncer' });

const { t } = useI18n();

const loading = ref(false);
const error = ref<string | null>(null);
const report = ref<PgBouncerReport | null>(null);

// Live by default: this page is read while something is queueing, and a manual
// refresh is the wrong ergonomics for that.
const refreshInterval = ref<number | null>(5);

const samples = ref<PgBouncerSample[]>([]);

/** Which pool's connections are open, if any — `instance id` plus database. */
const openPool = ref<{ instanceId: string; database: string } | null>(null);

const totals = computed(() => {
	return report.value === null
		? null
		: pgbouncerTotals(report.value);
});

function isOpen(instance: PgBouncerInstance, pool: PgBouncerPool): boolean {
	return openPool.value?.instanceId === instance.id
		&& openPool.value.database === pool.database;
}

function togglePool(instance: PgBouncerInstance, pool: PgBouncerPool): void {
	openPool.value = isOpen(instance, pool)
		? null
		: { instanceId: instance.id, database: pool.database };

	// The open pool decides whether the connection lists are asked for at all,
	// so opening one has to fetch them rather than wait for the next tick.
	void load();
}

function saturationPercent(pool: PgBouncerPool): string {
	const saturation = poolSaturation(pool);

	return saturation === null
		? '—'
		: `${Math.round(saturation * 100)}%`;
}

/** The width of the filled part of a row's bar, capped at full. */
function saturationWidth(pool: PgBouncerPool): string {
	const saturation = poolSaturation(pool) ?? 0;

	return `${Math.min(100, Math.round(saturation * 100))}%`;
}

function capacityLabel(pool: PgBouncerPool): string {
	const size = pool.poolSize === null
		? t('pgbouncer_inherited', 'default')
		: String(pool.poolSize);

	return `${serverConnections(pool)} / ${size}`;
}

function queriesPerSecond(
	instance: PgBouncerInstance,
	pool: PgBouncerPool,
): string {
	const stats = statsForDatabase(instance, pool.database);

	return stats === null
		? '—'
		: `${Math.round(stats.avgQueryCount)}/s`;
}

/**
 * A wait is read against `query_wait_timeout`, which is a second or two — so the
 * sub-second range is the one that has to stay legible, and only a wait long
 * enough to be a stall is worth spelling out in minutes.
 */
function waitLabel(milliseconds: number): string {
	if (milliseconds === 0) {
		return '—';
	}

	if (milliseconds < 1000) {
		return `${Math.round(milliseconds)}ms`;
	}

	if (milliseconds < 60_000) {
		return `${(milliseconds / 1000).toFixed(1)}s`;
	}

	return formatDuration(Math.round(milliseconds / 1000));
}

function themeVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();

	return value || fallback;
}

const chartEl = ref<HTMLElement | null>(null);
let chart: ApexCharts | null = null;

/**
 * The three readings that say whether the fleet is coping: how many clients are
 * queueing, how many backends are busy, and how long the oldest waiter has
 * waited. Plotted against the samples taken while the page was open — there is
 * no stored history, so a reload starts the chart over.
 */
function chartOptions(): ApexOptions {
	const points = samples.value;

	return {
		chart: {
			type: 'line',
			height: 220,
			animations: { enabled: false },
			toolbar: { show: false },
			fontFamily: 'var(--theme--fonts--sans--font-family)',
		},
		colors: [
			themeVar('--theme--danger', '#e35169'),
			themeVar('--theme--primary', '#6644ff'),
			themeVar('--theme--warning', '#ffa439'),
		],
		stroke: { width: 2, curve: 'straight' },
		markers: { size: 0 },
		dataLabels: { enabled: false },
		legend: { show: true, position: 'top', horizontalAlign: 'left' },
		grid: { borderColor: themeVar('--theme--border-color-subdued', '#e4eaf1') },
		xaxis: {
			type: 'datetime',
			categories: points.map((point) => point.at),
			labels: { datetimeUTC: false },
		},
		yaxis: [
			{
				seriesName: t('pgbouncer_clients_waiting', 'Clients waiting'),
				title: { text: t('pgbouncer_connections', 'Connections') },
				min: 0,
				forceNiceScale: true,
			},
			{
				seriesName: t('pgbouncer_clients_waiting', 'Clients waiting'),
				show: false,
			},
			{
				opposite: true,
				title: { text: t('pgbouncer_wait', 'Wait (ms)') },
				min: 0,
				forceNiceScale: true,
			},
		],
		series: [
			{
				name: t('pgbouncer_clients_waiting', 'Clients waiting'),
				data: points.map((point) => point.clientsWaiting),
			},
			{
				name: t('pgbouncer_servers_active', 'Servers busy'),
				data: points.map((point) => point.serversActive),
			},
			{
				name: t('pgbouncer_max_wait', 'Max wait'),
				data: points.map((point) => Math.round(point.maxWaitMs)),
			},
		],
	};
}

async function renderChart(): Promise<void> {
	if (chartEl.value === null) {
		return;
	}

	if (chart === null) {
		chart = new ApexCharts(chartEl.value, chartOptions());
		await chart.render();
		return;
	}

	await chart.updateOptions(chartOptions(), true, false);
}

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;

	// The connection lists are thousands of rows on a busy pooler, so they are
	// only asked for while a pool is open to show them.
	const details = openPool.value === null
		? 'pools,stats,limits'
		: 'pools,stats,limits,clients,servers';

	try {
		const response = await api.get('/utils/pgbouncer', { params: { details } });

		report.value = response.data.data;
		samples.value = appendSample(samples.value, response.data.data);

		await renderChart();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
		report.value = null;
	}
	finally {
		loading.value = false;
	}
}

watch(chartEl, () => void renderChart());

onMounted(load);

onUnmounted(() => {
	chart?.destroy();
	chart = null;
});
</script>

<template>
	<private-view :title="t('pgbouncer', 'PgBouncer')">
		<template #headline>
			<v-breadcrumb :items="[{ name: t('settings'), to: '/settings' }]" />
		</template>

		<template #title-outer:prepend>
			<v-button class="header-icon" rounded icon exact disabled>
				<v-icon name="hub" />
			</v-button>
		</template>

		<template #actions>
			<v-button
				v-tooltip.bottom="t('refresh')"
				rounded
				icon
				:loading="loading"
				@click="load"
			>
				<v-icon name="refresh" />
			</v-button>
		</template>

		<template #navigation>
			<settings-navigation />
		</template>

		<template #sidebar>
			<auto-refresh
				v-model="refreshInterval"
				:intervals="[null, 2, 5, 10, 30, 60]"
				@refresh="load"
			/>
		</template>

		<div class="pgbouncer-page">
			<v-notice v-if="error" type="danger">{{ error }}</v-notice>

			<v-notice
				v-if="report && report.instances.length === 0"
				type="info"
			>
				{{ t(
					'pgbouncer_none_configured',
					'No DB connection is declared as going through pgbouncer '
						+ '(PGBOUNCER_CONNECTIONS).',
				) }}
			</v-notice>

			<div v-if="totals" class="totals">
				<div class="tile" :class="{ danger: totals.clientsWaiting > 0 }">
					<span class="value">{{ totals.clientsWaiting }}</span>
					<span class="label">
						{{ t('pgbouncer_clients_waiting', 'Clients waiting') }}
					</span>
				</div>
				<div class="tile">
					<span class="value">{{ totals.clientsActive }}</span>
					<span class="label">
						{{ t('pgbouncer_clients_active', 'Clients active') }}
					</span>
				</div>
				<div class="tile">
					<span class="value">
						{{ totals.serversActive }} / {{ totals.serverCapacity }}
					</span>
					<span class="label">
						{{ t('pgbouncer_servers', 'Server connections') }}
					</span>
				</div>
				<div class="tile" :class="{ warning: totals.maxWaitMs > 0 }">
					<span class="value">{{ waitLabel(totals.maxWaitMs) }}</span>
					<span class="label">{{ t('pgbouncer_max_wait', 'Max wait') }}</span>
				</div>
				<div class="tile">
					<span class="value">{{ Math.round(totals.queriesPerSecond) }}/s</span>
					<span class="label">{{ t('pgbouncer_queries', 'Queries') }}</span>
				</div>
				<div class="tile">
					<span class="value">
						{{ Math.round(totals.transactionsPerSecond) }}/s
					</span>
					<span class="label">
						{{ t('pgbouncer_transactions', 'Transactions') }}
					</span>
				</div>
			</div>

			<div v-show="samples.length > 1" ref="chartEl" class="chart" />

			<v-progress-linear v-if="loading && !report" indeterminate />

			<div
				v-for="instance in report?.instances ?? []"
				:key="instance.id"
				class="instance"
			>
				<div class="instance-head">
					<v-icon name="hub" small />
					<span class="instance-id">{{ instance.id }}</span>
					<span class="version">{{ instance.version ?? '' }}</span>
					<v-chip
						v-for="connection in instance.connections"
						:key="connection"
						small
					>
						{{ connection }}
					</v-chip>
				</div>

				<v-notice v-if="!instance.reachable" type="danger">
					{{ instance.error }}
				</v-notice>

				<div v-if="instance.limits.length > 0" class="limits">
					<span
						v-for="limit in instance.limits"
						:key="limit.key"
						class="limit"
						:class="{ overridden: !limit.isDefault }"
					>
						<span class="limit-key">{{ limit.key }}</span>
						<span class="limit-value">{{ limit.value }}</span>
					</span>
				</div>

				<div v-for="pool in instance.pools" :key="pool.database" class="pool">
					<button
						type="button"
						class="pool-row"
						:class="{
							danger: isPoolQueueing(pool),
							warning: isPoolNearCapacity(pool),
							paused: pool.paused || pool.disabled,
						}"
						@click="togglePool(instance, pool)"
					>
						<v-icon
							:name="isOpen(instance, pool)
								? 'expand_more'
								: 'chevron_right'"
							small
						/>
						<span class="database">{{ pool.database }}</span>
						<span class="user">{{ pool.user }}</span>
						<span class="mode">{{ pool.poolMode }}</span>
						<span class="bar">
							<span class="fill" :style="{ width: saturationWidth(pool) }" />
						</span>
						<span class="capacity">{{ capacityLabel(pool) }}</span>
						<span class="saturation">{{ saturationPercent(pool) }}</span>
						<span class="waiting">
							{{ t('pgbouncer_waiting_short', 'waiting') }}
							{{ pool.clientsWaiting }}
						</span>
						<span class="wait">{{ waitLabel(pool.maxWaitMs) }}</span>
						<span class="rate">{{ queriesPerSecond(instance, pool) }}</span>
						<v-chip
							v-for="connection in pool.connections"
							:key="connection"
							x-small
						>
							{{ connection }}
						</v-chip>
					</button>

					<div v-if="isOpen(instance, pool)" class="connections">
						<h3>{{ t('pgbouncer_clients', 'Clients') }}</h3>
						<table>
							<thead>
								<tr>
									<th>{{ t('pgbouncer_application', 'Application') }}</th>
									<th>{{ t('pgbouncer_address', 'Address') }}</th>
									<th>{{ t('user', 'User') }}</th>
									<th>{{ t('pgbouncer_state', 'State') }}</th>
									<th>{{ t('pgbouncer_wait', 'Wait') }}</th>
									<th>{{ t('pgbouncer_since', 'Since') }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="client in clientsOfPool(instance, pool)"
									:key="`${client.addr}:${client.port}`"
								>
									<td>{{ client.applicationName || '—' }}</td>
									<td>{{ client.addr }}:{{ client.port }}</td>
									<td>{{ client.user }}</td>
									<td>{{ client.state }}</td>
									<td>{{ waitLabel(client.waitMs) }}</td>
									<td>{{ client.connectedAt }}</td>
								</tr>
							</tbody>
						</table>

						<h3>{{ t('pgbouncer_servers', 'Servers') }}</h3>
						<table>
							<thead>
								<tr>
									<th>{{ t('pgbouncer_address', 'Address') }}</th>
									<th>{{ t('user', 'User') }}</th>
									<th>{{ t('pgbouncer_state', 'State') }}</th>
									<th>{{ t('pgbouncer_backend_pid', 'Backend pid') }}</th>
									<th>{{ t('pgbouncer_since', 'Since') }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="server in serversOfPool(instance, pool)"
									:key="`${server.addr}:${server.port}`"
								>
									<td>{{ server.addr }}:{{ server.port }}</td>
									<td>{{ server.user }}</td>
									<td>{{ server.state }}</td>
									<td>{{ server.remotePid ?? '—' }}</td>
									<td>{{ server.connectedAt }}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	</private-view>
</template>

<style scoped>
.pgbouncer-page {
	padding: var(--content-padding);
	padding-block-start: 0;
}

.totals {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-block-end: 20px;
}

.tile {
	display: flex;
	flex-direction: column;
	min-inline-size: 140px;
	padding: 12px 16px;
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
}

.tile.danger {
	border-color: var(--theme--danger);
}

.tile.warning {
	border-color: var(--theme--warning);
}

.tile .value {
	font-size: 20px;
	font-weight: 700;
}

.tile .label {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.chart {
	margin-block-end: 20px;
}

.instance {
	margin-block-end: 24px;
}

.instance-head {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-block-end: 8px;
}

.instance-id {
	font-family: var(--theme--fonts--monospace--font-family);
	font-weight: 700;
}

.version,
.limits,
.pool-row .mode,
.pool-row .user {
	color: var(--theme--foreground-subdued);
}

.limits {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-block-end: 12px;
	font-size: 12px;
}

.limit-key::after {
	content: ' ';
}

.limit.overridden .limit-value {
	color: var(--theme--foreground);
	font-weight: 700;
}

.pool-row {
	display: flex;
	align-items: center;
	gap: 12px;
	inline-size: 100%;
	padding: 8px 12px;
	border-block-end: var(--theme--border-width) solid
		var(--theme--border-color-subdued);
	text-align: start;
}

.pool-row.warning {
	background-color: var(--theme--warning-background);
}

.pool-row.danger {
	background-color: var(--theme--danger-background);
}

.pool-row.paused {
	opacity: 0.6;
}

.pool-row .database {
	flex-shrink: 0;
	inline-size: 200px;
	font-family: var(--theme--fonts--monospace--font-family);
}

.pool-row .bar {
	flex-shrink: 0;
	inline-size: 120px;
	block-size: 8px;
	border-radius: 4px;
	background-color: var(--theme--background-normal);
}

.pool-row .fill {
	display: block;
	block-size: 100%;
	border-radius: 4px;
	background-color: var(--theme--primary);
}

.connections {
	padding: 8px 12px 16px;
}

.connections table {
	inline-size: 100%;
	border-collapse: collapse;
	font-size: 13px;
}

.connections th {
	color: var(--theme--foreground-subdued);
	text-align: start;
}

.connections td,
.connections th {
	padding: 4px 8px;
}
</style>
