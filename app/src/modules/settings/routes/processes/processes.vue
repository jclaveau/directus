<script setup lang="ts">
import api from '@/api';
import { formatDuration } from '@/utils/format-duration';
import { formatFilesize } from '@/utils/format-filesize';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import type { ProcessNode, ProcessReplica, ProcessesReport } from '@directus/types';
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

const loading = ref(false);
const error = ref<string | null>(null);
const report = ref<ProcessesReport | null>(null);
const refreshInterval = ref<number | null>(null);
const expanded = ref<Record<string, boolean>>({});
const envSearch = ref<Record<string, string>>({});

const totals = computed(() =>
	report.value === null
		? null
		: processTotals(report.value));

const carriesEnv = computed(() =>
	report.value?.details.includes('env') === true);

function nodeKey(replicaId: string, node: ProcessNode): string {
	return `${replicaId}::${node.pmId ?? node.pid ?? node.nodeId}`;
}

function toggle(key: string): void {
	expanded.value[key] = !expanded.value[key];
}

function envOf(key: string, node: ProcessNode) {
	return filterEnvVariables(node.env ?? [], envSearch.value[key] ?? '');
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
						v-for="node in replica.processes"
						:key="nodeKey(replica.replicaId, node)"
						class="process"
					>
						<button
							type="button"
							class="process-row"
							:class="{ warning: isNearMemoryCap(node), silent: !node.responding }"
							@click="toggle(nodeKey(replica.replicaId, node))"
						>
							<v-icon
								:name="expanded[nodeKey(replica.replicaId, node)]
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

						<div v-if="expanded[nodeKey(replica.replicaId, node)]" class="detail">
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
									:model-value="envSearch[nodeKey(replica.replicaId, node)] ?? ''"
									small
									icon-left="search"
									:placeholder="t('processes_env_search', 'Search variables')"
									@update:model-value="
										envSearch[nodeKey(replica.replicaId, node)] = $event ?? ''"
								/>

								<table class="env">
									<thead>
										<tr>
											<th>{{ t('processes_env_key', 'Variable') }}</th>
											<th>{{ t('processes_env_value', 'Value') }}</th>
											<th>{{ t('processes_env_source', 'From') }}</th>
										</tr>
									</thead>
									<tbody>
										<tr
											v-for="variable in envOf(nodeKey(replica.replicaId, node), node)"
											:key="variable.key"
										>
											<td class="key">{{ variable.key }}</td>
											<td class="value">
												<template v-if="variable.redacted">
													<v-chip small class="redacted">
														{{ variable.isSet
															? t('processes_env_redacted', 'redacted')
															: t('processes_env_unset', 'unset') }}
													</v-chip>
												</template>
												<template v-else>{{ variable.value }}</template>
											</td>
											<td class="source">{{ variable.source }}</td>
										</tr>
									</tbody>
								</table>
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

table.env {
	inline-size: 100%;
	margin-block-start: 8px;
	border-collapse: collapse;

	th {
		text-align: start;
		color: var(--theme--foreground-subdued);
	}

	td,
	th {
		padding: 4px 8px;
		border-block-end: var(--theme--border-width) solid
			var(--theme--border-color-subdued);
	}

	td.key,
	td.value {
		font-family: var(--theme--fonts--monospace--font-family);
		word-break: break-all;
	}
}
</style>
