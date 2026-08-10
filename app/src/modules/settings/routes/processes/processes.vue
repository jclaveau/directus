<script setup lang="ts">
import api from '@/api';
import { useClipboard } from '@/composables/use-clipboard';
import { formatDuration } from '@/utils/format-duration';
import { formatFilesize } from '@/utils/format-filesize';
import { getStringifiedValue } from '@/utils/get-stringified-value';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import type { HeaderRaw, Sort } from '@/components/v-table/types';
import type { ProcessNode, ProcessReplica, ProcessesReport, ResolvedEnvVariable }
	from '@directus/types';
import { useLocalStorage } from '@vueuse/core';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SettingsNavigation from '../../components/navigation.vue';
import {
	filterEnvVariables,
	isNearMemoryCap,
	memoryCapRatio,
	processTotals,
} from './processes-view';

defineOptions({ name: 'SettingsProcesses' });

const { t } = useI18n();
const { copyToClipboard } = useClipboard();

const loading = ref(false);
const error = ref<string | null>(null);
const report = ref<ProcessesReport | null>(null);
const refreshInterval = ref<number | null>(null);
const expanded = ref<Record<string, boolean>>({});
const envSearch = ref<Record<string, string>>({});

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

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get('/utils/processes');
		report.value = response.data.data;
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
			<auto-refresh
				v-model="refreshInterval"
				:intervals="[null, 5, 10, 30, 60, 300]"
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
					'Resolved environment reporting is off (PROCESSES_DETAILS).',
				) }}
			</v-notice>

			<div v-if="totals" class="totals">
				<span>{{ totals.processes }} processes</span>
				<span>{{ totals.responding }} responding</span>
				<span>{{ totals.replicas }} replicas</span>
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

.process-row .memory {
	flex-shrink: 0;
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
	z-index: 2;
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
