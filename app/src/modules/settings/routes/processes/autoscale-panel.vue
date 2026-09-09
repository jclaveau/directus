<script setup lang="ts">
import api from '@/api';
import type { AutoscaleRunner } from '@directus/types';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	type AutoscaleRow,
	configRows,
	describeDecision,
	firstRunner,
	isPinned,
	parseFieldValue,
	pinPatch,
	secondsSince,
} from './autoscale-panel';

const props = defineProps<{ runners: AutoscaleRunner[] }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();

const override = ref<Record<string, unknown> | null>(null);
const configKey = ref<string | null>(null);
const available = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);
const drafts = ref<Record<string, string | null>>({});

const runner = computed(() => firstRunner(props.runners));

const rows = computed(() => {
	return configRows(
		runner.value?.state ?? null,
		override.value,
		drafts.value['strategy'] ?? null,
	);
});

const stamp = computed(() => {
	const setBy = override.value?.['setBy'];
	const setAt = override.value?.['setAt'];

	if (typeof setAt !== 'string') {
		return null;
	}

	return {
		setAt,
		setBy: typeof setBy === 'string'
			? setBy
			: null,
		note: typeof override.value?.['note'] === 'string'
			? override.value['note'] as string
			: null,
		days: Math.floor((Date.now() - Date.parse(setAt)) / 86_400_000),
	};
});

const decided = computed(() => {
	const state = runner.value?.state;

	if (state === undefined) {
		return null;
	}

	return {
		text: describeDecision(state),
		seconds: secondsSince(state.at, Date.now()),
	};
});

async function load(): Promise<void> {
	try {
		const response = await api.get('/utils/autoscale');
		override.value = response.data.data.override;
		configKey.value = response.data.data.key;
		available.value = true;
	}
	catch (err: any) {
		// No Redis, no override: the route is absent rather than refusing, so a
		// 404 here is a deployment that can only be tuned by redeploying.
		if (err?.response?.status === 404) {
			available.value = false;
			return;
		}

		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
}

async function write(patch: Record<string, unknown>): Promise<void> {
	saving.value = true;
	error.value = null;

	try {
		const response = await api.patch('/utils/autoscale', patch);
		override.value = response.data.data.override;

		// The values the loop runs on come back on the process report, and the
		// tick that reads this write is the one that changes them.
		emit('changed');
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		saving.value = false;
	}
}

async function clearAll(): Promise<void> {
	saving.value = true;
	error.value = null;

	try {
		await api.delete('/utils/autoscale');
		override.value = null;
		drafts.value = {};
		emit('changed');
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		saving.value = false;
	}
}

function edited(field: string): boolean {
	return field in drafts.value;
}

/**
 * What the field shows: the change being typed, else what the loop is running
 * on — the override where there is one, since that is what it runs on.
 */
function shown(row: AutoscaleRow): string | null {
	if (edited(row.field)) {
		return drafts.value[row.field] ?? null;
	}

	const value = row.override ?? row.effective;

	return value === null || value === undefined
		? null
		: String(value);
}

function applyRow(field: string, kind: string): void {
	const value = parseFieldValue(kind as never, drafts.value[field]);

	delete drafts.value[field];
	void write({ [field]: value });
}

function cancelRow(field: string): void {
	delete drafts.value[field];
}

function clearRow(field: string): void {
	delete drafts.value[field];
	void write({ [field]: null });
}

/**
 * What clearing a field would leave it on, named in the button that does it.
 *
 * The value comes from the deciding process, which is the only one that knows
 * what its own environment says once an override is hiding it.
 */
function clearedTo(row: AutoscaleRow): string {
	if (row.cleared === null) {
		return t('autoscale_clear_field', 'Clear this field');
	}

	const back = t('autoscale_clear_field_to', 'Clear, back to');

	return `${back} ${String(row.cleared)}`;
}

function describeField(row: AutoscaleRow): string {
	return row.inactive
		? `${row.description} ${t(
			'autoscale_legacy_blind',
			'The legacy rule reads this nowhere.',
		)}`
		: row.description;
}

function pause(): void {
	void write({ enabled: runner.value?.state.config.enabled === false });
}

function pin(): void {
	const state = runner.value?.state;

	if (state === undefined) {
		return;
	}

	void write(isPinned(state)
		? { minWorkers: null, maxWorkers: null }
		: pinPatch(state));
}

onMounted(load);
</script>

<template>
	<div class="autoscale">
		<h3 class="section-title">{{ t('autoscale', 'Autoscaling') }}</h3>

		<v-notice v-if="!available" type="info">
			{{ t(
				'autoscale_no_redis',
				'No Redis configured, so there is nowhere to keep a live change: '
					+ 'this deployment is tuned through its environment.',
			) }}
		</v-notice>

		<v-notice v-else-if="error" type="danger">{{ error }}</v-notice>

		<v-notice v-if="available && runners.length === 0" type="warning">
			{{ t(
				'autoscale_no_runner',
				'No process reported that it is scaling a pool. An override stored '
					+ 'here still applies to whichever one starts next.',
			) }}
		</v-notice>

		<div v-if="runner" class="summary">
			<span>{{ runner.state.config.appName }}</span>
			<span>{{ runner.state.workers }} {{ t('autoscale_workers', 'workers') }}</span>
			<span v-if="runner.state.pendingWorkers > 0">
				{{ runner.state.pendingWorkers }} {{ t('autoscale_pending', 'starting') }}
			</span>
			<span>{{ runner.state.config.strategy }}</span>
			<v-chip v-if="!runner.state.config.enabled" small>
				{{ t('autoscale_paused', 'paused') }}
			</v-chip>
			<v-chip v-if="isPinned(runner.state)" small>
				{{ t('autoscale_pinned', 'pinned') }}
			</v-chip>
		</div>

		<p v-if="decided" class="decision">
			{{ decided.text }}
			<span class="age">{{ decided.seconds }}s ago</span>
		</p>

		<div v-if="available" class="levers">
			<v-button small :disabled="!runner || saving" @click="pause">
				{{ runner?.state.config.enabled === false
					? t('autoscale_resume', 'Resume autoscaling')
					: t('autoscale_pause', 'Pause autoscaling') }}
			</v-button>

			<v-button small :disabled="!runner || saving" @click="pin">
				{{ runner && isPinned(runner.state)
					? t('autoscale_unpin', 'Unpin the pool')
					: t('autoscale_pin', 'Pin the pool where it is') }}
			</v-button>

			<v-button small secondary :disabled="!override || saving" @click="clearAll">
				{{ t('autoscale_clear', 'Clear the override') }}
			</v-button>
		</div>

		<p v-if="stamp" class="stamp">
			{{ t('autoscale_set_by', 'Overridden') }}
			<template v-if="stamp.setBy">by {{ stamp.setBy }}</template>
			{{ stamp.days }}{{ t('autoscale_days_ago', 'd ago') }}
			<template v-if="stamp.note">— {{ stamp.note }}</template>
		</p>

		<table v-if="available" class="fields">
			<thead>
				<tr>
					<th>{{ t('autoscale_field', 'Field') }}</th>
					<th>{{ t('autoscale_value', 'Value') }}</th>
					<th>{{ t('autoscale_source', 'From') }}</th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="row in rows"
					:key="row.field"
					:class="{ inactive: row.inactive }"
				>
					<td><span v-tooltip="describeField(row)">{{ row.field }}</span></td>
					<td class="edit">
						<!-- `v-select`'s own root has no layout box, so the cell's flex
						row lays this span out instead. -->
						<span v-if="row.options" class="control">
							<v-select
								:model-value="shown(row)"
								:items="row.options"
								small
								:disabled="saving || row.inactive"
								@update:model-value="drafts[row.field] = $event"
							/>
						</span>

						<span
							v-else
							class="control"
							:class="{ numeric: row.kind === 'number' }"
						>
							<v-input
								:model-value="shown(row) ?? ''"
								small
								full-width
								:type="row.kind === 'number' ? 'number' : 'text'"
								:min="row.min"
								:max="row.max"
								:step="row.step"
								:suffix="row.unit"
								:disabled="saving || row.inactive"
								@update:model-value="drafts[row.field] = $event"
								@keyup.enter="applyRow(row.field, row.kind)"
							/>
						</span>

						<v-button
							x-small
							icon
							secondary
							class="cancel"
							:tooltip="t('autoscale_cancel', 'Discard this change')"
							:disabled="saving || row.inactive || !edited(row.field)"
							@click="cancelRow(row.field)"
						>
							<v-icon name="close" x-small />
						</v-button>

						<v-button
							x-small
							icon
							class="apply"
							:tooltip="t('autoscale_apply', 'Apply this change')"
							:disabled="saving || row.inactive || !edited(row.field)"
							@click="applyRow(row.field, row.kind)"
						>
							<v-icon name="check" x-small />
						</v-button>

						<v-button
							x-small
							icon
							secondary
							class="clear"
							:tooltip="clearedTo(row)"
							:disabled="saving || row.inactive || row.override === null"
							@click="clearRow(row.field)"
						>
							<v-icon name="settings_backup_restore" x-small />
						</v-button>
					</td>
					<td>
						<span :class="['source', row.source]">
							{{ row.source === null ? '—' : row.source }}
						</span>
					</td>
				</tr>
			</tbody>
		</table>

		<p v-if="configKey" class="key">{{ configKey }}</p>
	</div>
</template>

<style scoped>
.autoscale {
	margin-block-end: 32px;
}

.section-title {
	margin-block-end: 8px;
	font-weight: 600;
}

.summary,
.levers {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	margin-block-end: 8px;
}

.decision,
.stamp,
.key {
	margin-block-end: 8px;
	color: var(--theme--foreground-subdued);
}

.age {
	margin-inline-start: 8px;
}

.fields {
	inline-size: 100%;
	border-collapse: collapse;
}

.fields th {
	text-align: start;
	color: var(--theme--foreground-subdued);
	font-weight: 600;
}

.fields td,
.fields th {
	padding: 4px 8px 4px 0;
}

.edit {
	display: flex;
	gap: 4px;
	align-items: center;
	max-inline-size: 360px;
}

.control {
	flex-grow: 1;
}

/* A number reads against the unit that names it rather than across the box. */
.control.numeric :deep(input) {
	text-align: end;
}

.fields tr.inactive td {
	opacity: 0.4;
}

.source.override {
	color: var(--theme--primary);
}

.source.default {
	color: var(--theme--foreground-subdued);
}
</style>
