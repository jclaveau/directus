<script setup lang="ts">
import api from '@/api';
import { formatDuration } from '@/utils/format-duration';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import type {
	PgBouncerInstance,
	PgBouncerLimit,
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
 * What every value on the page means, and which pgbouncer column it is read
 * from. Kept here rather than in the markup because the wording belongs beside
 * the metric it explains — and because a template line cannot be wrapped.
 */
const hints = computed(() => {
	return {
		clientsWaiting: t(
			'pgbouncer_clients_waiting_hint',
			'Clients queued for a server across every pool (cl_waiting). Past '
			+ 'query_wait_timeout they are answered with an error, so this is a '
			+ 'countdown rather than a load reading.',
		),
		clientsActive: t(
			'pgbouncer_clients_active_hint',
			'Clients currently paired with a server connection (cl_active). In '
			+ 'transaction pooling a client holds one only for the length of its '
			+ 'transaction.',
		),
		servers: t(
			'pgbouncer_servers_hint',
			'Busy Postgres backends (sv_active) against the summed pool_size of '
			+ 'every pool that declares one. Pools left on the global default add '
			+ 'nothing to the total.',
		),
		maxWait: t(
			'pgbouncer_max_wait_hint',
			'How long the oldest queued client has waited, worst pool (maxwait). '
			+ 'Climbing towards query_wait_timeout means the pool is too small or '
			+ 'Postgres is too slow.',
		),
		queries: t(
			'pgbouncer_queries_hint',
			'Queries per second, as pgbouncer averaged them over its own last '
			+ 'stats period (avg_query_count) — not a difference between two '
			+ 'refreshes of this page.',
		),
		transactions: t(
			'pgbouncer_transactions_hint',
			'Transactions per second over the same period (avg_xact_count). In '
			+ 'transaction pooling this is how often a server connection changes '
			+ 'hands.',
		),
		instance: t(
			'pgbouncer_instance_hint',
			'The admin console this was read from. Pools and counters belong to '
			+ 'one pgbouncer process — several behind one address each answer only '
			+ 'for themselves.',
		),
		instanceConnection: t(
			'pgbouncer_instance_connection_hint',
			'A DB connection of this deployment that reaches Postgres through this '
			+ 'pgbouncer (named in PGBOUNCER_CONNECTIONS).',
		),
		database: t(
			'pgbouncer_database_hint',
			'The pgbouncer database a client connects to. It is a pool of its own, '
			+ 'whatever Postgres database it forwards to.',
		),
		user: t(
			'pgbouncer_user_hint',
			'The user this pool is opened as — pgbouncer keeps one pool per '
			+ 'database and user pair.',
		),
		mode: t(
			'pgbouncer_mode_hint',
			'When a server connection goes back to the pool: after each '
			+ 'transaction, after each statement, or when the client disconnects '
			+ '(pool_mode).',
		),
		capacity: t(
			'pgbouncer_capacity_hint',
			'Server connections this pool holds, of the pool_size it is allowed. A '
			+ 'pool left on the global default reads as “default”, since it '
			+ 'declares no size of its own.',
		),
		waiting: t(
			'pgbouncer_waiting_hint',
			'Clients queued for a server on this pool (cl_waiting). Above zero '
			+ 'means every server it is allowed is already busy.',
		),
		poolWait: t(
			'pgbouncer_pool_wait_hint',
			'How long the oldest queued client on this pool has waited (maxwait). '
			+ 'Zero when nobody is queueing.',
		),
		rate: t(
			'pgbouncer_rate_hint',
			'Queries per second on this pool, averaged by pgbouncer over its last '
			+ 'stats period (avg_query_count).',
		),
		poolConnection: t(
			'pgbouncer_pool_connection_hint',
			'The DB connection whose traffic lands in this pool — a policy '
			+ 'granting it routes requests here.',
		),
		application: t(
			'pgbouncer_application_hint',
			'What the client called itself. Directus announces every pool as '
			+ 'directus:<node>:<connection>, so a row names the process it came '
			+ 'from and the connection that routed it — the same node id the '
			+ 'Processes page lists.',
		),
		clientState: t(
			'pgbouncer_client_state_hint',
			'active while paired with a server, waiting while queued for one, '
			+ 'idle between requests.',
		),
		clientWait: t(
			'pgbouncer_client_wait_hint',
			'How long this client’s current request has been outstanding. For a '
			+ 'waiting client that is its time in the queue; for an active one, '
			+ 'how long its query has been running.',
		),
		clientSince: t(
			'pgbouncer_client_since_hint',
			'When this client connected to pgbouncer, not when its current '
			+ 'request started.',
		),
		serverState: t(
			'pgbouncer_server_state_hint',
			'active while running a client’s transaction, idle while waiting to be '
			+ 'handed to one, login while still connecting.',
		),
		backendPid: t(
			'pgbouncer_backend_pid_hint',
			'The Postgres backend behind this connection — the pid to look for in '
			+ 'pg_stat_activity, or to pass to pg_terminate_backend.',
		),
		serverSince: t(
			'pgbouncer_server_since_hint',
			'When pgbouncer opened this backend. It is retired at server_lifetime '
			+ 'however busy it is.',
		),
	};
});

/**
 * What the bar and the percentage beside it measure. A pool on the global
 * default has no size of its own, so there is nothing to measure it against and
 * the tooltip says so rather than leaving an empty bar unexplained.
 */
function saturationHint(pool: PgBouncerPool): string {
	if (poolSaturation(pool) === null) {
		return t(
			'pgbouncer_saturation_inherited_hint',
			'This pool inherits the global default_pool_size, so it declares no '
			+ 'size of its own to measure against — the bar stays empty on purpose.',
		);
	}

	return t(
		'pgbouncer_saturation_hint',
		'Busy server connections over this pool’s own pool_size '
		+ '(sv_active / pool_size). At 100% the next client has to queue.',
	);
}

/** What one pgbouncer setting decides, and whether it was left at its default. */
function limitHint(limit: PgBouncerLimit): string {
	const meanings: Record<string, string> = {
		pool_mode: hints.value.mode,
		default_pool_size: t(
			'pgbouncer_limit_default_pool_size',
			'How many server connections a pool gets when it declares no '
			+ 'pool_size of its own.',
		),
		min_pool_size: t(
			'pgbouncer_limit_min_pool_size',
			'How many server connections a pool keeps open even while idle, so a '
			+ 'burst does not pay for connecting.',
		),
		reserve_pool_size: t(
			'pgbouncer_limit_reserve_pool_size',
			'Extra server connections a pool may take once clients have queued '
			+ 'for longer than reserve_pool_timeout.',
		),
		max_client_conn: t(
			'pgbouncer_limit_max_client_conn',
			'How many clients this pgbouncer accepts in total, across every pool. '
			+ 'Past it, connecting fails outright.',
		),
		max_db_connections: t(
			'pgbouncer_limit_max_db_connections',
			'Ceiling on server connections per database, whatever the individual '
			+ 'pools are sized at. Zero means no ceiling.',
		),
		max_user_connections: t(
			'pgbouncer_limit_max_user_connections',
			'Ceiling on server connections per user, whatever the individual '
			+ 'pools are sized at. Zero means no ceiling.',
		),
		query_wait_timeout: t(
			'pgbouncer_limit_query_wait_timeout',
			'How long a client may queue for a server before pgbouncer answers it '
			+ 'with an error — the deadline the max wait above counts towards.',
		),
		server_idle_timeout: t(
			'pgbouncer_limit_server_idle_timeout',
			'How long an unused server connection is kept before it is closed.',
		),
		server_lifetime: t(
			'pgbouncer_limit_server_lifetime',
			'How old a server connection may get before it is retired and '
			+ 'reopened, however busy it is.',
		),
	};

	const meaning = meanings[limit.key] ?? '';

	if (limit.isDefault) {
		const left = t('pgbouncer_limit_is_default', 'Left at pgbouncer’s default.');

		return `${meaning} ${left}`;
	}

	const changed = t(
		'pgbouncer_limit_overridden',
		'Configured; pgbouncer’s default is',
	);

	return `${meaning} ${changed} ${limit.default}.`;
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
				<div
					v-tooltip.bottom="hints.clientsWaiting"
					class="tile"
					:class="{ danger: totals.clientsWaiting > 0 }"
				>
					<span class="value">{{ totals.clientsWaiting }}</span>
					<span class="label">
						{{ t('pgbouncer_clients_waiting', 'Clients waiting') }}
					</span>
				</div>
				<div
					v-tooltip.bottom="hints.clientsActive"
					class="tile"
				>
					<span class="value">{{ totals.clientsActive }}</span>
					<span class="label">
						{{ t('pgbouncer_clients_active', 'Clients active') }}
					</span>
				</div>
				<div
					v-tooltip.bottom="hints.servers"
					class="tile"
				>
					<span class="value">
						{{ totals.serversActive }} / {{ totals.serverCapacity }}
					</span>
					<span class="label">
						{{ t('pgbouncer_servers', 'Server connections') }}
					</span>
				</div>
				<div
					v-tooltip.bottom="hints.maxWait"
					class="tile"
					:class="{ warning: totals.maxWaitMs > 0 }"
				>
					<span class="value">{{ waitLabel(totals.maxWaitMs) }}</span>
					<span class="label">{{ t('pgbouncer_max_wait', 'Max wait') }}</span>
				</div>
				<div
					v-tooltip.bottom="hints.queries"
					class="tile"
				>
					<span class="value">{{ Math.round(totals.queriesPerSecond) }}/s</span>
					<span class="label">{{ t('pgbouncer_queries', 'Queries') }}</span>
				</div>
				<div
					v-tooltip.bottom="hints.transactions"
					class="tile"
				>
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
					<span
						v-tooltip.bottom="hints.instance"
						class="instance-id"
					>{{ instance.id }}</span>
					<span class="version">{{ instance.version ?? '' }}</span>
					<v-chip
						v-for="connection in instance.connections"
						:key="connection"
						v-tooltip.bottom="hints.instanceConnection"
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
						v-tooltip.bottom="limitHint(limit)"
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
						<span
							v-tooltip.bottom="hints.database"
							class="database"
						>{{ pool.database }}</span>
						<span
							v-tooltip.bottom="hints.user"
							class="user"
						>{{ pool.user }}</span>
						<span
							v-tooltip.bottom="hints.mode"
							class="mode"
						>{{ pool.poolMode }}</span>
						<span
							v-tooltip.bottom="saturationHint(pool)"
							class="bar"
						>
							<span class="fill" :style="{ width: saturationWidth(pool) }" />
						</span>
						<span
							v-tooltip.bottom="hints.capacity"
							class="capacity"
						>{{ capacityLabel(pool) }}</span>
						<span
							v-tooltip.bottom="saturationHint(pool)"
							class="saturation"
						>{{ saturationPercent(pool) }}</span>
						<span
							v-tooltip.bottom="hints.waiting"
							class="waiting"
						>
							{{ t('pgbouncer_waiting_short', 'waiting') }}
							{{ pool.clientsWaiting }}
						</span>
						<span
							v-tooltip.bottom="hints.poolWait"
							class="wait"
						>{{ waitLabel(pool.maxWaitMs) }}</span>
						<span
							v-tooltip.bottom="hints.rate"
							class="rate"
						>{{ queriesPerSecond(instance, pool) }}</span>
						<v-chip
							v-for="connection in pool.connections"
							:key="connection"
							v-tooltip.bottom="hints.poolConnection"
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
									<th
										v-tooltip.bottom="hints.application"
									>{{ t('pgbouncer_application', 'Application') }}</th>
									<th>{{ t('pgbouncer_address', 'Address') }}</th>
									<th>{{ t('user', 'User') }}</th>
									<th
										v-tooltip.bottom="hints.clientState"
									>{{ t('pgbouncer_state', 'State') }}</th>
									<th
										v-tooltip.bottom="hints.clientWait"
									>{{ t('pgbouncer_wait', 'Wait') }}</th>
									<th
										v-tooltip.bottom="hints.clientSince"
									>{{ t('pgbouncer_since', 'Since') }}</th>
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
									<th
										v-tooltip.bottom="hints.serverState"
									>{{ t('pgbouncer_state', 'State') }}</th>
									<th
										v-tooltip.bottom="hints.backendPid"
									>{{ t('pgbouncer_backend_pid', 'Backend pid') }}</th>
									<th
										v-tooltip.bottom="hints.serverSince"
									>{{ t('pgbouncer_since', 'Since') }}</th>
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
