<script setup lang="ts">
import api from '@/api';
import type {
	AutoscaleDrill,
	AutoscaleRunner,
	AutoscaleValueSource,
} from '@directus/types';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	type AutoscaleRow,
	configRows,
	describeDecision,
	describeReload,
	drillRemaining,
	firstRunner,
	isPinned,
	parseFieldValue,
	pinPatch,
	secondsSince,
	supervisorRows,
	underLoad,
} from './autoscale-panel';

const props = defineProps<{ runners: AutoscaleRunner[] }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();

const override = ref<Record<string, unknown> | null>(null);
const setByEmail = ref<string | null>(null);
const configKey = ref<string | null>(null);
const available = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);
const drafts = ref<Record<string, string | null>>({});
const drill = ref<AutoscaleDrill | null>(null);
const drillAvailable = ref(false);
const restartArmed = ref(false);
const drillSeconds = ref('60');
const drillPercent = ref('80');

/**
 * The clock the countdown is read against.
 *
 * Held as state rather than read where it is needed, because a computed over
 * `Date.now()` never recomputes: nothing it depends on ever changes.
 */
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;

function disarmClock(): void {
	if (clock !== null) {
		clearInterval(clock);
		clock = null;
	}
}

/**
 * Tick only while there is something to count down.
 *
 * A drill lasts a couple of minutes and the page outlives it by hours, so a
 * timer left running past the deadline is a render a second for nothing.
 */
function armClock(): void {
	now.value = Date.now();

	const remaining = drillRemaining(drill.value?.until ?? null, now.value);

	if (clock !== null || remaining === 0) {
		return;
	}

	clock = setInterval(() => {
		now.value = Date.now();

		if (drillRemaining(drill.value?.until ?? null, now.value) === 0) {
			disarmClock();
		}
	}, 1000);
}

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

	// The address where the api could name one, and the id it stamped where it
	// could not: a user since deleted is still worth reporting as an id.
	const writer = setByEmail.value ?? (typeof setBy === 'string'
		? setBy
		: null);

	return {
		setAt,
		setBy: writer,
		from: surfaceLabel(override.value?.['setFrom']),
		note: typeof override.value?.['note'] === 'string'
			? override.value['note'] as string
			: null,
		days: Math.floor((Date.now() - Date.parse(setAt)) / 86_400_000),
	};
});

/**
 * The stamp as one sentence.
 *
 * Assembled here rather than out of template fragments, which drop the spaces
 * between them the moment one of the fragments is conditional.
 */
const stampLine = computed(() => {
	if (stamp.value === null) {
		return null;
	}

	const parts = [t('autoscale_set_by', 'Configured')];

	if (stamp.value.setBy !== null) {
		parts.push(`by ${stamp.value.setBy}`);
	}

	if (stamp.value.from !== null) {
		parts.push(`from ${stamp.value.from}`);
	}

	parts.push(`${stamp.value.days}${t('autoscale_days_ago', 'd ago')}`);

	if (stamp.value.note !== null) {
		parts.push(`— ${stamp.value.note}`);
	}

	return parts.join(' ');
});

/**
 * The pm2 declaration the pool runs under.
 *
 * Reported beside the configuration rather than mixed into it: these are read
 * when a worker starts, so what changes one is a deploy, not this page.
 */
const supervisor = computed(() => supervisorRows(runner.value?.state ?? null));

const reloadLine = computed(() => {
	return describeReload(runner.value?.state.reload ?? null);
});

const restarting = computed(() => {
	return runner.value?.state.reload.running === true;
});

/**
 * What the pool is in for, named before it is asked for.
 *
 * The wait for each replacement is what decides whether this is seamless, and
 * the supervisor's own bound on it is the number worth reading first.
 */
const restartNote = computed(() => {
	const listen = runner.value?.state.supervisor?.listenTimeout;

	const note = t(
		'autoscale_restart_note',
		'Replaces every worker, each one only once its replacement is serving.',
	);

	return listen === undefined
		? note
		: `${note} ${t('autoscale_restart_wait', 'The supervisor waits')} ${listen}ms.`;
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
		setByEmail.value = response.data.data.setByEmail ?? null;
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
		setByEmail.value = response.data.data.setByEmail ?? null;

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

async function resetToEnv(): Promise<void> {
	saving.value = true;
	error.value = null;

	try {
		await api.delete('/utils/autoscale');
		override.value = null;
		setByEmail.value = null;
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

const dirty = computed(() => Object.keys(drafts.value).length > 0);

/** Which surface a change came in through, in the words the page uses. */
function surfaceLabel(from: unknown): string | null {
	if (from === 'admin') {
		return t('autoscale_from_admin', 'the admin');
	}

	if (from === 'mcp') {
		return t('autoscale_from_mcp', 'the system MCP');
	}

	return null;
}

/**
 * Which layer the value in the box would come from.
 *
 * A field being typed into is answered by where applying it would put the
 * value, not by where the one it is replacing came from — and a field emptied
 * back to the environment names no layer until it lands there.
 */
function sourceOf(row: AutoscaleRow): AutoscaleValueSource | null {
	if (edited(row.field) === false) {
		return row.source;
	}

	const draft = drafts.value[row.field];

	return draft === null || draft === ''
		? null
		: 'override';
}

/** What the layer a value came from is called here. */
function sourceLabel(source: AutoscaleValueSource | null): string {
	if (source === null) {
		return '—';
	}

	return source === 'override'
		? t('autoscale_source_config', 'config')
		: source;
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

function resetRow(field: string): void {
	delete drafts.value[field];
	void write({ [field]: null });
}

/**
 * Every pending change in one write, so a set of fields meant to move together
 * reaches the loop on the same tick.
 */
function applyAll(): void {
	const patch: Record<string, unknown> = {};

	for (const row of rows.value) {
		if (edited(row.field)) {
			patch[row.field] = parseFieldValue(row.kind, drafts.value[row.field]);
		}
	}

	drafts.value = {};
	void write(patch);
}

function resetAll(): void {
	drafts.value = {};
}

/**
 * What resetting a field would leave it on, named in the button that does it.
 *
 * The value comes from the deciding process, which is the only one that knows
 * what its own environment says while a stored value is hiding it.
 */
function resetsTo(row: AutoscaleRow): string {
	if (row.cleared === null) {
		return t('autoscale_reset_field', 'Reset this field to the environment');
	}

	const back = t('autoscale_reset_field_to', 'Reset to the environment:');

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

/**
 * What the drill is doing, in the words the section shows.
 *
 * `remaining` counts down off the deadline the api answered with rather than
 * off a timer of its own, so a page opened halfway through a drill another
 * admin started shows the same end.
 */
const drilling = computed(() => {
	const remaining = drillRemaining(drill.value?.until ?? null, now.value);

	return remaining === 0
		? null
		: { remaining, percent: drill.value?.percent ?? 0 };
});

/** Why the drill cannot be started, or `null` where it can. */
const drillBlocked = computed(() => {
	const state = runner.value?.state;

	if (state !== undefined && underLoad(state)) {
		return t(
			'autoscale_drill_busy',
			'The pool is already working, so a drill would measure that too.',
		);
	}

	return null;
});

async function loadDrill(): Promise<void> {
	try {
		const response = await api.get('/utils/autoscale/drill');
		drill.value = response.data.data;
		drillAvailable.value = true;
		armClock();
	}
	catch (err: any) {
		// Absent rather than refusing, exactly like the configuration route: a
		// deployment that did not ask for the drill carries no drill.
		if (err?.response?.status !== 404) {
			error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
		}
	}
}

/**
 * Ask the pool to replace its workers.
 *
 * The request goes to the process that scales the pool: this page is served by
 * a worker that the restart would retire partway through answering it.
 */
async function restart(): Promise<void> {
	restartArmed.value = false;
	saving.value = true;
	error.value = null;

	try {
		await api.post('/utils/autoscale/reload');

		// Where it got to comes back on the process report, from the process
		// actually doing it.
		emit('changed');
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		saving.value = false;
	}
}

async function startDrill(): Promise<void> {
	saving.value = true;
	error.value = null;

	try {
		const response = await api.post('/utils/autoscale/drill', {
			seconds: Number(drillSeconds.value),
			percent: Number(drillPercent.value),
		});

		drill.value = response.data.data;
		armClock();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		saving.value = false;
	}
}

async function stopDrill(): Promise<void> {
	saving.value = true;
	error.value = null;

	try {
		const response = await api.delete('/utils/autoscale/drill');
		drill.value = response.data.data;
		disarmClock();
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
	finally {
		saving.value = false;
	}
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

onMounted(() => {
	void load();
	void loadDrill();
});

onUnmounted(disarmClock);
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
				'No process reported that it is scaling a pool. A configuration '
					+ 'stored here still applies to whichever one starts next.',
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

			<v-button
				v-if="!restartArmed"
				small
				secondary
				class="restart"
				:tooltip="restartNote"
				:disabled="!runner || saving || restarting"
				@click="restartArmed = true"
			>
				{{ restarting
					? t('autoscale_restarting', 'Restarting the pool')
					: t('autoscale_restart', 'Restart the pool') }}
			</v-button>

			<template v-else>
				<v-button
					small
					kind="danger"
					class="restart-confirm"
					:tooltip="restartNote"
					:disabled="saving"
					@click="restart"
				>
					{{ t('autoscale_restart_confirm', 'Replace every worker') }}
				</v-button>

				<v-button
					small
					secondary
					class="restart-cancel"
					:disabled="saving"
					@click="restartArmed = false"
				>
					{{ t('autoscale_restart_cancel', 'Keep the pool as it is') }}
				</v-button>
			</template>
		</div>

		<p v-if="reloadLine" class="reload">{{ reloadLine }}</p>

		<p v-if="stampLine" class="stamp">{{ stampLine }}</p>

		<table v-if="available" class="fields">
			<thead>
				<tr>
					<th>{{ t('autoscale_field', 'Field') }}</th>
					<th>{{ t('autoscale_value', 'Value') }}</th>
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
						<span
							v-if="row.options"
							class="control choice"
							:class="{ pending: edited(row.field) }"
						>
							<v-select
								:model-value="shown(row)"
								:items="row.options"
								small
								:disabled="saving || row.inactive"
								@update:model-value="drafts[row.field] = $event"
							>
								<template #append>
									<span
										class="source"
										:class="{ pending: edited(row.field) }"
									>
										{{ sourceLabel(sourceOf(row)) }}
									</span>
								</template>
							</v-select>
						</span>

						<span
							v-else
							class="control"
							:class="{
								numeric: row.kind === 'number',
								pending: edited(row.field),
							}"
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
							>
								<template #append>
									<span
										class="source"
										:class="{ pending: edited(row.field) }"
									>
										{{ sourceLabel(sourceOf(row)) }}
									</span>
								</template>
							</v-input>
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
							class="reset"
							:tooltip="resetsTo(row)"
							:disabled="saving || row.inactive || row.override === null"
							@click="resetRow(row.field)"
						>
							<v-icon name="settings_backup_restore" x-small />
						</v-button>
					</td>
				</tr>
			</tbody>
		</table>

		<div v-if="available" class="bulk">
			<v-button small :disabled="!dirty || saving" @click="applyAll">
				{{ t('autoscale_apply_all', 'Apply all changes') }}
			</v-button>

			<v-button small secondary :disabled="!dirty || saving" @click="resetAll">
				{{ t('autoscale_reset_all', 'Reset all changes') }}
			</v-button>

			<v-button small secondary :disabled="!override || saving" @click="resetToEnv">
				{{ t('autoscale_reset_env', 'Reset to env') }}
			</v-button>
		</div>

		<div v-if="drillAvailable" class="drill">
			<span class="knob">
				<v-input
					v-model="drillSeconds"
					small
					type="number"
					:full-width="false"
					:min="1"
					:max="120"
					:step="5"
					suffix="s"
					:disabled="saving || drilling !== null"
				/>
			</span>

			<span class="knob">
				<v-input
					v-model="drillPercent"
					small
					type="number"
					:full-width="false"
					:min="10"
					:max="95"
					:step="5"
					suffix="%"
					:disabled="saving || drilling !== null"
				/>
			</span>

			<v-button
				v-if="drilling"
				small
				secondary
				:disabled="saving"
				@click="stopDrill"
			>
				{{ t('autoscale_drill_stop', 'Stop the drill') }}
			</v-button>

			<v-button
				v-else
				small
				:disabled="saving || drillBlocked !== null"
				@click="startDrill"
			>
				{{ t('autoscale_drill_start', 'Run a load drill') }}
			</v-button>

			<span v-if="drilling" class="drilling">
				{{ t('autoscale_drilling', 'every worker busy,') }}
				{{ drilling.remaining }}s {{ t('autoscale_drill_left', 'left') }}
			</span>

			<span v-else class="drill-note">
				{{ drillBlocked ?? t(
					'autoscale_drill_note',
					'Loads every worker so the pool has to decide, without touching '
						+ 'anything it decides on.',
				) }}
			</span>
		</div>

		<template v-if="supervisor.length > 0">
			<h4 class="section-title supervisor-title">
				{{ t('autoscale_supervisor', 'Supervisor') }}
			</h4>

			<p class="supervisor-note">
				{{ t(
					'autoscale_supervisor_note',
					'What PM2 was started with. Read when a worker starts, so a '
						+ 'change to one of these reaches the pool through a deploy '
						+ 'rather than through this page.',
				) }}
			</p>

			<table class="fields supervisor">
				<tbody>
					<tr v-for="row in supervisor" :key="row.field">
						<td><span v-tooltip="row.description">{{ row.field }}</span></td>
						<td class="declared">{{ row.value }}</td>
					</tr>
				</tbody>
			</table>
		</template>

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
.reload,
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
	max-inline-size: 440px;
}

.control {
	flex-grow: 1;
}

/* A number and the unit that names it read as one phrase at the start of the
   box, so the box grows with what is typed rather than stretching to the end. */
.control.numeric :deep(input) {
	flex-grow: 0;
	field-sizing: content;
	min-inline-size: 4ch;
	max-inline-size: 10ch;
}

.control :deep(.suffix) {
	margin-inline-start: 4px;
}

/*
 * Every row ends the same way: the layer that supplied the value, then the
 * control that changes it — a number's steppers where a select's chevron is.
 * The pair is pushed to the end of the box, so the two read at the same two
 * points rather than each at its own.
 *
 * `.edit` earns the rule its specificity: `v-input` sets the margin on
 * `.append` from three classes deep inside its own scope.
 */
.edit .control.numeric :deep(.append) {
	order: 1;
	margin-inline-start: auto;
}

.control.numeric :deep(.arrows) {
	order: 2;
}

/* A select puts its chevron in the same box as this slot, and first. */
.control.choice :deep(.append) {
	display: flex;
	gap: 4px;
	align-items: center;
}

.control.choice :deep(.append > .v-icon) {
	order: 1;
}

.fields tr.inactive td {
	opacity: 0.4;
}

.bulk {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	margin-block: 12px 8px;
}

.source {
	flex-shrink: 0;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

/*
 * A change that has not been written yet is the one thing on a row worth a
 * colour: which layer holds a value is not in question, whether the box still
 * agrees with it is.
 */
.control.pending :deep(input),
.source.pending {
	color: var(--theme--primary);
}

.drill {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	margin-block-end: 8px;
}

/* The two knobs hug their numbers, so the row reads as a sentence rather than
   as two boxes with a button after them. */
.knob :deep(input) {
	flex-grow: 0;
	field-sizing: content;
	min-inline-size: 3ch;
	max-inline-size: 6ch;
}

.knob :deep(.suffix) {
	margin-inline-start: 4px;
}

.drilling {
	color: var(--theme--primary);
}

.drill-note {
	color: var(--theme--foreground-subdued);
}

.supervisor-title {
	margin-block-start: 24px;
}

.supervisor-note {
	margin-block-end: 8px;
	color: var(--theme--foreground-subdued);
}

.fields.supervisor .declared {
	color: var(--theme--foreground-subdued);
}
</style>
