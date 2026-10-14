import { beforeEach, expect, test, vi } from 'vitest';
import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import {
	assertUsableCacheFields,
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

test('lets the cache layer switch the response cache off', () => {
	expect(checking({ cache_settings: { response: false } })).not.toThrow();
});

test('lets the cache layer hand response back to the environment', () => {
	expect(checking({ cache_settings: { response: null } })).not.toThrow();
});

// The service writes the layer stamped, and through this same guard.
test('lets the cache layer carry the stamp of its write', () => {
	expect(checking({
		cache_settings: {
			response: false,
			setBy: 'admin-id',
			setAt: '2026-09-30T08:00:00.000Z',
			setFrom: 'admin',
		},
	})).not.toThrow();
});

test('refuses a field the cache layer does not have', () => {
	expect(checking({ cache_settings: { ttl: '1h' } }))
		.toThrowError(`'cache_settings.ttl' is not a cache setting`);
});

test('refuses a response the mirror would read as unset', () => {
	expect(checking({ cache_settings: { response: 'false' } }))
		.toThrowError(`'cache_settings.response' has to be true, false or null`);
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

	expect(() => {
		return vi.mocked(emitter.onFilter).mock.calls[0]![1](
			[{ data: { autoscale_settings: { enabled: 'TRUE' } } }],
			{} as never,
			{} as never,
		);
	}).toThrowError(`'enabled' has to be a boolean`);

	expect(() => {
		return vi.mocked(emitter.onFilter).mock.calls[1]![1](
			[{ data: { autoscale_settings: { enabled: 'TRUE' } }, keys: [1] }],
			{} as never,
			{} as never,
		);
	}).toThrowError(`'enabled' has to be a boolean`);
});

// Flow filters re-register on every flows reload, so they land after this one;
// registering it to run last lets the check see what they changed.
test('checks the write after every other filter of it', async () => {
	const { default: emitter } = await import('../../emitter.js');

	await initSharedSettingsGuard();

	expect(emitter.onFilter).toHaveBeenCalledTimes(2);

	expect(emitter.onFilter).toHaveBeenNthCalledWith(
		1,
		'settings.create',
		expect.any(Function),
		{ runsLast: true },
	);

	expect(emitter.onFilter).toHaveBeenNthCalledWith(
		2,
		'settings.update',
		expect.any(Function),
		{ runsLast: true },
	);
});

// A filter registered ahead of this one can cancel the whole write by answering
// null, which the next filter receives as its payload.
test('passes a write an earlier filter cancelled through', async () => {
	const { default: emitter } = await import('../../emitter.js');

	await initSharedSettingsGuard();

	expect(vi.mocked(emitter.onFilter).mock.calls[0]![1](
		null,
		{} as never,
		{} as never,
	)).toBeNull();

	expect(vi.mocked(emitter.onFilter).mock.calls[1]![1](
		null,
		{} as never,
		{} as never,
	)).toBeNull();
});

test.each([
	['30s'],
	[''],
	[null],
])('lets the cache_ttl %j through', (cacheTtl) => {
	expect(() => assertUsableCacheFields({ cache_ttl: cacheTtl })).not.toThrow();
});

test.each([
	['abc', 'Invalid cache_ttl "abc" — expected a positive duration like "30s", '
		+ '"5m", "1h"'],
	['30x', 'Invalid cache_ttl "30x" — expected a positive duration like "30s", '
		+ '"5m", "1h"'],
	['-5m', 'Invalid cache_ttl "-5m" — expected a positive duration like "30s", '
		+ '"5m", "1h"'],
	['0', 'Invalid cache_ttl "0" — expected a positive duration like "30s", '
		+ '"5m", "1h"'],
])('refuses the cache_ttl %j', (cacheTtl, reason) => {
	expect(() => assertUsableCacheFields({ cache_ttl: cacheTtl }))
		.toThrowError(new InvalidPayloadError({ reason }));
});

test.each([
	['0 3 * * *'],
	[''],
	[null],
])('lets the cache_audit_schedule %j through', (auditRule) => {
	expect(() => assertUsableCacheFields({ cache_audit_schedule: auditRule }))
		.not.toThrow();
});

test.each([
	['hourly', 'Invalid cache_audit_schedule "hourly" — expected a cron rule '
		+ 'like "0 3 * * *"'],
	['60 * * * *', 'Invalid cache_audit_schedule "60 * * * *" — expected a cron '
		+ 'rule like "0 3 * * *"'],
	['99 99 * * *', 'Invalid cache_audit_schedule "99 99 * * *" — expected a '
		+ 'cron rule like "0 3 * * *"'],
])('refuses the cache_audit_schedule %j', (auditRule, reason) => {
	expect(() => assertUsableCacheFields({ cache_audit_schedule: auditRule }))
		.toThrowError(new InvalidPayloadError({ reason }));
});

// After the flow filters, so a flow writing a TTL nothing can run is refused
// too, which a check in the settings service ran too early to see.
test('checks the cache fields a write carries once its filters ran', async () => {
	const { default: emitter } = await import('../../emitter.js');

	await initSharedSettingsGuard();

	expect(() => {
		return vi.mocked(emitter.onFilter).mock.calls[1]![1](
			[{ data: { cache_ttl: 'abc' }, keys: [1] }],
			{} as never,
			{} as never,
		);
	}).toThrowError(new InvalidPayloadError({
		reason: 'Invalid cache_ttl "abc" — expected a positive duration like '
			+ '"30s", "5m", "1h"',
	}));

	expect(() => {
		return vi.mocked(emitter.onFilter).mock.calls[0]![1](
			[{ data: { cache_audit_schedule: 'hourly' } }],
			{} as never,
			{} as never,
		);
	}).toThrowError(new InvalidPayloadError({
		reason: 'Invalid cache_audit_schedule "hourly" — expected a cron rule '
			+ 'like "0 3 * * *"',
	}));
});
