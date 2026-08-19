import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from 'prom-client';

const env: Record<string, any> = {
	METRICS_SERVICES: ['cache'],
	CACHE_ENABLED: true,
	CACHE_STORE: 'redis',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../../logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));
vi.mock('../../cache.js', () => ({ getCache: () => ({ cache: null }) }));
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
