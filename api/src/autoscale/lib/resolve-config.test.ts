import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AutoscaleConfig } from '../types.js';

vi.mock('@directus/env');
vi.mock('../../redis/index.js');

vi.mock('../../logger/index.js', () => {
	return {
		useLogger: () => {
			return { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
		},
	};
});

const get = vi.fn();

/** Stands in for the shared ioredis client, whose `status` gates the read. */
const client = { get, status: 'ready' };

/**
 * `resolveConfig` remembers the last configuration it managed to read, which
 * is the point of it — so each case needs its own instance of the module
 * rather than the one the case before it left behind.
 */
async function freshResolver(): Promise<() => Promise<AutoscaleConfig>> {
	vi.resetModules();

	const { useEnv } = await import('@directus/env');
	const { redisConfigAvailable, useRedis } = await import('../../redis/index.js');

	vi.mocked(useEnv).mockReturnValue({
		CACHE_NAMESPACE: 'scalabus',
		PM2_AUTOSCALE_MAX_WORKERS: 4,
	});

	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue(client as never);

	const { resolveConfig } = await import('./resolve-config.js');

	return resolveConfig;
}

beforeEach(() => {
	get.mockReset();
	client.status = 'ready';
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('reads the override laid over the env chain', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue(JSON.stringify({ maxWorkers: 8 }));

	await expect(resolveConfig()).resolves.toMatchObject({ maxWorkers: 8 });
});

// The rollback path: reverting to the rule production already ran is a write
// to one key, which is the whole reason the strategy is a configuration field
// rather than a build.
test('switches strategy from the override', async () => {
	const resolveConfig = await freshResolver();

	await expect(resolveConfig()).resolves.toMatchObject({
		strategy: 'scalabus',
	});

	get.mockResolvedValue(JSON.stringify({ strategy: 'legacy' }));

	await expect(resolveConfig()).resolves.toMatchObject({ strategy: 'legacy' });
});

// Reverting to the env chain sounds like the safe answer and is not. An
// operator who has just raised the ceiling to survive a spike would have it
// dropped back by a blip, and the ceiling is corrected with no cooldown — the
// pool loses the workers at once and takes them back when Redis returns.
test('holds the last configuration when Redis stops answering', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue(JSON.stringify({ maxWorkers: 8 }));
	await resolveConfig();

	get.mockRejectedValue(new Error('Connection is closed.'));

	await expect(resolveConfig()).resolves.toMatchObject({ maxWorkers: 8 });
});

test('falls back to the env chain when Redis never answered', async () => {
	const resolveConfig = await freshResolver();
	get.mockRejectedValue(new Error('Connection is closed.'));

	await expect(resolveConfig()).resolves.toMatchObject({ maxWorkers: 4 });
});

test('takes the env chain back once the override is deleted', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue(JSON.stringify({ maxWorkers: 8 }));
	await resolveConfig();

	get.mockResolvedValue(null);

	await expect(resolveConfig()).resolves.toMatchObject({ maxWorkers: 4 });
});

// The override is a hand-edited JSON document, so it is exactly where a typed
// zero too many arrives.
test('an override past what is supported is clamped, not obeyed', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue(JSON.stringify({ minWorkers: 10_000 }));

	await expect(resolveConfig()).resolves.toMatchObject({
		minWorkers: 4,
		maxWorkers: 4,
	});
});

test('an unparseable override leaves the env chain in force', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue('{ not json');

	await expect(resolveConfig()).resolves.toMatchObject({ maxWorkers: 4 });
});

test('an override cannot reach through to the prototype', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue('{"__proto__":{"polluted":true}}');

	await resolveConfig();

	expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
});

// ioredis queues a command issued while it is not connected and puts no
// deadline on that queue, so a tick that only awaited the read would hold the
// loop for the whole outage — freezing the pool at the size the outage caught
// it at, which is the one thing the loop must never do.
test('gives up on a read the client never answers', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue(JSON.stringify({ maxWorkers: 8 }));
	await resolveConfig();

	get.mockReturnValue(new Promise(() => {}));

	await expect(resolveConfig()).resolves.toMatchObject({ maxWorkers: 8 });
});

test('does not read through a client that is reconnecting', async () => {
	const resolveConfig = await freshResolver();
	get.mockResolvedValue(JSON.stringify({ maxWorkers: 8 }));
	await resolveConfig();

	client.status = 'reconnecting';

	await expect(resolveConfig()).resolves.toMatchObject({ maxWorkers: 8 });
	expect(get).toHaveBeenCalledTimes(1);
});
