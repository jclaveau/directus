import { AUTOSCALE_BOUNDS, SUPERVISOR_BOUNDS } from '@directus/constants';
import type {
	AutoscaleConfig,
	AutoscaleNodeState,
	AutoscaleReload,
	AutoscaleRunner,
	AutoscaleValueSource,
} from '@directus/types';

/** What a field holds, which is what the row renders and how a write is typed. */
export type AutoscaleFieldKind = 'boolean' | 'choice' | 'number' | 'text';

export interface AutoscaleFieldOption {
	text: string;
	value: string;
}

export interface AutoscaleField {
	field: keyof AutoscaleConfig;
	/**
	 * The variable that sets it in a deployment, which is what the page names
	 * it by: a change made here is temporary, and the lasting one is made
	 * against this name.
	 */
	variable: string;
	kind: AutoscaleFieldKind;
	/** What this field does to the pool, in a sentence, shown on hover. */
	description: string;
	/** What the number counts, shown at the end of the input. */
	unit?: string;
	min?: number;
	max?: number;
	step?: number;
	/** Every value the field accepts, where it accepts a fixed few. */
	options?: AutoscaleFieldOption[];
	/** Set where the `legacy` rule reads this field nowhere. */
	ignoredByLegacy?: true;
}

const BOOLEAN_OPTIONS: AutoscaleFieldOption[] = [
	{ text: 'enabled', value: 'true' },
	{ text: 'disabled', value: 'false' },
];

/**
 * The fields, in the order they are read rather than alphabetically: what the
 * loop is doing, then what it decides on, then the bounds it decides within,
 * then the pacing.
 *
 * The bounds here shape the input; the loop's `sanitizeConfig` is what enforces
 * them, and reports through `Running on` whatever it corrected a value to.
 */
export const AUTOSCALE_FIELDS: AutoscaleField[] = [
	{
		field: 'enabled',
		variable: 'PM2_AUTOSCALE_ENABLED',
		kind: 'boolean',
		description: 'Disabled leaves the pool at whatever size it is now: '
			+ 'nothing is added and nothing is released.',
		options: BOOLEAN_OPTIONS,
	},
	{
		field: 'strategy',
		variable: 'PM2_AUTOSCALE_STRATEGY',
		kind: 'choice',
		description: 'Which rule decides. `scalabus` reads a smoothed window and '
			+ 'holds still while the pool is starting or restarting; `legacy` '
			+ 'reproduces the pm2-autoscale module this replaces.',
		options: [
			{ text: 'scalabus', value: 'scalabus' },
			{ text: 'legacy', value: 'legacy' },
		],
	},
	{
		field: 'appName',
		variable: 'PM2_AUTOSCALE_APP_NAME',
		kind: 'text',
		description: 'The pm2 app whose workers are counted, judged and resized.',
	},
	{
		field: 'signal',
		variable: 'PM2_AUTOSCALE_SIGNAL',
		kind: 'choice',
		description: 'Whether the pool is judged on the average of its workers or '
			+ 'on its hottest one. `max` reacts to a single busy worker.',
		options: [
			{ text: 'average', value: 'average' },
			{ text: 'max', value: 'max' },
		],
		ignoredByLegacy: true,
	},
	{
		field: 'sampleWindow',
		variable: 'PM2_AUTOSCALE_SAMPLE_WINDOW',
		kind: 'number',
		description: 'How many one-second readings a worker\'s CPU is averaged '
			+ 'over before it counts. Wider reacts later and flaps less.',
		unit: 'samples',
		min: AUTOSCALE_BOUNDS.sampleWindow.low,
		max: AUTOSCALE_BOUNDS.sampleWindow.high,
		step: 1,
		ignoredByLegacy: true,
	},
	{
		field: 'scaleCpuThreshold',
		variable: 'PM2_AUTOSCALE_SCALE_CPU_THRESHOLD',
		kind: 'number',
		description: 'At or above this CPU the pool grows by one worker, '
			+ 'cooldown and ceiling permitting.',
		unit: '%',
		min: AUTOSCALE_BOUNDS.scaleCpuThreshold.low,
		max: AUTOSCALE_BOUNDS.scaleCpuThreshold.high,
		step: 1,
	},
	{
		field: 'releaseCpuThreshold',
		variable: 'PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD',
		kind: 'number',
		description: 'Below this CPU the pool gives a worker back. Kept under the '
			+ 'scale threshold, or a pool would grow and shrink on one reading.',
		unit: '%',
		min: AUTOSCALE_BOUNDS.releaseCpuThreshold.low,
		max: AUTOSCALE_BOUNDS.releaseCpuThreshold.high,
		step: 1,
	},
	{
		field: 'minWorkers',
		variable: 'PM2_AUTOSCALE_MIN_WORKERS',
		kind: 'number',
		description: 'The pool never drops below this, however quiet it gets. '
			+ 'Equal to the ceiling it pins the pool and stops all scaling.',
		unit: 'workers',
		min: AUTOSCALE_BOUNDS.minWorkers.low,
		max: AUTOSCALE_BOUNDS.minWorkers.high,
		step: 1,
	},
	{
		field: 'maxWorkers',
		variable: 'PM2_AUTOSCALE_MAX_WORKERS',
		kind: 'number',
		description: 'The pool never grows past this, and a pool already above it '
			+ 'is brought back immediately rather than after a cooldown.',
		unit: 'workers',
		min: AUTOSCALE_BOUNDS.maxWorkers.low,
		max: AUTOSCALE_BOUNDS.maxWorkers.high,
		step: 1,
	},
	{
		field: 'prewarmWorkers',
		variable: 'PM2_AUTOSCALE_PREWARM',
		kind: 'number',
		description: 'The size to jump to once after a deploy, so the first '
			+ 'requests do not land on a pool sized for an idle night.',
		unit: 'workers',
		min: AUTOSCALE_BOUNDS.prewarmWorkers.low,
		max: AUTOSCALE_BOUNDS.prewarmWorkers.high,
		step: 1,
		ignoredByLegacy: true,
	},
	// Seconds step by five: every one of these is set in tens of seconds or
	// minutes, and an arrow that moves a five-minute cooldown by one is noise.
	{
		field: 'minSecondsToScaleUp',
		variable: 'PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER',
		kind: 'number',
		description: 'How long after adding a worker before another may be added, '
			+ 'which is how long the last one gets to take load.',
		unit: 's',
		min: AUTOSCALE_BOUNDS.minSecondsToScaleUp.low,
		max: AUTOSCALE_BOUNDS.minSecondsToScaleUp.high,
		step: 5,
	},
	{
		field: 'minSecondsToScaleDown',
		variable: 'PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER',
		kind: 'number',
		description: 'How long after releasing a worker before another may go. '
			+ 'Longer than the settling window, so a lull cannot empty the pool.',
		unit: 's',
		min: AUTOSCALE_BOUNDS.minSecondsToScaleDown.low,
		max: AUTOSCALE_BOUNDS.minSecondsToScaleDown.high,
		step: 5,
	},
	{
		field: 'warmupSeconds',
		variable: 'PM2_AUTOSCALE_WARMUP_SECONDS',
		kind: 'number',
		description: 'How long a worker\'s CPU counts as its own startup rather '
			+ 'than load, and how long the pool is left alone after a restart.',
		unit: 's',
		min: AUTOSCALE_BOUNDS.warmupSeconds.low,
		max: AUTOSCALE_BOUNDS.warmupSeconds.high,
		step: 5,
		ignoredByLegacy: true,
	},
];

export interface AutoscaleRow extends AutoscaleField {
	/** What the loop is running on, or `null` where none reported. */
	effective: unknown;
	/** Which layer that value came from, `null` where no process reported one. */
	source: AutoscaleValueSource | null;
	/** What the override sets, or `null` where it sets nothing for this field. */
	override: unknown;
	/** Where clearing this field lands it, `null` where nothing reported one. */
	cleared: unknown;
	/** Set where the running rule reads this field nowhere. */
	inactive: boolean;
}

/**
 * One row per field: what the loop runs on, where it came from, and what the
 * override holds.
 *
 * The effective value is the one the deciding process reported and never one
 * recomputed here — the environment this page's request landed in belongs to an
 * api worker, and the pool is scaled by a different process with its own.
 */
export function configRows(
	state: AutoscaleNodeState | null,
	override: Record<string, unknown> | null,
	pendingStrategy: unknown = null,
): AutoscaleRow[] {
	// A strategy picked but not yet applied greys the fields it would blind, so
	// the switch shows what it costs before it is made.
	const strategy = pendingStrategy
		?? (state === null
			? override?.['strategy']
			: state.config.strategy);

	return AUTOSCALE_FIELDS.map((definition) => {
		const field = definition.field;
		const overridden = override?.[field] ?? null;

		// Nothing reported means nothing is scaling anything here: the only value
		// to show is the one stored — and where nothing is stored either, the
		// field has no source to name rather than a default one.
		const source = state === null
			? storedSource(overridden)
			: state.sources[field];

		return {
			...definition,
			effective: state === null
				? overridden
				: state.config[field],
			source,
			override: overridden,
			cleared: state === null
				? null
				: state.withoutOverride[field],
			inactive: definition.ignoredByLegacy === true && strategy === 'legacy',
		};
	});
}

function storedSource(overridden: unknown): AutoscaleValueSource | null {
	return overridden === null
		? null
		: 'override';
}

/** What a value typed into a row means, `null` clearing the field. */
export function parseFieldValue(
	kind: AutoscaleFieldKind,
	raw: unknown,
): unknown {
	if (raw === null || raw === undefined || raw === '') {
		return null;
	}

	if (kind === 'number') {
		const parsed = Number(raw);

		return Number.isFinite(parsed)
			? parsed
			: null;
	}

	if (kind === 'boolean') {
		return raw === true || raw === 'true';
	}

	return String(raw);
}

/**
 * The pool this panel is about.
 *
 * One process scales one pool, and a deployment runs one autoscaler per
 * container — so more than one runner means more than one replica reporting the
 * same configuration, and the first of them describes it.
 */
export function firstRunner(runners: AutoscaleRunner[]): AutoscaleRunner | null {
	return runners[0] ?? null;
}

/** Seconds since a decision, for a page to say how live what it shows is. */
export function secondsSince(at: number, now: number): number {
	return Math.max(0, Math.round((now - at) / 1000));
}

/**
 * What the last tick did, in a sentence.
 *
 * A decision that asked for no change is the common one and says the least, so
 * it is reported alongside the move that made the pool the size it is rather
 * than instead of it.
 */
export function describeDecision(state: AutoscaleNodeState): string {
	if (state.lastDecision === null) {
		return 'no decision yet';
	}

	const { workers, reason } = state.lastDecision;

	return workers === null
		? reason
		: `asked for ${workers} workers: ${reason}`;
}

/**
 * A patch pinning the pool where it is.
 *
 * A floor and a ceiling that meet leave the rule no branch that returns a size,
 * so the pool stops moving whatever it reports — which is the lever to reach
 * for when the numbers behind a decision are the thing in doubt.
 */
export function pinPatch(state: AutoscaleNodeState): Record<string, number> {
	const workers = Math.max(1, state.workers);

	return { minWorkers: workers, maxWorkers: workers };
}

/** Whether the pool is pinned, which is what the lever toggles back. */
export function isPinned(state: AutoscaleNodeState): boolean {
	return state.config.minWorkers === state.config.maxWorkers;
}

/**
 * Whether the pool is already doing something.
 *
 * A drill measures what the loop does with a configuration on load it made
 * itself, so it is only honest on a pool at rest — and the workers it would
 * buy over real traffic are ones nobody chose to buy. What the loop calls a
 * worker that is not busy is its own release threshold, so that is what this
 * is read against. The api refuses the same case; this only stops the button
 * offering it.
 */
export function underLoad(state: AutoscaleNodeState): boolean {
	return state.cpuPercents.some((cpu) => {
		return cpu >= state.config.releaseCpuThreshold;
	});
}

/** Seconds left of a drill, given when it runs out and what the clock says. */
export function drillRemaining(until: number | null, now: number): number {
	return until === null
		? 0
		: Math.max(0, Math.ceil((until - now) / 1000));
}

/** What an option a restart can carry accepts, and what it runs on now. */
export interface SupervisorOption {
	/** The override field the change is written to. */
	field: string;
	min: number;
	max: number;
	unit: string;
	/** What pm2 is running under, shown in an empty box, `null` for nothing. */
	declared: number | null;
}

/** One line of the pm2 declaration, as the panel reports it. */
export interface SupervisorRow {
	/** The variable that sets it, which is where a change to it is made. */
	field: string;
	/** The value pm2 acts on, with whatever it counts. */
	value: string;
	/** The pm2 entry it sets and what that entry decides, shown on hover. */
	description: string;
	/** `null` for an option no restart can carry, so the page cannot offer it. */
	option: SupervisorOption | null;
	/** What the override holds for it, `null` where the environment answers. */
	override: number | null;
	/**
	 * Which layer the running value came from.
	 *
	 * Only two are tellable apart from here: the override this page writes, and
	 * the supervisor itself — whether pm2 took a value from a variable or from
	 * its own default is not in what it reports.
	 */
	source: 'override' | 'pm2';
}

const MEGABYTE = 1_048_576;

/**
 * The declaration the pool runs under, as rows.
 *
 * Separate from the configuration above it: pm2 reads these when it starts a
 * worker, so a change to one reaches the pool through the rolling restart
 * below rather than on the next tick. Six of them a restart can carry, and
 * those take a value; the pool size and its execution mode it cannot, and the
 * size is the loop's to decide anyway.
 */
export function supervisorRows(
	state: AutoscaleNodeState | null,
	override: Record<string, unknown> | null = null,
): SupervisorRow[] {
	const supervisor = state?.supervisor ?? null;

	if (supervisor === null) {
		return [];
	}

	function overriding(field: string): number | null {
		const value = override?.[field];

		return typeof value === 'number'
			? value
			: null;
	}

	function sourceOf(field: string): 'override' | 'pm2' {
		return overriding(field) === null
			? 'pm2'
			: 'override';
	}

	const ceiling = supervisor.maxMemoryRestart === null
		? null
		: Math.round(supervisor.maxMemoryRestart / MEGABYTE);

	return [
		{
			field: 'PM2_INSTANCES',
			value: String(supervisor.instances),
			description: 'instances: the workers the pool boots with, and its '
				+ 'size until the first tick. From there the floor, the ceiling '
				+ 'and the prewarm above own it.',
			option: null,
			override: null,
			source: 'pm2',
		},
		{
			field: 'PM2_EXEC_MODE',
			value: supervisor.execMode,
			description: 'exec_mode: only a cluster can be resized, so a pool in '
				+ 'fork mode is one the autoscaler cannot move.',
			option: null,
			override: null,
			source: 'pm2',
		},
		{
			field: 'wait_ready',
			value: String(supervisor.waitReady),
			description: 'Set in ecosystem.config.cjs rather than by a variable. '
				+ 'Whether a starting worker is held out of the pool until it says '
				+ 'it is serving. False counts it in as soon as it forks, so the '
				+ 'pool is judged on a worker that is still booting.',
			option: null,
			override: null,
			source: 'pm2',
		},
		{
			field: 'PM2_LISTEN_TIMEOUT',
			value: `${supervisor.listenTimeout} ms`,
			description: 'listen_timeout: how long a worker has to say it is ready '
				+ 'before it counts as up anyway. Under the time a worker takes to '
				+ 'boot, every start reports ready before it is.',
			option: {
				field: 'listenTimeout',
				min: SUPERVISOR_BOUNDS.listenTimeout.low,
				max: SUPERVISOR_BOUNDS.listenTimeout.high,
				unit: SUPERVISOR_BOUNDS.listenTimeout.unit,
				declared: supervisor.listenTimeout,
			},
			override: overriding('listenTimeout'),
			source: sourceOf('listenTimeout'),
		},
		{
			field: 'PM2_KILL_TIMEOUT',
			value: `${supervisor.killTimeout} ms`,
			description: 'kill_timeout: how long a released worker has between the '
				+ 'signal to stop and being killed. Under the time a request takes, '
				+ 'releasing a worker drops the requests it was serving.',
			option: {
				field: 'killTimeout',
				min: SUPERVISOR_BOUNDS.killTimeout.low,
				max: SUPERVISOR_BOUNDS.killTimeout.high,
				unit: SUPERVISOR_BOUNDS.killTimeout.unit,
				declared: supervisor.killTimeout,
			},
			override: overriding('killTimeout'),
			source: sourceOf('killTimeout'),
		},
		{
			field: 'PM2_MAX_MEMORY_RESTART',
			value: ceiling === null
				? 'off'
				: `${ceiling} MB`,
			description: 'max_memory_restart: the size a worker is restarted at. '
				+ 'Set under what a worker legitimately reaches, the restarts it '
				+ 'causes read as load and buy more workers to restart.',
			option: {
				field: 'maxMemoryRestartMegabytes',
				min: SUPERVISOR_BOUNDS.maxMemoryRestartMegabytes.low,
				max: SUPERVISOR_BOUNDS.maxMemoryRestartMegabytes.high,
				unit: SUPERVISOR_BOUNDS.maxMemoryRestartMegabytes.unit,
				declared: ceiling,
			},
			override: overriding('maxMemoryRestartMegabytes'),
			source: sourceOf('maxMemoryRestartMegabytes'),
		},
		{
			field: 'PM2_AUTO_RESTART',
			value: String(supervisor.autorestart),
			description: 'autorestart: whether a worker that exits is replaced.',
			option: null,
			override: null,
			source: 'pm2',
		},
		{
			field: 'PM2_RESTART_DELAY',
			value: `${supervisor.restartDelay} ms`,
			description: 'restart_delay: how long the supervisor waits before '
				+ 'replacing a worker that died. At zero a crash loop restarts as '
				+ 'fast as it can boot, and its boot CPU is what the pool is judged '
				+ 'on.',
			option: {
				field: 'restartDelay',
				min: SUPERVISOR_BOUNDS.restartDelay.low,
				max: SUPERVISOR_BOUNDS.restartDelay.high,
				unit: SUPERVISOR_BOUNDS.restartDelay.unit,
				declared: supervisor.restartDelay,
			},
			override: overriding('restartDelay'),
			source: sourceOf('restartDelay'),
		},
		{
			field: 'PM2_MIN_UPTIME',
			value: `${supervisor.minUptime} ms`,
			description: 'min_uptime: how long a worker has to survive for its '
				+ 'start to count as clean rather than as one of the unstable '
				+ 'restarts counted against the ceiling below.',
			option: {
				field: 'minUptime',
				min: SUPERVISOR_BOUNDS.minUptime.low,
				max: SUPERVISOR_BOUNDS.minUptime.high,
				unit: SUPERVISOR_BOUNDS.minUptime.unit,
				declared: supervisor.minUptime,
			},
			override: overriding('minUptime'),
			source: sourceOf('minUptime'),
		},
		{
			field: 'PM2_MAX_RESTARTS',
			value: String(supervisor.maxRestarts),
			description: 'max_restarts: how many unstable restarts a worker gets '
				+ 'before the supervisor stops replacing it.',
			option: {
				field: 'maxRestarts',
				min: SUPERVISOR_BOUNDS.maxRestarts.low,
				max: SUPERVISOR_BOUNDS.maxRestarts.high,
				unit: SUPERVISOR_BOUNDS.maxRestarts.unit,
				declared: supervisor.maxRestarts,
			},
			override: overriding('maxRestarts'),
			source: sourceOf('maxRestarts'),
		},
	];
}

/**
 * Where the pool's last rolling restart got to, in a sentence.
 *
 * Kept free of any clock: the restart is reported by the process running it,
 * and a page counting seconds against its own would be timing the gap between
 * two machines as much as the restart.
 */
export function describeReload(reload: AutoscaleReload | null): string | null {
	if (reload === null || reload.askedAt === null) {
		return null;
	}

	if (reload.running) {
		return 'restarting the pool, worker by worker';
	}

	if (reload.error !== null) {
		return `the last restart failed: ${reload.error}`;
	}

	// A request the loop has seen but not begun: it starts one on its next tick,
	// and a page saying nothing in between reads as a button that did nothing.
	if (reload.finishedAt === null || reload.finishedAt < reload.askedAt) {
		return 'a restart was asked for';
	}

	// A restart that ended is announced when it ends rather than reported for as
	// long as it stays the last thing that happened.
	return null;
}
