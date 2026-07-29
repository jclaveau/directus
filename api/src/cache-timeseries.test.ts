import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, any> = {
	CACHE_STATS_ENABLED: true,
	CACHE_NAMESPACE: 'scalabus',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./redis/index.js');
vi.mock('./bus/index.js', () => ({ useBus: () => ({}) }));
vi.mock('./logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));

import getDatabase from './database/index.js';
import { redisConfigAvailable } from './redis/index.js';
import {
	readCacheTimeseries,
	recordCacheConfigEvent,
	reapCacheConfigEvents,
} from './cache-events.js';

// Rows the mock builder resolves, keyed by table — so the three queries inside
// readCacheTimeseries (config-events / events / anomalies) each get their own reply.
let rowsByTable: Record<string, any[]>;
let insertSpy: ReturnType<typeof vi.fn>;
let deleteSpy: ReturnType<typeof vi.fn>;

function makeBuilder(table: string) {
	// The latency query hits the same events table but filters on duration_ms;
	// route it to a separate `<table>:latency` reply so it can return percentiles.
	let latencyQuery = false;

	const builder: any = {
		where: () => builder,
		whereIn: () => builder,
		whereNotNull: (column: string) => {
			if (column === 'duration_ms') {
				latencyQuery = true;
			}

			return builder;
		},
		orderBy: () => builder,
		groupByRaw: () => builder,
		select: () => builder,
		insert: (row: unknown) => insertSpy(table, row),
		delete: () => deleteSpy(table),
		then: (resolve: any, reject: any) => {
			const key = latencyQuery
				? `${table}:latency`
				: table;

			return Promise.resolve(rowsByTable[key] ?? []).then(resolve, reject);
		},
	};

	return builder;
}

// Fixed clock so `firstBucket` (derived from now) is deterministic below.
const NOW = 60_000_000 * 1000; // ms; divisible by the 60s bucket → clean epoch grid

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);

	rowsByTable = {};
	insertSpy = vi.fn(() => Promise.resolve([1]));
	deleteSpy = vi.fn(() => Promise.resolve(3));

	const db: any = vi.fn((table: string) => makeBuilder(table));
	db.client = { config: { client: 'pg' } };
	db.raw = (sql: string, bindings?: unknown) => ({ sql, bindings });

	vi.mocked(getDatabase).mockReturnValue(db);
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('readCacheTimeseries', () => {
	it('aligns each DB bucket to its dense slot and merges sources', async () => {
		const windowMs = 180_000; // 3 minutes
		const buckets = 3;
		const bucketSec = 60;

		// Buckets are 0-based elapsed-since-`since`; the `now`-edge bucket (== buckets)
		// folds into the last slot, accumulating onto whatever's already there.
		rowsByTable = {
			directus_cache_events: [
				{ bucket: 0, hits: 5, misses: 1, ttl_ms: 30000 },
				{ bucket: 2, hits: 9, misses: 4, ttl_ms: 60000 },
				{ bucket: 3, hits: 1, misses: 2, ttl_ms: null },
			],
			directus_cache_anomalies: [
				{ bucket: 2, count: 2 },
			],
			directus_cache_config_events: [
				{ time: new Date(NOW - 1000), kind: 'flush', detail: 'response' },
			],
		};

		const result = await readCacheTimeseries(windowMs, buckets);

		expect(result.buckets).toHaveLength(3);

		// bucket 0 → slot 0; gap at slot 1; bucket 2 → slot 2; the out-of-range bucket
		// 3 folds into the last slot too (5+1 hits, 4+2 misses).
		expect(result.buckets[0]).toMatchObject({
			hits: 5, misses: 1, anomalies: 0, ttlMs: 30000,
		});

		expect(result.buckets[1]).toMatchObject({
			hits: 0, misses: 0, anomalies: 0, ttlMs: null,
		});

		expect(result.buckets[2]).toMatchObject({
			hits: 10, misses: 6, anomalies: 2, ttlMs: 60000,
		});

		// The grid is bucket-anchored: newest slot = now's bucket, the rest step back
		// by bucketSec (NOW is divisible by the 60s bucket, so it sits on a boundary).
		expect(result.buckets[2]!.t).toBe(NOW);
		expect(result.buckets[1]!.t).toBe(NOW - bucketSec * 1000);
		expect(result.buckets[0]!.t).toBe(NOW - 2 * bucketSec * 1000);

		expect(result.markers).toEqual([
			{ time: NOW - 1000, kind: 'flush', detail: 'response' },
		]);
	});

	it('maps latency percentiles into buckets, null when unsampled', async () => {
		rowsByTable = {
			'directus_cache_events:latency': [
				{
					bucket: 0,
					hit_p50: 2,
					hit_p95: 5,
					fill_p50: 20,
					fill_p95: 60,
					anomaly_p50: 80,
					anomaly_p95: 200,
					miss_p50: 40,
					miss_p95: 120,
					both_p50: 3,
					both_p95: 100,
				},
			],
		};

		const result = await readCacheTimeseries(180_000, 3);

		expect(result.buckets[0]).toMatchObject({
			hitP50: 2,
			hitP95: 5,
			fillP50: 20,
			fillP95: 60,
			anomalyP50: 80,
			anomalyP95: 200,
			missP50: 40,
			missP95: 120,
			bothP50: 3,
			bothP95: 100,
		});

		expect(result.buckets[1]!.hitP50).toBeNull();
		expect(result.buckets[1]!.bothP95).toBeNull();
	});

	it('anchors the grid so a sub-bucket refresh does not shift it', async () => {
		const first = await readCacheTimeseries(180_000, 3); // bucketSec 60

		// Advance now by less than one bucket — the grid must stay put (no crawl).
		vi.setSystemTime(NOW + 40_000);
		const within = await readCacheTimeseries(180_000, 3);

		expect(within.buckets.map((b) => b.t)).toEqual(first.buckets.map((b) => b.t));

		// Cross the boundary — the grid steps forward by exactly one bucket.
		vi.setSystemTime(NOW + 60_000);
		const crossed = await readCacheTimeseries(180_000, 3);

		expect(crossed.buckets[2]!.t).toBe(NOW + 60_000);
		expect(crossed.buckets[0]!.t).toBe(first.buckets[0]!.t + 60_000);
	});

	it('returns markers but empty curves when stats are not configured', async () => {
		env['CACHE_STATS_ENABLED'] = false;

		rowsByTable = {
			directus_cache_config_events: [
				{ time: new Date(NOW - 5000), kind: 'ttl_change', detail: '45s' },
			],
			// Never queried in this path — present to prove they're skipped.
			directus_cache_events: [{ bucket: 0, hits: 99, misses: 0, ttl_ms: 1 }],
		};

		const result = await readCacheTimeseries(120_000, 4);

		expect(result.markers).toHaveLength(1);
		expect(result.buckets).toHaveLength(4);
		expect(result.buckets.every((b) => b.hits === 0 && b.misses === 0)).toBe(true);

		env['CACHE_STATS_ENABLED'] = true;
	});
});

describe('recordCacheConfigEvent', () => {
	it('inserts a marker row with the kind and detail', async () => {
		await recordCacheConfigEvent('ttl_change', '30s');

		expect(insertSpy).toHaveBeenCalledWith(
			'directus_cache_config_events',
			expect.objectContaining({ kind: 'ttl_change', detail: '30s' }),
		);
	});
});

describe('reapCacheConfigEvents', () => {
	it('deletes rows past the retention cutoff', async () => {
		const deleted = await reapCacheConfigEvents();

		expect(deleteSpy).toHaveBeenCalledWith('directus_cache_config_events');
		expect(deleted).toBe(3);
	});
});
