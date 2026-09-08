import { describe, expect, test } from 'vitest';
import type { AutoscaleConfig, PoolSample } from '../types.js';
import { decide } from './decide.js';

const config: AutoscaleConfig = {
	enabled: true,
	strategy: 'legacy',
	appName: 'api',
	signal: 'average',
	scaleCpuThreshold: 60,
	releaseCpuThreshold: 40,
	minWorkers: 1,
	maxWorkers: 4,
	prewarmWorkers: 0,
	minSecondsToScaleUp: 10,
	minSecondsToScaleDown: 300,
	warmupSeconds: 30,
};

const NOW = 1_700_000_000_000;

/** A pool of `cpuPercents.length` workers, idle in every other respect. */
function sample(cpuPercents: number[], overrides: Partial<PoolSample> = {}) {
	return {
		cpuPercents,
		pendingWorkers: 0,
		warmingWorkers: 0,
		secondsSinceRestart: null,
		now: NOW,
		lastScaleUpAt: NOW - 60_000,
		lastScaleDownAt: NOW - 600_000,
		legacyWorkers: cpuPercents.map((cpuPercent) => {
			return { cpuPercent, memoryMegabytes: 200 };
		}),
		freeMemoryMegabytes: 4096,
		...overrides,
	} satisfies PoolSample;
}

describe('the legacy strategy', () => {
	// The rule grows on the hottest worker and shrinks on the average, so a
	// pool with one busy worker beside two idle ones is simultaneously over
	// the growth threshold and under the release one. Growth wins.
	test('grows on the hottest worker while the average stays cold', () => {
		expect(decide(sample([90, 0, 0]), config)).toEqual({
			workers: 4,
			reason: 'max cpu 90% >= 60%',
		});
	});

	test('counts a worker the supervisor is still launching', () => {
		expect(decide(sample([90], { pendingWorkers: 1 }), config)).toEqual({
			workers: 3,
			reason: 'max cpu 90% >= 60%',
		});
	});

	// The cooldown is a strict `>` over whole rounded seconds, so a wait of
	// exactly the configured length is one second short.
	test('holds for a wait of exactly the settling time', () => {
		expect(decide(sample([90], { lastScaleUpAt: NOW - 10_000 }), config))
			.toEqual({
				workers: null,
				reason: 'max cpu 90% needs a worker, 0s of settling left',
			});
	});

	// The release test sits in the `else` of the growth test, so a pool the
	// growth test has parked on a cooldown does not fall through and shrink
	// on the very reading that asked for another worker.
	test('does not release a pool that is waiting to grow', () => {
		const waiting = sample([90, 0, 0, 0], { lastScaleUpAt: NOW });

		expect(decide(waiting, { ...config, maxWorkers: 5 })).toEqual({
			workers: null,
			reason: 'max cpu 90% needs a worker, 10s of settling left',
		});
	});

	test('holds when the free memory will not hold another worker', () => {
		expect(decide(sample([90], { freeMemoryMegabytes: 150 }), config)).toEqual({
			workers: null,
			reason: '150MB free will not hold another 200MB worker',
		});
	});

	test('releases on the average once the cooldown has passed', () => {
		expect(decide(sample([10, 10]), config)).toEqual({
			workers: 1,
			reason: 'average cpu 10% < 40%',
		});
	});

	// The release test sits in the `else` of the growth test, so a pool with
	// room to grow cannot shrink on the same tick — and one without room can,
	// on the very reading that asked for another worker.
	test('releases at its ceiling even with a worker over the threshold', () => {
		expect(decide(sample([90, 0, 0, 0]), { ...config, maxWorkers: 4 })).toEqual({
			workers: 3,
			reason: 'average cpu 23% < 40%',
		});
	});

	test('holds a pool at its floor', () => {
		expect(decide(sample([10]), config)).toEqual({
			workers: null,
			reason: 'max cpu 10%, average 10%, is within the band',
		});
	});

	test('holds a pool the supervisor has nothing of', () => {
		expect(decide(sample([]), config)).toEqual({
			workers: null,
			reason: 'no workers of that app',
		});
	});

	test('holds while autoscaling is disabled', () => {
		expect(decide(sample([90]), { ...config, enabled: false })).toEqual({
			workers: null,
			reason: 'autoscaling is disabled',
		});
	});
});

// The strict witness that the two strategies are different rules and that the
// switch reaches the decision: one sample, one difference in the
// configuration, opposite answers. A pool whose workers keep restarting is
// broken rather than busy, which is what took the planner's Api from one
// worker to thirty-two on 2026-09-08 — and the rule that did it is reproduced
// here on purpose, because reverting to it has to be an option.
test('the strategies answer a churning pool differently', () => {
	const churning = sample([90], { secondsSinceRestart: 2 });

	expect(decide(churning, { ...config, strategy: 'scalabus' })).toEqual({
		workers: null,
		reason: 'a worker restarted 2s ago',
	});

	expect(decide(churning, config)).toEqual({
		workers: 2,
		reason: 'max cpu 90% >= 60%',
	});
});
