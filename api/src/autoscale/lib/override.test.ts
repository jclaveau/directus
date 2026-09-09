import { expect, test, vi } from 'vitest';
import {
	applyOverridePatch,
	parseOverridePatch,
	readAutoscaleOverride,
	writeAutoscaleOverride,
} from './override.js';

vi.mock('@directus/env');
vi.mock('../../redis/index.js');

const get = vi.fn();
const set = vi.fn();
const del = vi.fn();

async function redisHolding(stored: string | null) {
	const { useEnv } = await import('@directus/env');
	const { useRedis } = await import('../../redis/index.js');

	vi.mocked(useEnv).mockReturnValue({ CACHE_NAMESPACE: 'scalabus' });
	get.mockResolvedValue(stored);
	vi.mocked(useRedis).mockReturnValue({ get, set, del } as never);
}

test('reads the override under the namespaced key', async () => {
	await redisHolding(JSON.stringify({ maxWorkers: 8 }));

	await expect(readAutoscaleOverride()).resolves.toEqual({ maxWorkers: 8 });
	expect(get).toHaveBeenCalledWith('scalabus:config:pm2');
});

// The loop makes no override of a key it cannot parse, and an operator reading
// the page has to be told the same thing rather than shown an error.
test('reads a key edited into nonsense as no override', async () => {
	await redisHolding('{ not json');

	await expect(readAutoscaleOverride()).resolves.toBeNull();
});

test('refuses a field the configuration does not have', () => {
	expect(() => parseOverridePatch({ maxWorker: 8 }))
		.toThrowError("'maxWorker' is not a field of the autoscale configuration");
});

// A value the loop would drop has to fail here: an operator who typed a ceiling
// and watched the pool ignore it cannot tell a rejected write from a clamped one.
test('refuses a value of the wrong shape', () => {
	expect(() => parseOverridePatch({ maxWorkers: '8' }))
		.toThrowError("'maxWorkers' has to be a number of zero or more");

	expect(() => parseOverridePatch({ maxWorkers: -1 }))
		.toThrowError("'maxWorkers' has to be a number of zero or more");

	expect(() => parseOverridePatch({ strategy: 'aggressive' }))
		.toThrowError("'strategy' has to be one of scalabus, legacy");

	expect(() => parseOverridePatch({ enabled: 'false' }))
		.toThrowError("'enabled' has to be a boolean");
});

// Bounds are the loop's to correct, and it reports what it corrected them to —
// refusing them here would refuse a ceiling that is only clamped, not wrong.
test('takes a value the loop will clamp', () => {
	expect(parseOverridePatch({ maxWorkers: 10_000, note: 'incident' }))
		.toEqual({ maxWorkers: 10_000, note: 'incident' });
});

test('lays a patch over the stored override', () => {
	expect(applyOverridePatch({ maxWorkers: 8, note: 'spike' }, { minWorkers: 2 }))
		.toEqual({ maxWorkers: 8, note: 'spike', minWorkers: 2 });
});

// One field at a time, because pinning every value a form rendered would stop
// the next deployment's environment reaching the pool at all.
test('gives one field back to the environment chain', () => {
	expect(applyOverridePatch({ maxWorkers: 8, minWorkers: 2 }, { maxWorkers: null }))
		.toEqual({ minWorkers: 2 });
});

// A page reading an override of nothing but its own note would show a
// deployment as overridden while every value it runs on comes from its
// environment.
test('drops an override left holding only its note', () => {
	const stamped = { maxWorkers: 8, setBy: 'jean', setFrom: 'admin' };

	expect(applyOverridePatch(stamped, { maxWorkers: 8 }))
		.toEqual(stamped);

	expect(applyOverridePatch(stamped, { maxWorkers: null }))
		.toBeNull();
});

// Where a change came in through is stamped beside who made it, so it has to
// survive the same merge the rest of the stamp does.
test('takes the surface a change came in through', () => {
	expect(parseOverridePatch({ maxWorkers: 8, setFrom: 'mcp' }))
		.toEqual({ maxWorkers: 8, setFrom: 'mcp' });
});

// The stamp is what a page shows an operator about who changed what, so a
// field of it that is not text would be read back as one.
test('refuses a stamp field that is not text', () => {
	expect(() => parseOverridePatch({ setFrom: 7 }))
		.toThrowError(`'setFrom' has to be a string`);
});

test('writes the override, and deletes the key for none', async () => {
	await redisHolding(null);

	await writeAutoscaleOverride({ maxWorkers: 8 });
	expect(set).toHaveBeenCalledWith('scalabus:config:pm2', '{"maxWorkers":8}');

	await writeAutoscaleOverride(null);
	expect(del).toHaveBeenCalledWith('scalabus:config:pm2');
});
