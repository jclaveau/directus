<script setup lang="ts">
import api from '@/api';
import type { HeaderRaw } from '@/components/v-table/types';
import { formatDuration } from '@/utils/format-duration';
import { localizedFormat } from '@/utils/localized-format';
import { notify } from '@/utils/notify';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	type CacheAuditFinding,
	type CacheAuditRun,
	type CacheAuditRunWithFindings,
	type CacheAuditSchedule,
	describeOptions,
	findingRequest,
	findingVerdict,
	REPORTED_VERDICTS,
	runStatus,
	scheduleDraft,
	scheduleRule,
	tagDrift,
} from './cache-audit-panel';

const emit = defineEmits<{ audited: [] }>();

const { t } = useI18n();

const schedule = ref<CacheAuditSchedule | null>(null);
const runs = ref<CacheAuditRun[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);

// The schedule input. Saving stores the cron in directus_settings, which the
// API announces so every node reschedules at once; empty hands it back to env.
const draft = ref('');
const savingSchedule = ref(false);

const dirty = computed(() => draft.value !== scheduleDraft(schedule.value));

const running = ref(false);
const purge = ref(false);

const selected = ref<CacheAuditRunWithFindings | null>(null);
const selectedLoading = ref(false);

// A run in flight has no end to read yet; poll while one is, so its row
// completes without a reload.
let poll: ReturnType<typeof setInterval> | null = null;

const inFlight = computed(() => runs.value.some((run) => run.finishedAt === null));

function stopPolling(): void {
	if (poll !== null) {
		clearInterval(poll);
		poll = null;
	}
}

function pollWhileInFlight(): void {
	if (poll !== null || !inFlight.value) {
		return;
	}

	poll = setInterval(async () => {
		await loadRuns();

		if (!inFlight.value) {
			stopPolling();
		}
	}, 5000);
}

function failed(err: any): string {
	return err?.response?.data?.errors?.[0]?.message ?? String(err);
}

async function loadSchedule(): Promise<void> {
	const response = await api.get('/utils/cache/audit/schedule');
	schedule.value = response.data.data;
	draft.value = scheduleDraft(schedule.value);
}

async function loadRuns(): Promise<void> {
	const response = await api.get('/utils/cache/audits');
	runs.value = response.data.data;
}

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;

	try {
		await Promise.all([loadSchedule(), loadRuns()]);
		pollWhileInFlight();
	}
	catch (err: any) {
		error.value = failed(err);
	}
	finally {
		loading.value = false;
	}
}

async function saveSchedule(): Promise<void> {
	if (!dirty.value || savingSchedule.value) {
		return;
	}

	savingSchedule.value = true;

	try {
		const response = await api.patch('/utils/cache/audit/schedule', {
			rule: scheduleRule(draft.value),
		});

		schedule.value = response.data.data;
		draft.value = scheduleDraft(schedule.value);
	}
	catch (err: any) {
		notify({ type: 'error', title: failed(err) });
	}
	finally {
		savingSchedule.value = false;
	}
}

async function runNow(): Promise<void> {
	if (running.value) {
		return;
	}

	running.value = true;
	error.value = null;

	try {
		await api.post('/utils/cache/audit', { purge: purge.value });
		await loadRuns();
		emit('audited');
	}
	catch (err: any) {
		error.value = failed(err);
	}
	finally {
		running.value = false;
	}
}

async function openRun(run: CacheAuditRun): Promise<void> {
	selected.value = { ...run, findings: [] };
	selectedLoading.value = true;

	try {
		const response = await api.get(`/utils/cache/audits/${run.id}`);
		selected.value = response.data.data;
	}
	catch (err: any) {
		notify({ type: 'error', title: failed(err) });
		selected.value = null;
	}
	finally {
		selectedLoading.value = false;
	}
}

function closeRun(): void {
	selected.value = null;
}

type HeaderSpec = [key: string, fallback: string, value: string, width: number];

const headerSpecs: HeaderSpec[] = [
	['cache_audit_started', 'Started', 'startedAt', 170],
	['cache_audit_status', 'Status', 'status', 110],
	['cache_audit_trigger', 'Trigger', 'trigger', 80],
	['cache_audit_scanned', 'Scanned', 'scanned', 90],
	['cache_audit_stale', 'Stale', 'stale', 80],
	['cache_audit_drifted', 'Drifted', 'tag_drift', 80],
	['cache_audit_unreplayable', 'Unreplayable', 'unreplayable', 120],
	['cache_audit_duration', 'Duration', 'durationMs', 90],
	['cache_audit_options', 'Narrowed to', 'options', 200],
];

const headers: HeaderRaw[] = headerSpecs.map(([key, fallback, value, width]) => {
	return { text: t(key, fallback), value, width, sortable: false };
});

const rows = computed(() => {
	return runs.value.map((run) => {
		return {
			...run,
			status: runStatus(run),
			stale: run.counts.stale,
			tag_drift: run.counts.tag_drift,
			unreplayable: run.counts.unreplayable,
		};
	});
});

function statusLabel(status: ReturnType<typeof runStatus>): string {
	switch (status) {
		case 'running':
			return t('cache_audit_running', 'Running');
		case 'failed':
			return t('cache_audit_failed', 'Failed');
		case 'stale':
			return t('cache_audit_found_stale', 'Stale');
		default:
			return t('cache_audit_clean', 'Clean');
	}
}

function formatStamp(ms: number): string {
	return localizedFormat(
		ms,
		`${t('date-fns_date_short')} ${t('date-fns_time_24hour')}`,
	);
}

const nextRun = computed(() => {
	if (schedule.value === null || schedule.value.rule === null) {
		return t('cache_audit_unscheduled', 'No audit scheduled');
	}

	if (schedule.value.nextRunAt === null) {
		return t('cache_audit_rule_invalid', 'The rule in force is not a cron');
	}

	const stamp = formatStamp(schedule.value.nextRunAt);

	return `${t('cache_audit_next_run', 'Next run')}: ${stamp}`;
});

const schedulePlaceholder = computed(() => {
	return schedule.value?.envRule
		? `${t('cache_audit_env_rule', 'Env')}: ${schedule.value.envRule}`
		: t('cache_audit_schedule_placeholder', 'Cron e.g. 0 3 * * *');
});

const selectedFields = computed(() => {
	if (selected.value === null) {
		return [];
	}

	const run = selected.value;

	const fields = [
		{
			label: t('cache_audit_started', 'Started'),
			value: formatStamp(run.startedAt),
		},
		{
			label: t('cache_audit_finished', 'Finished'),
			value: run.finishedAt === null
				? '—'
				: formatStamp(run.finishedAt),
		},
		{ label: t('cache_audit_trigger', 'Trigger'), value: run.trigger },
		{ label: t('cache_audit_scanned', 'Scanned'), value: String(run.scanned) },
		...REPORTED_VERDICTS.map((verdict) => {
			return { label: verdict, value: String(run.counts[verdict]) };
		}),
		{ label: t('cache_audit_evicted', 'Evicted'), value: String(run.evicted) },
		{
			label: t('cache_audit_duration', 'Duration'),
			value: run.durationMs === null
				? '—'
				: formatDuration(run.durationMs / 1000),
		},
	];

	const narrowing = describeOptions(run.options);

	if (narrowing !== '') {
		fields.push({
			label: t('cache_audit_options', 'Narrowed to'),
			value: narrowing,
		});
	}

	if (run.error !== null) {
		fields.push({ label: t('cache_audit_error', 'Error'), value: run.error });
	}

	return fields;
});

function driftOf(finding: CacheAuditFinding): string | null {
	const drift = tagDrift(finding);

	if (drift === null || (drift.added.length === 0 && drift.dropped.length === 0)) {
		return null;
	}

	return [
		...drift.added.map((tag) => `+${tag}`),
		...drift.dropped.map((tag) => `-${tag}`),
	].join(' ');
}

onMounted(load);
onUnmounted(stopPolling);

defineExpose({ load });
</script>

<template>
  <div class="cache-audit">
    <div class="audit-head">
      <h3 class="section-title">
        {{ t('cache_audit', 'Cache audit') }}
      </h3>

      <div class="audit-controls">
        <v-input
          v-model="draft"
          class="schedule-input"
          small
          inline
          :placeholder="schedulePlaceholder"
          @keydown.enter="saveSchedule"
        >
          <template #prepend>
            <v-icon
              name="schedule"
              small
            />
          </template>
          <template #append>
            <v-icon
              v-tooltip.bottom="t('cache_audit_schedule_save', 'Save the schedule')"
              name="check"
              :disabled="!dirty || savingSchedule"
              clickable
              @click="saveSchedule"
            />
          </template>
        </v-input>

        <span class="next-run">{{ nextRun }}</span>

        <v-checkbox
          v-model="purge"
          class="purge-toggle"
          :label="t('cache_audit_purge', 'Evict stale')"
        />

        <v-button
          v-tooltip.bottom="t('cache_audit_run_now', 'Replay every live entry now')"
          small
          :loading="running"
          @click="runNow"
        >
          {{ t('cache_audit_run', 'Audit now') }}
        </v-button>
      </div>
    </div>

    <v-notice
      v-if="error"
      type="danger"
    >
      {{ error }}
    </v-notice>

    <v-notice
      v-else-if="!loading && runs.length === 0"
      type="info"
    >
      {{ t(
        'cache_audit_no_runs',
        'No audit ran in the last 7 days. Schedule one, or run one now.',
      ) }}
    </v-notice>

    <v-table
      v-else-if="runs.length > 0"
      class="audit-table"
      :headers="headers"
      :items="rows"
      item-key="id"
      fixed-header
      @click:row="({ item }) => openRun(item)"
    >
      <template #[`item.startedAt`]="{ item }">
        {{ formatStamp(item.startedAt) }}
      </template>

      <template #[`item.status`]="{ item }">
        <span
          class="status"
          :class="item.status"
        >{{ statusLabel(item.status) }}</span>
      </template>

      <template #[`item.trigger`]="{ item }">
        {{ item.trigger }}
      </template>

      <!-- Explicit, so a count of zero reads as 0 rather than as a null. -->
      <template
        v-for="column in ['scanned', 'stale', 'tag_drift', 'unreplayable']"
        #[`item.${column}`]="{ item }"
        :key="column"
      >
        {{ item[column] }}
      </template>

      <template #[`item.durationMs`]="{ item }">
        {{ item.durationMs === null ? '—' : formatDuration(item.durationMs / 1000) }}
      </template>

      <template #[`item.options`]="{ item }">
        {{ describeOptions(item.options) || '—' }}
      </template>
    </v-table>

    <v-drawer
      :model-value="selected !== null"
      :title="selected ? `${t('cache_audit', 'Cache audit')} #${selected.id}` : ''"
      :subtitle="selected ? statusLabel(runStatus(selected)) : ''"
      icon="fact_check"
      @cancel="closeRun"
      @update:model-value="closeRun"
    >
      <div
        v-if="selected"
        class="run-detail"
      >
        <div class="fields">
          <div
            v-for="field in selectedFields"
            :key="field.label"
            class="field"
          >
            <span class="field-label">{{ field.label }}</span>
            <span class="field-value">{{ field.value }}</span>
          </div>
        </div>

        <div class="findings-head">
          {{ t('cache_audit_findings', 'Findings') }}
        </div>

        <div
          v-if="selectedLoading"
          class="findings-note"
        >
          {{ t('loading', 'Loading…') }}
        </div>

        <div
          v-else-if="selected.findings.length === 0"
          class="findings-note"
        >
          {{ t('cache_audit_no_findings', 'Every entry was fresh.') }}
        </div>

        <div
          v-for="finding in selected.findings"
          v-else
          :key="finding.redisKey"
          class="finding"
          :class="finding.verdict"
        >
          <div class="finding-head">
            <span class="finding-verdict">{{ findingVerdict(finding) }}</span>
            <span class="finding-request">{{ findingRequest(finding) }}</span>
          </div>

          <div class="finding-meta">
            <span>
              {{ t('user', 'User') }}:
              {{ finding.user ?? t('public_label', 'public') }}
            </span>
            <span v-if="finding.collection">
              {{ t('collection', 'Collection') }}: {{ finding.collection }}
            </span>
            <span v-if="finding.ageMs !== null">
              {{ t('age', 'Age') }}: {{ formatDuration(finding.ageMs / 1000) }}
            </span>
          </div>

          <div
            v-if="finding.diff && finding.diff.length"
            class="finding-line"
          >
            {{ t('cache_audit_diff', 'Differs at') }}: {{ finding.diff.join(' ') }}
          </div>

          <div
            v-if="driftOf(finding)"
            class="finding-line"
          >
            {{ t('cache_audit_tag_drift', 'Tags') }}: {{ driftOf(finding) }}
          </div>

          <div
            v-if="finding.purgesSinceFilled !== null"
            class="finding-line"
          >
            {{ finding.purgesSinceFilled.length === 0
              ? t(
                'cache_audit_never_purged',
                'No purge covered it since the fill: its tags never named the write',
              )
              : t('cache_audit_purged_held', 'Purged since the fill, still held') }}
          </div>
        </div>
      </div>
    </v-drawer>
  </div>
</template>

<style scoped>
.cache-audit {
	margin-block: 24px;
}

.audit-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 8px 24px;
	margin-block-end: 8px;
}

.section-title {
	font-weight: 600;
}

.audit-controls {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px 16px;
}

.schedule-input {
	inline-size: 200px;
}

.schedule-input :deep(input) {
	font-family: var(--theme--fonts--monospace--font-family);
}

.next-run {
	color: var(--theme--foreground-subdued);
	white-space: nowrap;
}

.audit-table {
	max-block-size: 320px;
}

.audit-table :deep(tr) {
	cursor: pointer;
}

.status {
	font-weight: 600;
}

.status.clean {
	color: var(--theme--success);
}

.status.stale {
	color: var(--theme--warning);
}

.status.failed {
	color: var(--theme--danger);
}

.status.running {
	color: var(--theme--foreground-subdued);
}

.run-detail {
	padding: var(--content-padding);
	padding-block-start: 0;
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 12px 24px;
	margin-block-end: 24px;
}

.field {
	display: flex;
	flex-direction: column;
}

.field-label {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	text-transform: uppercase;
}

.field-value {
	font-family: var(--theme--fonts--monospace--font-family);
	overflow-wrap: anywhere;
}

.findings-head {
	font-weight: 600;
	margin-block-end: 8px;
}

.findings-note {
	color: var(--theme--foreground-subdued);
}

.finding {
	border-inline-start: 3px solid var(--theme--foreground-subdued);
	padding-inline-start: 12px;
	margin-block-end: 16px;
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 13px;
}

.finding.stale {
	border-color: var(--theme--danger);
}

.finding.tag_drift {
	border-color: var(--theme--warning);
}

.finding-head {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
}

.finding-verdict {
	font-weight: 700;
}

.finding-request,
.finding-line {
	overflow-wrap: anywhere;
}

.finding-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	color: var(--theme--foreground-subdued);
}
</style>
