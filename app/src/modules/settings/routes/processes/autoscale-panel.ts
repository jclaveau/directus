import type {
	AutoscaleConfig,
	AutoscaleNodeState,
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
	kind: AutoscaleFieldKind;
	/** What the number counts, shown at the end of the input. */
	unit?: string;
	min?: number;
	max?: number;
	step?: number;
	/** Every value the field accepts, where it accepts a fixed few. */
	options?: AutoscaleFieldOption[];
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
	{ field: 'enabled', kind: 'boolean', options: BOOLEAN_OPTIONS },
	{
		field: 'strategy',
		kind: 'choice',
		options: [
			{ text: 'scalabus', value: 'scalabus' },
			{ text: 'legacy', value: 'legacy' },
		],
	},
	{ field: 'appName', kind: 'text' },
	{
		field: 'signal',
		kind: 'choice',
		options: [
			{ text: 'average', value: 'average' },
			{ text: 'max', value: 'max' },
		],
	},
	{
		field: 'sampleWindow',
		kind: 'number',
		unit: 'samples',
		min: 1,
		max: 30,
		step: 1,
	},
	{
		field: 'scaleCpuThreshold',
		kind: 'number',
		unit: '%',
		min: 1,
		max: 100,
		step: 1,
	},
	{
		field: 'releaseCpuThreshold',
		kind: 'number',
		unit: '%',
		min: 0,
		max: 99,
		step: 1,
	},
	{
		field: 'minWorkers',
		kind: 'number',
		unit: 'workers',
		min: 1,
		max: 64,
		step: 1,
	},
	{
		field: 'maxWorkers',
		kind: 'number',
		unit: 'workers',
		min: 1,
		max: 64,
		step: 1,
	},
	{
		field: 'prewarmWorkers',
		kind: 'number',
		unit: 'workers',
		min: 0,
		max: 64,
		step: 1,
	},
	// Seconds step by five: every one of these is set in tens of seconds or
	// minutes, and an arrow that moves a five-minute cooldown by one is noise.
	{ field: 'minSecondsToScaleUp', kind: 'number', unit: 's', min: 0, step: 5 },
	{ field: 'minSecondsToScaleDown', kind: 'number', unit: 's', min: 0, step: 5 },
	{ field: 'warmupSeconds', kind: 'number', unit: 's', min: 0, step: 5 },
];

export interface AutoscaleRow extends AutoscaleField {
	/** What the loop is running on, or `null` where none reported. */
	effective: unknown;
	/** Which layer that value came from, `null` where no process reported one. */
	source: AutoscaleValueSource | null;
	/** What the override sets, or `null` where it sets nothing for this field. */
	override: unknown;
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
): AutoscaleRow[] {
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
