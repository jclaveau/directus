<script setup lang="ts">
import api from '@/api';
import type {
	AutoscaleDrill,
	AutoscaleRunner,
	AutoscaleValueSource,
} from '@directus/types';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { notify } from '@/utils/notify';
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
	type SupervisorRow,
	supervisorRows,
	underLoad,
} from './autoscale-panel';

const props = withDefaults(defineProps<{
	runners: AutoscaleRunner[];
	/**
	 * Where the levers are rendered, for a page that wants them somewhere its
	 * own layout decides — a header the panel's own drawer does not cover.
	 * Left out, they are rendered where the panel is.
	 */
	actionsTarget?: HTMLElement | null;
	/**
	 * Where the pool and its last decision are reported, for a page that reads
	 * them beside its own totals. Left out, they are reported where the panel
	 * is.
	 */
	summaryTarget?: HTMLElement | null;
}>(), { actionsTarget: null, summaryTarget: null });

const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();

const sharedSettings = ref<Record<string, unknown> | null>(null);
const setByEmail = ref<string | null>(null);
const configKey = ref<string | null>(null);
const supervisorSharedSettings = ref<Record<string, unknown> | null>(null);
const supervisorSetByEmail = ref<string | null>(null);
const available = ref(true);
const error = ref<string | null>(null);
const saving = ref(false);
const drafts = ref<Record<string, string | null>>({});

// Its own map rather than a shared one: the two tables are written to separate
// keys through separate routes, and a field named in both would otherwise be
// one draft answering for two changes.
const supervisorDrafts = ref<Record<string, string | null>>({});

const note = ref('');
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
		sharedSettings.value,
		drafts.value['strategy'] ?? null,
	);
});

const stamp = computed(() => {
	const setBy = sharedSettings.value?.['setBy'];
	const setAt = sharedSettings.value?.['setAt'];

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
		from: surfaceLabel(sharedSettings.value?.['setFrom']),
		note: typeof sharedSettings.value?.['note'] === 'string'
			? sharedSettings.value['note'] as string
			: null,
		days: Math.floor((now.value - Date.parse(setAt)) / 86_400_000),
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
const supervisor = computed(() => {
	return supervisorRows(runner.value?.state ?? null, supervisorSharedSettings.value);
});

const reloadLine = computed(() => {
	return describeReload(runner.value?.state.reload ?? null);
});

const restarting = computed(() => {
	return runner.value?.state.reload.running === true;
});

/*
 * A restart that ended is news once, not a line the panel goes on showing. The
 * page re-reads the report on its own interval, so the end arrives whether or
 * not the drawer holding this panel is open.
 */
watch(
	() => runner.value?.state.reload ?? null,
	(reload, before) => {
		// Nothing before it means the first report to reach the panel, which
		// arrives after it mounts: a restart that ended before the page was
		// opened is the pool's last news rather than this page's.
		const ended = before !== null
			&& before !== undefined
			&& reload !== null
			&& reload.error === null
			&& reload.finishedAt !== null
			&& reload.finishedAt !== before.finishedAt;

		if (ended) {
			notify({
				title: t('autoscale_reload_done', 'The pool finished restarting'),
			});
		}
	},
);

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
		sharedSettings.value = response.data.data.sharedSettings;
		setByEmail.value = response.data.data.setByEmail ?? null;
		configKey.value = response.data.data.key;

		supervisorSharedSettings.value
			= response.data.data.supervisor?.sharedSettings ?? null;

		supervisorSetByEmail.value = response.data.data.supervisor?.setByEmail ?? null;
		available.value = true;
	}
	catch (err: any) {
		// No Redis, no bus to carry a change to the scaling process, so the route is
		// absent rather than refusing: a 404 here is a deployment that can only be
		// tuned by redeploying.
		if (err?.response?.status === 404) {
			available.value = false;
			return;
		}

		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
}

/**
 * The patch with the reason typed for it.
 *
 * Null where nothing is typed rather than left out: the note belongs to the
 * change that carried it, and one left behind would attribute the next change
 * to the reason for the last.
 */
function withNote(patch: Record<string, unknown>): Record<string, unknown> {
	const typed = note.value.trim();

	return {
		...patch,
		note: typed === ''
			? null
			: typed,
	};
}

/** Whether the write landed, so a refused one leaves the typing to fix. */
async function write(patch: Record<string, unknown>): Promise<boolean> {
	saving.value = true;
	error.value = null;

	try {
		const response = await api.patch('/utils/autoscale', withNote(patch));
		sharedSettings.value = response.data.data.sharedSettings;
		setByEmail.value = response.data.data.setByEmail ?? null;
		note.value = '';

		// The values the loop runs on come back on the process report, and the
		// tick that reads this write is the one that changes them.
		emit('changed');
		return true;
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
		return false;
	}
	finally {
		saving.value = false;
	}
}

/**
 * Store an option the next rolling restart will carry.
 *
 * Its own write because it lands somewhere else: pm2 reads these when it starts
 * a worker, so nothing about the pool changes until the restart below pushes
 * them.
 */
async function writeSupervisor(
	patch: Record<string, unknown>,
): Promise<boolean> {
	saving.value = true;
	error.value = null;

	try {
		const response = await api.patch(
			'/utils/autoscale/supervisor',
			withNote(patch),
		);

		supervisorSharedSettings.value = response.data.data.sharedSettings;
		supervisorSetByEmail.value = response.data.data.setByEmail ?? null;
		note.value = '';
		return true;
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
		return false;
	}
	finally {
		saving.value = false;
	}
}

function supervisorEdited(row: SupervisorRow): boolean {
	return row.option !== null && row.option.field in supervisorDrafts.value;
}

function supervisorTyped(row: SupervisorRow, typed: string): void {
	if (row.option !== null) {
		supervisorDrafts.value[row.option.field] = typed;
	}
}

async function applySupervisorRow(row: SupervisorRow): Promise<void> {
	if (row.option === null) {
		return;
	}

	const field = row.option.field;

	// A box emptied hands the option back to the environment, which is what a
	// deployment that never overrode it runs on.
	const value = parseFieldValue('number', supervisorDrafts.value[field]);

	// Dropped once it has landed: a refused value is the one worth correcting,
	// and a box emptied under the operator leaves them retyping it from the
	// message alone.
	if (await writeSupervisor({ [field]: value })) {
		delete supervisorDrafts.value[field];
	}
}

function cancelSupervisorRow(row: SupervisorRow): void {
	if (row.option !== null) {
		delete supervisorDrafts.value[row.option.field];
	}
}

async function resetSupervisorRow(row: SupervisorRow): Promise<void> {
	if (row.option === null) {
		return;
	}

	const field = row.option.field;

	if (await writeSupervisor({ [field]: null })) {
		delete supervisorDrafts.value[field];
	}
}

/**
 * What an empty box stands for, which is what the pool runs on now.
 *
 * A memory ceiling nothing declares reads as off rather than as a zero, which
 * is a number the option would refuse anyway.
 */
function supervisorPlaceholder(row: SupervisorRow): string {
	if (row.option === null || row.option.declared === null) {
		return t('autoscale_supervisor_unset', 'off');
	}

	return String(row.option.declared);
}

/**
 * What the row shows: the change being typed, else what the shared settings hold —
 * and for an option no restart can carry, the value pm2 is running it on.
 */
function supervisorShown(row: SupervisorRow): string {
	if (row.option === null) {
		return row.value;
	}

	if (supervisorEdited(row)) {
		return supervisorDrafts.value[row.option.field] ?? '';
	}

	return row.sharedSettings === null
		? ''
		: String(row.sharedSettings);
}

/**
 * Which layer the value in the box would come from.
 *
 * `pm2` rather than a layer of its own: whether the supervisor took a value
 * from a variable or from its own default is not in what it reports.
 */
function supervisorSource(row: SupervisorRow): string {
	if (supervisorEdited(row)) {
		const draft = supervisorDrafts.value[row.option!.field];

		return draft === null || draft === ''
			? t('autoscale_supervisor_source', 'pm2')
			: sourceLabel('sharedSettings');
	}

	return row.source === 'sharedSettings'
		? sourceLabel('sharedSettings')
		: t('autoscale_supervisor_source', 'pm2');
}

async function resetToEnv(): Promise<void> {
	saving.value = true;
	error.value = null;

	try {
		await api.delete('/utils/autoscale');
		sharedSettings.value = null;
		setByEmail.value = null;
		drafts.value = {};
		note.value = '';
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
		: 'sharedSettings';
}

/** What the layer a value came from is called here. */
function sourceLabel(source: AutoscaleValueSource | null): string {
	if (source === null) {
		return '—';
	}

	return source === 'sharedSettings'
		? t('autoscale_source_shared_settings', 'shared settings')
		: source;
}

/**
 * What the field shows: the change being typed, else what the loop is running
 * on — the shared settings where there is one, since that is what it runs on.
 */
function shown(row: AutoscaleRow): string | null {
	if (edited(row.field)) {
		return drafts.value[row.field] ?? null;
	}

	const value = row.sharedSettings ?? row.effective;

	return value === null || value === undefined
		? null
		: String(value);
}

/**
 * Apply one row, and keep what was typed unless the write took it.
 *
 * A refused value is the one worth correcting: the message says what is wrong
 * with it, and a box emptied under the operator leaves them retyping it from
 * that message alone.
 */
async function applyRow(field: string, kind: string): Promise<void> {
	const value = parseFieldValue(kind as never, drafts.value[field]);

	if (await write({ [field]: value })) {
		delete drafts.value[field];
	}
}

function cancelRow(field: string): void {
	delete drafts.value[field];
}

async function resetRow(field: string): Promise<void> {
	if (await write({ [field]: null })) {
		delete drafts.value[field];
	}
}

/**
 * Every pending change in one write, so a set of fields meant to move together
 * reaches the loop on the same tick.
 */
async function applyAll(): Promise<void> {
	const patch: Record<string, unknown> = {};

	for (const row of rows.value) {
		if (edited(row.field)) {
			patch[row.field] = parseFieldValue(row.kind, drafts.value[row.field]);
		}
	}

	// The whole set is judged against the whole configuration, so this is the
	// write most likely to be refused — and the one whose typing costs most to
	// lose.
	if (await write(patch) === false) {
		return;
	}

	for (const field of Object.keys(patch)) {
		delete drafts.value[field];
	}
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

/*
 * The drill runs on the pool rather than on this page, and any admin can start
 * or call one off: it is read again with each report so one begun elsewhere is
 * counted down here too.
 */
watch(() => props.runners, () => {
	if (drillAvailable.value) {
		void loadDrill();
	}
});

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
				'No Redis configured, so a change has no way to reach the process '
					+ 'that scales the pool: this deployment is tuned through its '
					+ 'environment.',
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

		<Teleport
			:to="props.summaryTarget ?? undefined"
			:disabled="props.summaryTarget === null"
		>
			<div v-if="runner" class="summary">
				<span>{{ runner.state.config.appName }}</span>

				<span>
					{{ runner.state.workers }}
					{{ t('autoscale_workers', 'workers') }}
				</span>

				<span v-if="runner.state.pendingWorkers > 0">
					{{ runner.state.pendingWorkers }}
					{{ t('autoscale_pending', 'starting') }}
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
		</Teleport>

		<Teleport
			:to="props.actionsTarget ?? undefined"
			:disabled="props.actionsTarget === null"
		>
			<div v-if="available" class="levers">
				<v-button
					v-tooltip.bottom="runner?.state.config.enabled === false
						? t('autoscale_resume', 'Resume autoscaling')
						: t('autoscale_pause', 'Pause autoscaling')"
					small
					icon
					rounded
					class="pause"
					:disabled="!runner || saving"
					@click="pause"
				>
					<v-icon
						:name="runner?.state.config.enabled === false
							? 'play_arrow'
							: 'pause'"
					/>
				</v-button>

				<v-button
					v-tooltip.bottom="runner && isPinned(runner.state)
						? t('autoscale_unpin', 'Unpin the pool')
						: t('autoscale_pin', 'Pin the pool where it is')"
					small
					icon
					rounded
					class="pin"
					:disabled="!runner || saving"
					@click="pin"
				>
					<v-icon
						:name="runner && isPinned(runner.state) ? 'keep_off' : 'push_pin'"
					/>
				</v-button>

				<v-button
					v-tooltip.bottom="restarting
						? t('autoscale_restarting', 'Restarting the pool')
						: t('autoscale_restart', 'Restart the pool')"
					small
					icon
					rounded
					secondary
					class="restart"
					:disabled="!runner || saving || restarting"
					@click="restartArmed = true"
				>
					<v-icon name="restart_alt" />
				</v-button>

				<div v-if="drillAvailable" class="drill">
					<div class="knobs">
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

						<v-button
							v-if="drilling"
							v-tooltip.bottom="t('autoscale_drill_stop', 'Stop the drill')"
							small
							icon
							secondary
							class="drill-stop"
							:disabled="saving"
							@click="stopDrill"
						>
							<v-icon name="stop" />
						</v-button>

						<v-button
							v-else
							v-tooltip.bottom="drillBlocked ?? t(
								'autoscale_drill_note',
								'Run a load drill: loads every worker so the pool has to '
									+ 'decide, without touching anything it decides on.',
							)"
							small
							icon
							class="drill-start"
							:disabled="saving || drillBlocked !== null"
							@click="startDrill"
						>
							<v-icon name="bolt" />
						</v-button>
					</div>

					<span v-if="drilling" class="drilling">
						{{ drilling.remaining }}s {{ t('autoscale_drill_left', 'left') }}
					</span>

					<!-- The reason a drill cannot run is shown rather than told in the
					button's tooltip, which a disabled button gives no way to reach. -->
					<span v-else-if="drillBlocked !== null" class="drill-note">
						{{ drillBlocked }}
					</span>
				</div>

				<v-dialog
					v-model="restartArmed"
					@esc="restartArmed = false"
					@apply="restart"
				>
					<v-card>
						<v-card-title>
							{{ t('autoscale_restart', 'Restart the pool') }}
						</v-card-title>

						<v-card-text>{{ restartNote }}</v-card-text>

						<v-card-actions>
							<v-button
								secondary
								class="restart-cancel"
								:disabled="saving"
								@click="restartArmed = false"
							>
								{{ t('autoscale_restart_cancel', 'Keep the pool as it is') }}
							</v-button>

							<v-button
								danger
								class="restart-confirm"
								:disabled="saving"
								@click="restart"
							>
								{{ t('autoscale_restart_confirm', 'Replace every worker') }}
							</v-button>
						</v-card-actions>
					</v-card>
				</v-dialog>
			</div>
		</Teleport>

		<p v-if="reloadLine" class="reload">{{ reloadLine }}</p>

		<p v-if="stampLine" class="stamp">{{ stampLine }}</p>

		<!-- Carried by every change made from here, levers included, and stored
		with it: the shared settings outlive the incident that justified them. -->
		<v-input
			v-if="available"
			v-model="note"
			small
			full-width
			class="note"
			:disabled="saving"
			:placeholder="t(
				'autoscale_note',
				'Why — stored with the next change made here',
			)"
		/>

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
					<td>
						<span v-tooltip="describeField(row)">{{ row.variable }}</span>
					</td>
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
							:disabled="saving || row.inactive || row.sharedSettings === null"
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

			<v-button
				small
				secondary
				:disabled="!sharedSettings || saving"
				@click="resetToEnv"
			>
				{{ t('autoscale_reset_env', 'Reset to env') }}
			</v-button>
		</div>

		<template v-if="supervisor.length > 0">
			<h4 class="section-title supervisor-title">
				{{ t('autoscale_supervisor', 'Supervisor') }}
			</h4>

			<p class="supervisor-note">
				{{ t(
					'autoscale_supervisor_note',
					'What PM2 is running the pool under. Read when a worker starts, '
						+ 'so a change here reaches the pool on the next restart. '
						+ 'The pool size and its mode take a deploy.',
				) }}
			</p>

			<table class="fields supervisor">
				<thead>
					<tr>
						<th>{{ t('autoscale_field', 'Field') }}</th>
						<th>{{ t('autoscale_value', 'Value') }}</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in supervisor"
						:key="row.field"
						:class="{ inactive: row.option === null }"
					>
						<td><span v-tooltip="row.description">{{ row.field }}</span></td>
						<td class="edit">
							<span
								class="control"
								:class="{
									numeric: row.option !== null,
									pending: supervisorEdited(row),
								}"
							>
								<v-input
									:model-value="supervisorShown(row)"
									small
									full-width
									:type="row.option ? 'number' : 'text'"
									:min="row.option?.min"
									:max="row.option?.max"
									:suffix="row.option?.unit"
									:placeholder="supervisorPlaceholder(row)"
									:disabled="saving || row.option === null"
									@update:model-value="supervisorTyped(row, $event)"
									@keyup.enter="applySupervisorRow(row)"
								>
									<template #append>
										<span
											class="source"
											:class="{ pending: supervisorEdited(row) }"
										>
											{{ supervisorSource(row) }}
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
								:disabled="saving || !supervisorEdited(row)"
								@click="cancelSupervisorRow(row)"
							>
								<v-icon name="close" x-small />
							</v-button>

							<v-button
								x-small
								icon
								class="apply"
								:tooltip="t(
									'autoscale_supervisor_apply',
									'Store this for the next restart',
								)"
								:disabled="saving || !supervisorEdited(row)"
								@click="applySupervisorRow(row)"
							>
								<v-icon name="check" x-small />
							</v-button>

							<v-button
								x-small
								icon
								secondary
								class="reset"
								:tooltip="t(
									'autoscale_supervisor_reset',
									'Hand this option back to the environment',
								)"
								:disabled="saving || row.sharedSettings === null"
								@click="resetSupervisorRow(row)"
							>
								<v-icon name="settings_backup_restore" x-small />
							</v-button>
						</td>
					</tr>
				</tbody>
			</table>

			<p v-if="supervisorSetByEmail" class="supervisor-note">
				{{ t('autoscale_supervisor_set_by', 'Options stored by') }}
				{{ supervisorSetByEmail }}
			</p>
		</template>

		<p v-if="configKey" class="key">
			{{ t('autoscale_key', 'Stored in') }} {{ configKey }}
		</p>
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

.summary {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	margin-block-end: 8px;
}

.levers {
	display: flex;
	gap: 8px;
	align-items: center;
}

.note {
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

/* The drill sits at the end of the levers it belongs with, so the controls
   that change the pool stay read as one group. */
.drill {
	display: flex;
	gap: 8px;
	align-items: center;
}

/* The seconds, the share and the button that spends them are one control: a
   drill is what the two numbers are for. */
.knobs {
	display: flex;
	gap: 4px;
	align-items: center;
	padding: 2px;
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
}

/* Each knob hugs its number, so the group is as wide as what it holds. */
.knobs :deep(input) {
	flex-grow: 0;
	field-sizing: content;
	min-inline-size: 3ch;
	max-inline-size: 6ch;
}

.knobs :deep(.suffix) {
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
</style>
