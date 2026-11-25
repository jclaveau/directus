import { afterEach, expect, test, vi } from 'vitest';

const env = vi.hoisted<Record<string, unknown>>(() => {
	return { SYNCHRONIZATION_STORE: 'redis' };
});

vi.mock('ioredis');
vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('./utils/get-config-from-env.js', () => {
	return { getConfigFromEnv: vi.fn(() => ({ host: 'redis-host' })) };
});

vi.mock('./redis/lib/warn-once-per-connection-outage.js', () => {
	return { warnOncePerConnectionOutage: vi.fn() };
});

// Each test imports a fresh module: the manager is a module-level singleton.
afterEach(() => {
	vi.resetModules();
});

test('connects with the REDIS_* config when REDIS is unset', async () => {
	const { Redis } = await import('ioredis');
	const { SynchronizedClock } = await import('./synchronization.js');

	new SynchronizedClock('reset');

	expect(Redis).toHaveBeenCalledWith({ host: 'redis-host' });
});

test('connects with the REDIS url when REDIS is set', async () => {
	env['REDIS'] = 'redis://redis-url:6379';

	const { Redis } = await import('ioredis');
	const { SynchronizedClock } = await import('./synchronization.js');

	new SynchronizedClock('reset');

	expect(Redis).toHaveBeenCalledWith('redis://redis-url:6379');
});
