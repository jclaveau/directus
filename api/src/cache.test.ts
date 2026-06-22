import { beforeEach, describe, expect, test, vi } from 'vitest';

// cache.ts captures `const env = useEnv()` at module load, so mutate one shared object
// (never reassign) to keep that reference and getConfigFromEnv's useEnv() in sync.
const mockEnv = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv.current }));
vi.mock('./logger/index.js', () => ({ useLogger: () => ({ warn() {}, error() {}, info() {} }) }));
vi.mock('./bus/index.js', () => ({ useBus: () => ({}) }));

const { getRedisConnection } = await import('./cache.js');

function setEnv(values: Record<string, unknown>) {
	for (const key of Object.keys(mockEnv.current)) delete mockEnv.current[key];
	Object.assign(mockEnv.current, values);
}

describe('getRedisConnection', () => {
	beforeEach(() => setEnv({}));

	test('passes a REDIS connection URL through unchanged (@keyv/redis v5 accepts URLs)', () => {
		setEnv({ REDIS: 'redis://localhost:6379/2' });
		expect(getRedisConnection()).toBe('redis://localhost:6379/2');
	});

	test('translates ioredis-shaped REDIS_HOST/REDIS_PORT to node-redis socket options', () => {
		setEnv({ REDIS_HOST: 'localhost', REDIS_PORT: '6108' });
		expect(getRedisConnection()).toEqual({ socket: { host: 'localhost', port: 6108 } });
	});

	test('maps username/password/db and a TLS flag', () => {
		setEnv({
			REDIS_HOST: 'h',
			REDIS_PORT: '6379',
			REDIS_USERNAME: 'u',
			REDIS_PASSWORD: 'p',
			REDIS_DB: '3',
			REDIS_TLS: true,
		});

		expect(getRedisConnection()).toEqual({
			socket: { host: 'h', port: 6379, tls: true },
			username: 'u',
			password: 'p',
			database: 3,
		});
	});
});
