import type { AutoscaleNodeState, AutoscaleRunner } from '@directus/types';
import { expect, test } from 'vitest';
import {
	configRows,
	describeDecision,
	firstRunner,
	isPinned,
	parseFieldValue,
	pinPatch,
	secondsSince,
} from './autoscale-panel';

function state(overrides: Partial<AutoscaleNodeState> = {}): AutoscaleNodeState {
	return {
		at: 1_700_000_000_000,
		config: {
			enabled: true,
			strategy: 'scalabus',
			appName: 'api',
			signal: 'average',
			sampleWindow: 5,
			scaleCpuThreshold: 60,
			releaseCpuThreshold: 40,
			minWorkers: 1,
			maxWorkers: 4,
			prewarmWorkers: 0,
			minSecondsToScaleUp: 10,
			minSecondsToScaleDown: 300,
			warmupSeconds: 30,
		},
		withoutOverride: {
			enabled: true,
			strategy: 'scalabus',
			appName: 'api',
			signal: 'average',
			sampleWindow: 5,
			scaleCpuThreshold: 60,
			releaseCpuThreshold: 40,
			minWorkers: 1,
			maxWorkers: 2,
			prewarmWorkers: 0,
			minSecondsToScaleUp: 10,
			minSecondsToScaleDown: 300,
			warmupSeconds: 30,
		},
		sources: {
			enabled: 'default',
			strategy: 'default',
			appName: 'env',
			signal: 'default',
			sampleWindow: 'default',
			scaleCpuThreshold: 'default',
			releaseCpuThreshold: 'default',
			minWorkers: 'default',
			maxWorkers: 'override',
			prewarmWorkers: 'default',
			minSecondsToScaleUp: 'default',
			minSecondsToScaleDown: 'default',
			warmupSeconds: 'default',
		},
		workers: 3,
		pendingWorkers: 0,
		warmingWorkers: 0,
		cpuPercents: [20, 24, 22],
		lastDecision: null,
		lastScale: null,
		...overrides,
	};
}

// The values shown are the ones the deciding process reported: this page is
// served by an api worker whose own environment is a different process's.
test('a row shows what the loop runs on and where it came from', () => {
	const rows = configRows(state(), { maxWorkers: 8 });
	const ceiling = rows.find((row) => row.field === 'maxWorkers');

	expect(ceiling).toMatchObject({
		field: 'maxWorkers',
		kind: 'number',
		effective: 4,
		source: 'override',
		override: 8,
	});
});

// The loop corrects bounds and reports what it corrected them to, so a stored 8
// against a running 4 is the page saying so rather than a page out of date.
test('a row keeps the stored value apart from the running one', () => {
	const rows = configRows(state(), { maxWorkers: 8 });

	expect(rows.find((row) => row.field === 'maxWorkers')?.effective).toBe(4);
	expect(rows.find((row) => row.field === 'maxWorkers')?.override).toBe(8);
});

// Nothing scaling means nothing to show but what is stored — and stored is not
// running, which is what the source says.
test('a pool with no runner shows the override alone', () => {
	const rows = configRows(null, { maxWorkers: 8 });
	const ceiling = rows.find((row) => row.field === 'maxWorkers');

	expect(ceiling).toMatchObject({ effective: 8, source: 'override' });

	// Nothing reported and nothing stored: naming a layer here would claim a
	// value came from somewhere when no value came at all.
	expect(rows.find((row) => row.field === 'minWorkers'))
		.toMatchObject({ effective: null, override: null, source: null });
});

// Clearing a field hands it back to the env chain, and only the process that
// resolved that chain knows what it holds under an override.
test('a row names the value clearing it would land on', () => {
	const rows = configRows(state(), { maxWorkers: 8 });

	expect(rows.find((row) => row.field === 'maxWorkers')?.cleared).toBe(2);

	// Nothing reported, so nothing to promise about where a clear lands.
	expect(configRows(null, { maxWorkers: 8 })
		.find((row) => row.field === 'maxWorkers')?.cleared)
		.toBeNull();
});

// The legacy rule reads its own window, its hottest worker and no prewarm, so
// four of the fields change nothing at all while it is the one deciding.
test('the fields the legacy rule never reads are marked inactive', () => {
	const legacy = configRows(state({
		config: { ...state().config, strategy: 'legacy' },
	}), null);

	const inactive = legacy.filter((row) => row.inactive)
		.map((row) => row.field);

	expect(inactive)
		.toEqual(['signal', 'sampleWindow', 'prewarmWorkers', 'warmupSeconds']);

	expect(configRows(state(), null).filter((row) => row.inactive)).toEqual([]);

	// Nothing is running it yet, so the stored strategy is the one to read.
	expect(configRows(null, { strategy: 'legacy' })
		.find((row) => row.field === 'signal')?.inactive)
		.toBe(true);
});

test('every field says what it does to the pool', () => {
	const rows = configRows(state(), null);

	expect(rows.every((row) => row.description.length > 20)).toBe(true);
});

test('an emptied field clears rather than writing a zero', () => {
	expect(parseFieldValue('number', '')).toBeNull();
	expect(parseFieldValue('number', '0')).toBe(0);
	expect(parseFieldValue('number', 'eight')).toBeNull();
	expect(parseFieldValue('boolean', 'true')).toBe(true);
	expect(parseFieldValue('boolean', 'false')).toBe(false);
	expect(parseFieldValue('choice', 'legacy')).toBe('legacy');
});

// The loop clamps what it is given; these only shape the input, so they are
// worth pinning against the bounds they mirror.
test('a number field carries the bounds and the unit it counts in', () => {
	const rows = configRows(state(), null);

	expect(rows.find((row) => row.field === 'maxWorkers')).toMatchObject({
		kind: 'number',
		unit: 'workers',
		min: 1,
		max: 64,
		step: 1,
	});

	expect(rows.find((row) => row.field === 'scaleCpuThreshold'))
		.toMatchObject({ unit: '%', min: 1, max: 100 });

	expect(rows.find((row) => row.field === 'warmupSeconds'))
		.toMatchObject({ unit: 's', min: 0, step: 5 });
});

test('a field with a fixed few values offers exactly those', () => {
	const rows = configRows(state(), null);

	expect(rows.find((row) => row.field === 'strategy')?.options)
		.toEqual([
			{ text: 'scalabus', value: 'scalabus' },
			{ text: 'legacy', value: 'legacy' },
		]);

	expect(rows.find((row) => row.field === 'signal')?.options)
		.toEqual([
			{ text: 'average', value: 'average' },
			{ text: 'max', value: 'max' },
		]);

	expect(rows.find((row) => row.field === 'enabled')?.options)
		.toEqual([
			{ text: 'enabled', value: 'true' },
			{ text: 'disabled', value: 'false' },
		]);

	// A pool name is whatever the deployment called its app.
	expect(rows.find((row) => row.field === 'appName')?.kind).toBe('text');
	expect(rows.find((row) => row.field === 'appName')?.options).toBeUndefined();
});

// A floor and a ceiling that meet leave the rule no branch that returns a size,
// so the pool holds whatever its CPU reads — the lever for when the numbers
// behind a decision are the thing in doubt.
test('pinning asks for the size the pool is at', () => {
	expect(pinPatch(state({ workers: 3 }))).toEqual({ minWorkers: 3, maxWorkers: 3 });

	// A pool read as empty would otherwise pin at zero workers.
	expect(pinPatch(state({ workers: 0 }))).toEqual({ minWorkers: 1, maxWorkers: 1 });

	expect(isPinned(state())).toBe(false);
});

test('a decision that moved the pool says what it asked for', () => {
	expect(describeDecision(state())).toBe('no decision yet');

	expect(describeDecision(state({
		lastDecision: { at: 1, workers: null, reason: 'average cpu 22% is in the band' },
	}))).toBe('average cpu 22% is in the band');

	expect(describeDecision(state({
		lastDecision: { at: 1, workers: 4, reason: 'average cpu 72% is high' },
	}))).toBe('asked for 4 workers: average cpu 72% is high');
});

test('the age of a reading never reads as the future', () => {
	expect(secondsSince(1_000, 5_000)).toBe(4);
	expect(secondsSince(9_000, 5_000)).toBe(0);
});

test('one runner describes the pool, and none is answered as none', () => {
	const runner = { state: state() } as AutoscaleRunner;

	expect(firstRunner([runner])).toBe(runner);
	expect(firstRunner([])).toBeNull();
});
