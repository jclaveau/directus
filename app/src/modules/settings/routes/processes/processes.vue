<script setup lang="ts">
import api from '@/api';
import { useClipboard } from '@/composables/use-clipboard';
import { useRefreshInterval } from '@/composables/use-refresh-interval';
import { formatDuration } from '@/utils/format-duration';
import { formatFilesize } from '@/utils/format-filesize';
import { getStringifiedValue } from '@/utils/get-stringified-value';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import type { HeaderRaw, Sort } from '@/components/v-table/types';
import type {
	AutoscaleRunner,
	ProcessNode,
	ProcessReplica,
	ProcessesReport,
	ResolvedEnvVariable,
} from '@directus/types';
import { useLocalStorage } from '@vueuse/core';
import ApexCharts, { type ApexOptions } from 'apexcharts';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SettingsNavigation from '../../components/navigation.vue';
import AutoscalePanel from './autoscale-panel.vue';
import {
	appendProcessSample,
	capacitySeries,
	chartSeries,
	cpuPercent,
	filterEnvVariables,
	hasMetric,
	isNearMemoryCap,
	latestSample,
	memoryCapRatio,
	processTotals,
	shareOfCapacity,
	type ProcessSample,
} from './processes-view';

defineOptions({ name: 'SettingsProcesses' });

const { t } = useI18n();
const { copyToClipboard } = useClipboard();

const loading = ref(false);
const error = ref<string | null>(null);
const report = ref<ProcessesReport | null>(null);
const refreshInterval = useRefreshInterval('settings-processes-refresh-interval');
const expanded = ref<Record<string, boolean>>({});
const envSearch = ref<Record<string, string>>({});
const samples = ref<ProcessSample[]>([]);

// How the resolved env reads: a resizable table, or the two shapes it is
// actually pasted into — a .env file and JSON. Kept per user, like the cache
// page's view state, so a preference survives a reload.
const envView = useLocalStorage<string[]>('settings-processes-env-view', ['table']);

// `v-table` writes the widths back through this model, so persisting it is all
// column resizing needs to stick.
const envHeaders = useLocalStorage<HeaderRaw[]>('settings-processes-env-headers', [
	{ text: 'Variable', value: 'key', width: 320, sortable: true },
	{ text: 'Value', value: 'value', width: 520, sortable: true },
	{ text: 'From', value: 'source', width: 140, sortable: true },
]);

// `v-table` reports which column was clicked but never reorders anything, so
// the rows are sorted here — without this the sort arrows move and nothing else
// does. Null is the order the API answered in, which is already by key.
const envSort = ref<Sort | null>(null);

const totals = computed(() => {
	return report.value === null
		? null
		: processTotals(report.value);
});

const carriesEnv = computed(() => {
	return report.value?.details.includes('env') === true;
});

/**
 * One row per process, carrying the key the expand/search state is stored under
 * — a process is only identified by its replica plus its slot in it.
 */
function processRows(replica: ProcessReplica) {
	return replica.processes.map((node) => {
		return {
			key: `${replica.replicaId}::${node.pmId ?? node.pid ?? node.nodeId}`,
			node,
		};
	});
}

function toggle(key: string): void {
	expanded.value[key] = !expanded.value[key];
}

function envOf(key: string, node: ProcessNode): ResolvedEnvVariable[] {
	const rows = filterEnvVariables(node.env ?? [], envSearch.value[key] ?? '');
	const sort = envSort.value;

	if (!sort?.by) {
		return rows;
	}

	const field = sort.by as keyof ResolvedEnvVariable;

	// A redacted value reads as empty rather than as "null", so the redacted keys
	// group together instead of sorting under the letter n.
	return [...rows].sort((one, other) => {
		const left = String(one[field] ?? '');
		const right = String(other[field] ?? '');

		return sort.desc
			? right.localeCompare(left)
			: left.localeCompare(right);
	});
}

/** What the JSON view shows, stringified the way the code viewer does it. */
function envAsJson(key: string, node: ProcessNode): string {
	return getStringifiedValue(envOf(key, node), true);
}

/** The same rows a .env file would carry, redaction included. */
function envAsDotenv(key: string, node: ProcessNode): string {
	return envOf(key, node)
		.map((variable) => {
			if (variable.redacted) {
				return `${variable.key}=<redacted>`;
			}

			return `${variable.key}=${variable.value ?? ''}`;
		})
		.join('\n');
}

function supervisorLabel(replica: ProcessReplica): string {
	if (replica.supervisor === 'pm2') {
		return t('processes_supervised', 'PM2');
	}

	if (replica.supervisor === 'unavailable') {
		return t('processes_supervisor_unavailable', 'supervisor unreachable');
	}

	return t('processes_unsupervised', 'no supervisor');
}

/**
 * The supervisor's word where there is one; otherwise all a self-report can say
 * is that the process answered.
 */
function statusLabel(node: ProcessNode): string {
	if (node.supervisor !== null) {
		return node.supervisor.status;
	}

	return node.responding
		? t('processes_online', 'online')
		: t('processes_silent', 'no answer');
}

function formatUptime(uptimeMs: number | null): string {
	return uptimeMs === null
		? '—'
		: formatDuration(Math.round(uptimeMs / 1000));
}

/**
 * PM2 reports `pm_uptime` as the epoch the process last started, so the age is
 * the distance from now — not the value itself.
 */
function supervisorUptime(node: ProcessNode): string {
	const started = node.supervisor?.uptimeMs ?? null;

	return started === null
		? formatUptime(node.runtime?.uptimeMs ?? null)
		: formatUptime(Date.now() - started);
}

function formatMemory(node: ProcessNode): string {
	const used = node.supervisor?.memoryBytes ?? node.runtime?.rssBytes ?? null;
	const cap = node.supervisor?.maxMemoryRestartBytes ?? null;

	if (used === null) {
		return '—';
	}

	return cap === null
		? formatFilesize(used)
		: `${formatFilesize(used)} / ${formatFilesize(cap)}`;
}

/**
 * PM2 measures CPU as a share of one core, so a worker saturating a core reads
 * 100 however many cores the container has. Only the supervisor sees it — a
 * process cannot time its own scheduling — so it is absent wherever the daemon
 * did not answer.
 */
function formatCpu(node: ProcessNode): string {
	const cpu = cpuPercent(node);

	return cpu === null
		? '—'
		: `${Math.round(cpu)}%`;
}

function memoryPercent(node: ProcessNode): string | null {
	const ratio = memoryCapRatio(node);

	return ratio === null
		? null
		: `${Math.round(ratio * 100)}%`;
}

function copyName(variable: ResolvedEnvVariable): void {
	copyToClipboard(variable.key, {
		success: t('processes_copied_variable', 'Variable name copied'),
	});
}

function copyValue(variable: ResolvedEnvVariable): void {
	copyToClipboard(variable.value ?? '', {
		success: t('processes_copied_value', 'Value copied'),
	});
}

/** Copies exactly what the open view shows, filter, sort and redaction included. */
function copyRaw(key: string, node: ProcessNode): void {
	const raw = envView.value[0] === 'dotenv'
		? envAsDotenv(key, node)
		: envAsJson(key, node);

	copyToClipboard(raw, {
		success: t('processes_copied_env', 'Environment copied'),
	});
}

const usageChartEl = ref<HTMLElement | null>(null);
const cpuChartEl = ref<HTMLElement | null>(null);
const memoryChartEl = ref<HTMLElement | null>(null);
let usageChart: ApexCharts | null = null;
let cpuChart: ApexCharts | null = null;
let memoryChart: ApexCharts | null = null;

/** The latest totals, as the figures a percentage on its own does not carry. */
const usage = computed(() => {
	const sample = latestSample(samples.value);

	if (sample === null) {
		return null;
	}

	return {
		memory: sample.memory,
		cpu: sample.cpu,
		memoryShare: shareOfCapacity(sample.memory),
		cpuShare: shareOfCapacity(sample.cpu),
	};
});

const chartsCarryCpu = computed(() => hasMetric(samples.value, 'cpuPercent'));

function themeVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();

	return value || fallback;
}

/**
 * One line per process, over the samples taken while the page was open. The
 * series are built from every sample rather than from the latest report, so a
 * worker the autoscaler has since released keeps the history it earned instead
 * of vanishing from the chart it is the explanation for.
 */
function chartOptions(
	metric: 'cpuPercent' | 'memoryBytes',
	axis: string,
	format: (value: number) => string,
): ApexOptions {
	return {
		chart: {
			type: 'line',
			height: 220,
			animations: { enabled: false },
			toolbar: { show: false },
			fontFamily: 'var(--theme--fonts--sans--font-family)',
		},
		stroke: { width: 2, curve: 'straight' },
		markers: { size: 0 },
		dataLabels: { enabled: false },
		legend: { show: true, position: 'top', horizontalAlign: 'left' },
		grid: { borderColor: themeVar('--theme--border-color-subdued', '#e4eaf1') },
		xaxis: {
			type: 'datetime',
			categories: samples.value.map((sample) => sample.at),
			labels: { datetimeUTC: false },
		},
		yaxis: {
			title: { text: axis },
			min: 0,
			forceNiceScale: true,
			labels: { formatter: format },
		},
		tooltip: { y: { formatter: format } },
		series: chartSeries(samples.value, metric),
	};
}

/**
 * The deployment against what it is allowed to use. Both lines are percentages
 * of their own ceiling — the cgroup's memory cap and CPU quota — so the axis is
 * pinned to 100 rather than scaled to the data: a chart that rescales to the
 * peak hides how much headroom is left, which is the one thing it is for.
 */
function usageChartOptions(): ApexOptions {
	return {
		chart: {
			type: 'area',
			height: 220,
			animations: { enabled: false },
			toolbar: { show: false },
			fontFamily: 'var(--theme--fonts--sans--font-family)',
		},
		colors: [
			themeVar('--theme--primary', '#6644ff'),
			themeVar('--theme--warning', '#ffa439'),
		],
		fill: { type: 'solid', opacity: 0.12 },
		stroke: { width: 2, curve: 'straight' },
		markers: { size: 0 },
		dataLabels: { enabled: false },
		legend: { show: true, position: 'top', horizontalAlign: 'left' },
		grid: { borderColor: themeVar('--theme--border-color-subdued', '#e4eaf1') },
		xaxis: {
			type: 'datetime',
			categories: samples.value.map((sample) => sample.at),
			labels: { datetimeUTC: false },
		},
		yaxis: {
			title: { text: t('processes_of_capacity', '% of what is allowed') },
			min: 0,
			max: 100,
			tickAmount: 4,
			labels: { formatter: (value: number) => `${Math.round(value)}%` },
		},
		tooltip: { y: { formatter: (value: number) => `${value.toFixed(1)}%` } },
		series: capacitySeries(samples.value),
	};
}

function cpuChartOptions(): ApexOptions {
	return chartOptions(
		'cpuPercent',
		t('processes_cpu_axis', 'CPU (% of a core)'),
		(value) => `${Math.round(value)}%`,
	);
}

function memoryChartOptions(): ApexOptions {
	return chartOptions(
		'memoryBytes',
		t('processes_memory_axis', 'Memory'),
		(value) => formatFilesize(value),
	);
}

type ChartName = 'usage' | 'cpu' | 'memory';

/** The chart the pointer is over, whose redraw waits for the pointer to leave. */
const reading = ref<ChartName | null>(null);
const heldRedraw = ref(false);

function release(): void {
	reading.value = null;

	if (heldRedraw.value) {
		heldRedraw.value = false;
		void renderCharts();
	}
}

async function drawChart(
	name: ChartName,
	element: HTMLElement | null,
	chart: ApexCharts | null,
	options: () => ApexOptions,
): Promise<ApexCharts | null> {
	if (element === null) {
		return chart;
	}

	if (chart === null) {
		const drawn = new ApexCharts(element, options());
		await drawn.render();
		return drawn;
	}

	// An update rebuilds the tooltip, so a chart being read under the pointer
	// would lose the reading on every refresh. The samples keep arriving; what
	// they draw is what the pointer leaving asks for.
	if (reading.value === name) {
		heldRedraw.value = true;
		return chart;
	}

	await chart.updateOptions(options(), true, false);
	return chart;
}

async function renderCharts(): Promise<void> {
	usageChart = await drawChart(
		'usage',
		usageChartEl.value,
		usageChart,
		usageChartOptions,
	);

	cpuChart = await drawChart(
		'cpu',
		cpuChartEl.value,
		cpuChart,
		cpuChartOptions,
	);

	memoryChart = await drawChart(
		'memory',
		memoryChartEl.value,
		memoryChart,
		memoryChartOptions,
	);
}

// The processes that are scaling a pool, plucked from the tree the page already
// holds: the values a pool is scaled on are resolved in the process that scales
// it, so they arrive on its own report rather than from a second read.
const autoscaleRunners = computed((): AutoscaleRunner[] => {
	return (report.value?.services ?? []).flatMap((service) => {
		return service.replicas.flatMap((replica) => {
			return replica.processes.flatMap((node) => {
				// A replica that answered the bus from an older build reports no
				// autoscale state at all, and its report is carried as it came.
				const state = node.autoscale ?? null;

				if (state === null) {
					return [];
				}

				return [{
					service: service.service,
					replicaId: replica.replicaId,
					nodeId: node.nodeId,
					name: node.name,
					state,
				}];
			});
		});
	});
});

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get('/utils/processes');
		report.value = response.data.data;
		samples.value = appendProcessSample(samples.value, response.data.data);

		await renderCharts();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
		report.value = null;
	}
	finally {
		loading.value = false;
	}
}

onMounted(load);

// ApexCharts attaches to the DOM outside Vue's tree, so leaving the page without
// this leaks both charts and their resize listeners.
onUnmounted(() => {
	usageChart?.destroy();
	cpuChart?.destroy();
	memoryChart?.destroy();
});
</script>

<template>
	<private-view :title="t('processes', 'Processes')">
		<template #headline>
			<v-breadcrumb :items="[{ name: t('settings'), to: '/settings' }]" />
		</template>

		<template #title-outer:prepend>
			<v-button class="header-icon" rounded icon exact disabled>
				<v-icon name="account_tree" />
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
			<!-- The same intervals the cache page offers. The charts need a second
				 sample before they draw anything, so the short ones are what make
				 them fill while you watch: the report is a live snapshot with no
				 history behind it. -->
			<auto-refresh
				v-model="refreshInterval"
				:intervals="[null, 1, 3, 5, 10, 30, 60, 300]"
				@refresh="load"
			/>
		</template>

		<div class="processes-page">
			<v-notice v-if="error" type="danger">{{ error }}</v-notice>

			<v-notice v-if="report?.degraded.crossReplica" type="warning">
				{{ t(
					'processes_local_bus',
					'No Redis bus configured — this covers the replica serving the '
						+ 'page only, however many are running.',
				) }}
			</v-notice>

			<v-notice v-if="report && !carriesEnv" type="info">
				{{ t(
					'processes_env_disabled',
					'Resolved environment reporting is off (PROCESSES_REPORT_DETAILS).',
				) }}
			</v-notice>

			<autoscale-panel :runners="autoscaleRunners" @changed="load" />

			<div v-if="totals" class="totals">
				<span>{{ totals.processes }} processes</span>
				<span>{{ totals.responding }} responding</span>
				<span>{{ totals.replicas }} replicas</span>
			</div>

			<div v-show="samples.length > 1" class="charts">
				<div class="chart">
					<h3 class="chart-title">
						{{ t('processes_usage_chart', 'Deployment against its limits') }}
					</h3>

					<div v-if="usage" class="usage-figures">
						<span>
							{{ t('processes_usage_memory', 'Memory') }}
							{{ usage.memory.used === null
								? '—'
								: formatFilesize(usage.memory.used) }}
							<template v-if="usage.memory.capacity">
								/ {{ formatFilesize(usage.memory.capacity) }}
							</template>
							<template v-if="usage.memoryShare !== null">
								({{ usage.memoryShare.toFixed(1) }}%)
							</template>
						</span>

						<span>
							{{ t('processes_usage_cpu', 'CPU') }}
							{{ usage.cpu.used === null
								? '—'
								: usage.cpu.used.toFixed(2) }}
							<template v-if="usage.cpu.capacity">
								/ {{ usage.cpu.capacity }}
								{{ t('processes_cores', 'cores') }}
							</template>
							<template v-if="usage.cpuShare !== null">
								({{ usage.cpuShare.toFixed(1) }}%)
							</template>
						</span>
					</div>

					<v-notice
						v-if="usage && usage.memory.capacity === null"
						type="info"
					>
						{{ t(
							'processes_no_capacity',
							'No replica reported what its container may use, so usage is '
								+ 'shown without a ceiling to be a share of.',
						) }}
					</v-notice>

					<div
						ref="usageChartEl"
						class="canvas"
						@pointerenter="reading = 'usage'"
						@pointerleave="release"
					/>
				</div>

				<div class="chart">
					<h3 class="chart-title">
						{{ t('processes_cpu_chart', 'CPU per process') }}
					</h3>

					<v-notice v-if="!chartsCarryCpu" type="info">
						{{ t(
							'processes_cpu_needs_supervisor',
							'CPU is measured by the PM2 daemon; no replica reporting one has '
								+ 'answered, so only memory is plotted.',
						) }}
					</v-notice>

					<div
						v-show="chartsCarryCpu"
						ref="cpuChartEl"
						class="canvas"
						@pointerenter="reading = 'cpu'"
						@pointerleave="release"
					/>
				</div>

				<div class="chart">
					<h3 class="chart-title">
						{{ t('processes_memory_chart', 'Memory per process') }}
					</h3>
					<div
						ref="memoryChartEl"
						class="canvas"
						@pointerenter="reading = 'memory'"
						@pointerleave="release"
					/>
				</div>
			</div>

			<v-progress-linear v-if="loading && !report" indeterminate />

			<div
				v-for="service in report?.services ?? []"
				:key="service.service"
				class="service"
			>
				<h2 class="service-name">{{ service.service }}</h2>

				<div
					v-for="replica in service.replicas"
					:key="replica.replicaId"
					class="replica"
				>
					<div class="replica-head">
						<v-icon name="dns" small />
						<span class="replica-id">{{ replica.replicaId }}</span>
						<span class="hostname">{{ replica.hostname }}</span>
						<v-chip small :class="replica.supervisor">
							{{ supervisorLabel(replica) }}
						</v-chip>
					</div>

					<div
						v-for="{ key, node } in processRows(replica)"
						:key="key"
						class="process"
					>
						<button
							type="button"
							class="process-row"
							:class="{ warning: isNearMemoryCap(node), silent: !node.responding }"
							@click="toggle(key)"
						>
							<v-icon
								:name="expanded[key]
									? 'expand_more'
									: 'chevron_right'"
								small
							/>
							<span class="name">
								{{ node.name }}<template v-if="node.instance !== null">
									#{{ node.instance }}</template>
							</span>
							<span class="status">{{ statusLabel(node) }}</span>
							<span class="pid">pid {{ node.pid ?? '—' }}</span>
							<span class="cpu">
								{{ t('processes_cpu', 'cpu') }} {{ formatCpu(node) }}
							</span>
							<span class="memory">
								{{ formatMemory(node) }}
								<template v-if="memoryPercent(node)">
									({{ memoryPercent(node) }})
								</template>
							</span>
							<span class="restarts">
								{{ t('processes_restarts', 'restarts') }}
								{{ node.supervisor?.restarts ?? '—' }}
							</span>
							<span class="uptime">{{ supervisorUptime(node) }}</span>
							<span class="mode">{{ node.supervisor?.execMode ?? '—' }}</span>
						</button>

						<div v-if="expanded[key]" class="detail">
							<v-notice v-if="!node.responding" type="warning">
								{{ t(
									'processes_not_responding',
									'The supervisor lists this process, but it did not answer '
										+ 'within the collection window.',
								) }}
							</v-notice>

							<div v-if="node.runtime" class="runtime">
								<span>rss {{ formatFilesize(node.runtime.rssBytes) }}</span>
								<span>heap {{ formatFilesize(node.runtime.heapUsedBytes) }}</span>
								<span>node {{ node.runtime.nodeVersion }}</span>
								<span v-if="node.nodeId">id {{ node.nodeId }}</span>
							</div>

							<template v-if="node.env">
								<v-input
									:model-value="envSearch[key] ?? ''"
									small
									icon-left="search"
									:placeholder="t('processes_env_search', 'Search variables')"
									@update:model-value="envSearch[key] = $event ?? ''"
								/>

								<v-tabs v-model="envView" class="env-view">
									<v-tab value="table">
										{{ t('processes_env_view_table', 'Table') }}
									</v-tab>
									<v-tab value="dotenv">.env</v-tab>
									<v-tab value="json">JSON</v-tab>
								</v-tabs>

								<v-table
									v-if="envView[0] === 'table'"
									v-model:headers="envHeaders"
									v-model:sort="envSort"
									:items="envOf(key, node)"
									item-key="key"
									show-resize
								>
									<template #[`item.key`]="{ item }">
										<span class="copyable">
											<span class="value">{{ item.key }}</span>
											<v-icon
												v-tooltip="t('processes_copy_variable', 'Copy name')"
												name="content_copy"
												x-small
												clickable
												class="copy"
												@click.stop="copyName(item)"
											/>
										</span>
									</template>

									<template #[`item.value`]="{ item }">
										<v-chip v-if="item.redacted" small class="redacted">
											{{ item.isSet
												? t('processes_env_redacted', 'redacted')
												: t('processes_env_unset', 'unset') }}
										</v-chip>
										<span v-else class="copyable">
											<span class="value">{{ item.value }}</span>
											<v-icon
												v-tooltip="t('processes_copy_value', 'Copy value')"
												name="content_copy"
												x-small
												clickable
												class="copy"
												@click.stop="copyValue(item)"
											/>
										</span>
									</template>
								</v-table>

								<div v-else class="raw-view">
									<v-button
										v-tooltip.left="t('processes_copy_all', 'Copy all')"
										class="copy-all"
										secondary
										x-small
										icon
										@click="copyRaw(key, node)"
									>
										<v-icon name="content_copy" small />
									</v-button>

									<interface-input-code
										v-if="envView[0] === 'dotenv'"
										:value="envAsDotenv(key, node)"
										language="plaintext"
										disabled
										line-wrapping
									/>

									<interface-input-code
										v-else
										:value="envOf(key, node)"
										language="json"
										type="json"
										disabled
										line-wrapping
									/>
								</div>
							</template>
						</div>
					</div>
				</div>
			</div>
		</div>
	</private-view>
</template>

<style lang="scss" scoped>
.processes-page {
	padding: var(--content-padding);
	padding-block-start: 0;
}

.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.totals {
	display: flex;
	gap: 16px;
	color: var(--theme--foreground-subdued);
	margin-block-end: 12px;
}

.service-name {
	font-weight: 700;
	margin-block: 16px 8px;
}

.replica {
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	margin-block-end: 12px;
}

.replica-head {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background-color: var(--theme--background-subdued);
}

.hostname {
	color: var(--theme--foreground-subdued);
}

.process-row {
	display: flex;
	align-items: center;
	gap: 12px;
	inline-size: 100%;
	padding: 8px 12px;
	text-align: start;
	border-block-start: var(--theme--border-width) solid
		var(--theme--border-color-subdued);
	cursor: pointer;

	&.warning {
		background-color: var(--theme--warning-background);
	}

	&.silent {
		color: var(--theme--foreground-subdued);
	}
}

.process-row .name {
	font-family: var(--theme--fonts--monospace--font-family);
	flex-shrink: 0;
}

.process-row .memory,
.process-row .cpu {
	flex-shrink: 0;
}

.charts {
	margin-block-end: 24px;
}

.chart {
	margin-block-end: 20px;
}

.chart-title {
	font-weight: 600;
	margin-block-end: 8px;
}

/*
 * The dot beside a series is a text glyph drawn ten points larger than the box
 * holding it, so it rides above the label it belongs to. Drawn as a shape it
 * sits on the line instead, in the colour the series is already given.
 */
.chart :deep(.apexcharts-tooltip-marker) {
	inline-size: 10px;
	block-size: 10px;
	border-radius: 50%;
	background: currentcolor;
}

.chart :deep(.apexcharts-tooltip-marker::before) {
	content: none;
}

.usage-figures {
	display: flex;
	gap: 20px;
	color: var(--theme--foreground-subdued);
	margin-block-end: 8px;
	font-family: var(--theme--fonts--monospace--font-family);
}

.detail {
	padding: 12px;
	border-block-start: var(--theme--border-width) solid
		var(--theme--border-color-subdued);
}

.runtime {
	display: flex;
	gap: 16px;
	color: var(--theme--foreground-subdued);
	margin-block-end: 8px;
}

.env-view {
	margin-block: 12px 4px;
}

.raw-view {
	position: relative;
}

.copy-all {
	position: absolute;
	inset-block-start: 8px;
	inset-inline-end: 8px;

	// Over CodeMirror's own layers, which reach 6 and otherwise take the click
	// even though the button paints in front of them.
	z-index: 10;
}

.copyable {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-inline-size: 100%;
}

.copyable .copy {
	opacity: 0;
	flex-shrink: 0;
}

.copyable:hover .copy,
.copyable .copy:focus-visible {
	opacity: 1;
}

.value {
	font-family: var(--theme--fonts--monospace--font-family);
	word-break: break-all;
}
</style>
