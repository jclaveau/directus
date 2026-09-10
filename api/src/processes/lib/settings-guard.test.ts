import { beforeEach, expect, test, vi } from 'vitest';
import { useEnv } from '@directus/env';
import {
	assertUsableSharedSettings,
	initSharedSettingsGuard,
} from './settings-guard.js';

vi.mock('@directus/env');
vi.mock('../../emitter.js');

const ENV_MAX_WORKERS = 4;

beforeEach(() => {
	vi.clearAllMocks();

	vi.mocked(useEnv).mockReturnValue({
		PM2_AUTOSCALE_MAX_WORKERS: ENV_MAX_WORKERS,
	});
});

/** The check, as the thing an assertion runs and a refusal comes out of. */
function checking(write: Record<string, unknown>) {
	return () => {
		return assertUsableSharedSettings(write);
	};
}

test('lets a settings write carrying neither column through', () => {
	expect(checking({ project_name: 'planner' })).not.toThrow();
});

test('lets a whole layer be handed back to the environment', () => {
	const released = { autoscale_settings: null, supervisor_settings: null };

	expect(checking(released)).not.toThrow();
});

// What the route writes has to pass this too, or the check meant to cover the
// writers it misses would start refusing the route's own writes.
test('lets the stamped document a write produces through', () => {
	const stamped = {
		maxWorkers: 8,
		setBy: 'writer-id',
		setAt: '2026-09-10T00:00:00.000Z',
		setFrom: 'admin',
		note: 'the ceiling for the campaign',
	};

	expect(checking({ autoscale_settings: stamped })).not.toThrow();
});

test('refuses a field the configuration does not have', () => {
	expect(checking({ autoscale_settings: { workers: 8 } }))
		.toThrowError(`'workers' is not a field of the autoscale configuration`);
});

// The one an operator would type by hand: a value neither true nor false
// resolves to false, so a write nobody meant as a disable would be one.
test('refuses a value the loop cannot read as a boolean', () => {
	expect(checking({ autoscale_settings: { enabled: 'TRUE' } }))
		.toThrowError(`'enabled' has to be a boolean`);
});

// The route refuses this and names it; through the singleton it would be
// stored, announced to the fleet, and silently clamped on the next tick.
test('refuses a floor above the ceiling the environment holds', () => {
	expect(checking({ autoscale_settings: { minWorkers: 8 } }))
		.toThrowError(`'minWorkers' is 8, above the 'maxWorkers' ceiling of 4`);
});

test('refuses a supervisor option outside its bounds', () => {
	expect(checking({ supervisor_settings: { killTimeout: 1 } }))
		.toThrowError(`'killTimeout' has to be a whole number`);
});

// Stored, any of these reads back as nothing at all: the pool would run the
// environment while the column says a layer is holding it.
test.each([
	['an array', [{ maxWorkers: 8 }]],
	['a number', 4],
	['unparseable text', '{ not json'],
])('refuses a column holding %s', (_shape, value) => {
	expect(checking({ autoscale_settings: value }))
		.toThrowError(`'autoscale_settings' has to be an object of settings`);
});

// A JSON column comes back as a string on sqlite, and a write may hand one
// over the same way; it is the document inside that the loop runs on.
test('reads a document handed over as text', () => {
	const stored = JSON.stringify({ minWorkers: 8 });

	expect(checking({ autoscale_settings: stored }))
		.toThrowError(`'minWorkers' is 8, above the 'maxWorkers' ceiling of 4`);
});

// A deployment nobody has saved a setting on yet has no singleton row, so the
// first write to it is a create and would go unchecked on the update alone.
test('checks the create as well as the update', async () => {
	const { default: emitter } = await import('../../emitter.js');

	await initSharedSettingsGuard();

	expect(vi.mocked(emitter.onFilter).mock.calls.map(([event]) => event))
		.toEqual(['settings.create', 'settings.update']);

	const write = { autoscale_settings: { enabled: 'TRUE' } };

	for (const [, check] of vi.mocked(emitter.onFilter).mock.calls) {
		expect(() => {
			return check(write, {} as never, {} as never);
		}).toThrowError(`'enabled' has to be a boolean`);
	}
});
