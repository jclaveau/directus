<script setup lang="ts">
import api from '@/api';
import type { AutoscaleRunner } from '@directus/types';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
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
const note = ref('');
const drafts = ref<Record<string, string>>({});

const runner = computed(() => firstRunner(props.runners));
const rows = computed(() => configRows(runner.value?.state ?? null, override.value));

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
		const body = note.value === ''
			? patch
			: { ...patch, note: note.value };

		const response = await api.patch('/utils/autoscale', body);
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

function applyRow(field: string, kind: string): void {
	const value = parseFieldValue(kind as never, drafts.value[field]);

	delete drafts.value[field];
	void write({ [field]: value });
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

function switchStrategy(): void {
	void write({
		strategy: runner.value?.state.config.strategy === 'legacy'
			? 'scalabus'
			: 'legacy',
	});
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

			<v-button small :disabled="!runner || saving" @click="switchStrategy">
				{{ runner?.state.config.strategy === 'legacy'
					? t('autoscale_use_scalabus', 'Back to the scalabus rule')
					: t('autoscale_use_legacy', 'Fall back to the legacy rule') }}
			</v-button>

			<v-button small secondary :disabled="!override || saving" @click="clearAll">
				{{ t('autoscale_clear', 'Clear the override') }}
			</v-button>
		</div>

		<div v-if="available" class="note">
			<v-input
				v-model="note"
				small
				:placeholder="t('autoscale_note', 'Why (stored with the override)')"
			/>
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
					<th>{{ t('autoscale_effective', 'Running on') }}</th>
					<th>{{ t('autoscale_source', 'From') }}</th>
					<th>{{ t('autoscale_override', 'Override') }}</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.field">
					<td>{{ row.field }}</td>
					<td>{{ row.effective === null ? '—' : String(row.effective) }}</td>
					<td><span :class="['source', row.source]">{{ row.source }}</span></td>
					<td class="edit">
						<v-input
							:model-value="drafts[row.field] ?? (
								row.override === null ? '' : String(row.override)
							)"
							small
							:disabled="saving"
							@update:model-value="drafts[row.field] = $event"
							@keyup.enter="applyRow(row.field, row.kind)"
						/>

						<v-button
							x-small
							secondary
							:disabled="saving"
							@click="applyRow(row.field, row.kind)"
						>
							{{ t('autoscale_apply', 'Apply') }}
						</v-button>
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

.note {
	max-inline-size: 480px;
	margin-block-end: 12px;
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
	gap: 8px;
	align-items: center;
	max-inline-size: 320px;
}

.source.override {
	color: var(--theme--primary);
}

.source.default {
	color: var(--theme--foreground-subdued);
}
</style>
