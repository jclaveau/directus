import { useEnv } from '@directus/env';
import { Redis } from 'ioredis';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useLogger } from '../../logger/index.js';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { createRedis } from './create-redis.js';

vi.mock('ioredis');
vi.mock('../../utils/get-config-from-env.js');
vi.mock('@directus/env');
vi.mock('../../logger/index.js');

type RetryStrategy = (attempt: number) => number | null;

let mockRedis: Redis;

beforeEach(() => {
	mockRedis = new Redis();
	vi.mocked(Redis).mockReturnValue(mockRedis);
});

afterEach(() => {
	vi.clearAllMocks();
});

// Grab the retryStrategy the constructor was built with for a given env. URL mode passes
// it as the second argument; discrete-config mode folds it into the single options object.
function retryStrategyFor(env: Record<string, unknown>): RetryStrategy {
	vi.mocked(useEnv).mockReturnValue(env);
	createRedis();

	const [first, second] = vi.mocked(Redis).mock.calls.at(-1)!;

	const options = env['REDIS']
		? second
		: first;

	return (options as { retryStrategy: RetryStrategy }).retryStrategy;
}

describe('createRedis', () => {
	test(oneLine`
		Registers an error listener, so an unreachable Redis degrades instead of
		taking the process down
	`, () => {
		const warn = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ warn } as any);
		vi.mocked(useEnv).mockReturnValue({ REDIS: 'x' });

		const redis = createRedis();

		// An EventEmitter with no `error` listener rethrows, and ioredis emits one
		// per failed reconnect — so without this a Redis outage is an unhandled
		// exception rather than a degraded cache.
		expect(redis.on).toHaveBeenCalledWith('error', expect.any(Function));

		const [, listener] = vi.mocked(redis.on).mock.calls
			.find(([event]) => event === 'error')!;

		expect(() => (listener as (error: Error) => void)(new Error('ECONNREFUSED')))
			.not.toThrow();

		expect(warn).toHaveBeenCalledOnce();
	});

	test('Creates and returns new Redis instance from connection string', () => {
		const connectionString = 'test-connection-string';
		vi.mocked(useEnv).mockReturnValue({ REDIS: connectionString });

		const redis = createRedis();

		// The URL still drives the connection; the retry policy now rides alongside it
		// (the URL form used to drop every ioredis option).
		expect(Redis).toHaveBeenCalledWith(connectionString, {
			retryStrategy: expect.any(Function),
		});

		expect(redis).toBe(mockRedis);
	});

	test('Uses Redis connection object if Redis connection string is missing', () => {
		const redisHost = 'test-host';
		vi.mocked(useEnv).mockReturnValue({ REDIS_HOST: redisHost });

		const mockConfig = { host: redisHost };
		vi.mocked(getConfigFromEnv).mockReturnValue(mockConfig);

		const redis = createRedis();

		expect(getConfigFromEnv).toHaveBeenCalledWith('REDIS');

		expect(Redis).toHaveBeenCalledWith({
			host: redisHost,
			retryStrategy: expect.any(Function),
		});

		expect(redis).toBe(mockRedis);
	});

	describe('retryStrategy', () => {
		test('Defaults to ioredis backoff, capped, never null', () => {
			const retry = retryStrategyFor({ REDIS: 'x' });

			expect(retry(1)).toBe(50);
			expect(retry(10)).toBe(500);
			expect(retry(1000)).toBe(2000); // capped
			expect(retry(1e9)).toBe(2000); // still a number => keeps retrying
		});

		test('Honours base + max delay knobs', () => {
			const retry = retryStrategyFor({
				REDIS: 'x',
				REDIS_RETRY_BASE_DELAY: 100,
				REDIS_RETRY_MAX_DELAY: 900_000,
			});

			expect(retry(1)).toBe(100);
			expect(retry(50)).toBe(5000);
			expect(retry(1e6)).toBe(900_000); // capped at the widened window
		});

		test('Gives up (null) past max attempts', () => {
			const retry = retryStrategyFor({ REDIS: 'x', REDIS_RETRY_MAX_ATTEMPTS: 3 });

			expect(retry(3)).toBe(150); // last allowed attempt still backs off
			expect(retry(4)).toBeNull();
		});

		test('Falls back to defaults on malformed knobs', () => {
			const retry = retryStrategyFor({
				REDIS: 'x',
				REDIS_RETRY_BASE_DELAY: 'nope',
				REDIS_RETRY_MAX_ATTEMPTS: -1,
			});

			expect(retry(1)).toBe(50); // unparseable base => default 50
			expect(retry(1e9)).toBe(2000); // negative attempts rejected => never null
		});
	});
});
