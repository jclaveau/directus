import { oneLine } from '@directus/utils';
import type Keyv from 'keyv';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from 'prom-client';

const env: Record<string, any> = {
	METRICS_SERVICES: ['cache'],
	CACHE_ENABLED: true,
	CACHE_STORE: 'redis',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../../logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));
// Overridable per test: the cache-error probe only means anything against a store
// that can fail the way a real one does.
const responseCache = vi.hoisted(() => ({ current: null as Keyv | null }));

vi.mock('../../cache.js', () => {
	return { getCache: () => ({ cache: responseCache.current }) };
});
vi.mock('../../database/index.js', () => ({ hasDatabaseConnection: vi.fn() }));
vi.mock('../../storage/index.js', () => ({ getStorage: vi.fn() }));

vi.mock('../../redis/index.js', () => {
	return { redisConfigAvailable: () => true, useRedis: () => ({}) };
});

// pm2 is imported + `.bind`ed at module top; stub both used methods so it loads.
vi.mock('pm2', () => {
	return {
		default: {
			list: (cb: (e: null, l: unknown[]) => void) => cb(null, []),
			sendDataToProcessId: (
				_id: number,
				_p: object,
				cb: (e: null) => void,
			) => cb(null),
		},
	};
});

import { createMetrics } from './create-metrics.js';

beforeEach(() => {
	register.clear();
	responseCache.current = null;
	env['METRICS_SERVICES'] = ['cache'];
	env['CACHE_ENABLED'] = true;
});

afterEach(() => {
	register.clear();
	vi.clearAllMocks();
});

describe('getCacheResponseMetric', () => {
	it('registers a labeled counter and reuses it on the second call', async () => {
		const metrics = createMetrics();

		const first = metrics.getCacheResponseMetric();
		expect(first).not.toBeNull();

		first!.inc({ result: 'hit' });
		first!.inc({ result: 'miss' });

		// Second call resolves the already-registered metric (no duplicate throw).
		expect(metrics.getCacheResponseMetric()).toBe(first);

		const json = await register.getMetricsAsJSON();
		const entry = json.find((m) => m.name === 'directus_cache_response_total');
		expect(entry).toBeDefined();
	});

	it('returns null when cache is not a tracked service', () => {
		env['METRICS_SERVICES'] = ['database'];
		expect(createMetrics().getCacheResponseMetric()).toBeNull();
	});

	it('returns null when the cache is disabled', () => {
		env['CACHE_ENABLED'] = false;
		expect(createMetrics().getCacheResponseMetric()).toBeNull();
	});
});

describe('getUnhandledRejectionMetric', () => {
	it('registers a counter and reuses it on the second call', async () => {
		const metrics = createMetrics();

		const first = metrics.getUnhandledRejectionMetric();
		expect(first).not.toBeNull();

		first!.inc();

		expect(metrics.getUnhandledRejectionMetric()).toBe(first);

		expect((await register.getMetricsAsJSON())
			.find((metric) => metric.name === 'directus_unhandled_rejections_total'))
			.toBeDefined();
	});

	it(oneLine`
		is reported whatever METRICS_SERVICES names — a rejection nothing awaited is
		process health, and there is no service to attribute it to
	`, () => {
		env['METRICS_SERVICES'] = [];
		env['CACHE_ENABLED'] = false;

		expect(createMetrics().getUnhandledRejectionMetric()).not.toBeNull();
	});
});

describe('getCacheErrorMetric', () => {
	it(oneLine`
		counts a cache write the store refused, even though the store reports it by
		emitting rather than throwing — @keyv/redis resolves a failed command, so a
		try/catch around the probe never sees the outage the probe exists to report
	`, async () => {
		const refusing = new EventEmitter() as EventEmitter & Partial<Keyv>;

		// As `getCache()` does for every store it hands out. Without a listener the
		// emit would throw, the probe's own catch would see it, and the test would pass
		// against a shape production never has.
		refusing.on('error', () => {});

		refusing.set = async () => {
			refusing.emit('error', new Error('ECONNREFUSED'));
			return true;
		};

		refusing.delete = async () => true;

		responseCache.current = refusing as unknown as Keyv;

		await createMetrics().generate();

		const entry = (await register.getMetricsAsJSON())
			.find((metric) => metric.name === 'directus_cache_redis_connection_errors');

		expect(entry?.values[0]?.value).toBe(1);
	});

	it('leaves the counter alone when the probe round-trips', async () => {
		const working = new EventEmitter() as EventEmitter & Partial<Keyv>;

		working.set = async () => true;
		working.delete = async () => true;

		responseCache.current = working as unknown as Keyv;

		await createMetrics().generate();

		const entry = (await register.getMetricsAsJSON())
			.find((metric) => metric.name === 'directus_cache_redis_connection_errors');

		expect(entry?.values[0]?.value).toBe(0);
	});
});
