import { describe, expect, test } from 'vitest';
import type { AutoscaleConfig, PoolSample } from '../types.js';
import { decide } from './decide.js';

const config: AutoscaleConfig = {
	enabled: true,
	strategy: 'legacy',
	appName: 'api',
	signal: 'average',
	sampleWindow: 5,
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

// A floor and a ceiling that meet leave no branch that returns a size: growth
// wants room under the ceiling and release wants room above the floor, and a
// pool between two equal bounds has neither. What the pool reports stops
// mattering — which is how the blackbox arms about configuration sources hold
// a pool still without also asserting that a supervisor's CPU accounting
// behaves, and what a `minWorkers = maxWorkers` pin promises an operator
// reaching for it mid-incident.
test('a pool pinned between equal bounds ignores what it reports', () => {
	const pinned = {
		...config,
		strategy: 'scalabus' as const,
		minWorkers: 1,
		maxWorkers: 1,
	};

	for (const cpuPercent of [0, 20, 60, 95, 100]) {
		expect(decide(sample([cpuPercent]), pinned)).toEqual({
			workers: null,
			reason: `average cpu ${cpuPercent}% is within the band`,
		});
	}
});

// A pool that has run for hours without moving has a release cooldown that
// reads as satisfied whatever happens next, so the add that just landed is the
// only thing standing between the pool and losing the worker it just gained.
// The worker also arrives at 0%, dragging the average it will be judged on
// under the release threshold, so the sample argues for its own undoing.
test('the scalabus strategy holds a release that would undo a recent add', () => {
	const scalabus = { ...config, strategy: 'scalabus' as const };

	const justGrown = sample([20, 0], {
		lastScaleUpAt: NOW - 30_000,
		lastScaleDownAt: NOW - 6_000_000,
	});

	expect(decide(justGrown, scalabus)).toEqual({
		workers: null,
		reason: '20% calls for a release, 270s of cooldown left',
	});
});

// The counterpart, so the gate above is a delay and not a stop: once the add
// is as old as the cooldown the pool sheds the worker it stopped needing.
test('the scalabus strategy releases once the add is past the cooldown', () => {
	const scalabus = { ...config, strategy: 'scalabus' as const };

	const settled = sample([20, 0], {
		lastScaleUpAt: NOW - 400_000,
		lastScaleDownAt: NOW - 6_000_000,
	});

	expect(decide(settled, scalabus)).toEqual({
		workers: 1,
		reason: 'cpu 20% across all but one worker < 40%; '
			+ '1 would sit mid-band, releasing 1',
	});
});

// A release of one worker a cooldown drains a pool in `workers - floor`
// cooldowns: 31 five-minute ones from the planner's ceiling of 32, holding
// 9 GB most of the way. The release reads how many workers the load would
// keep mid-band and goes half the way there, so the drain is geometric — and
// a straight jump to the size the reading extrapolates would overshoot,
// because a worker's reading is not all load.
describe('the scalabus strategy releases toward the size the load keeps', () => {
	const scalabus = {
		...config,
		strategy: 'scalabus' as const,
		maxWorkers: 32,
	};

	const settled = { lastScaleUpAt: NOW - 400_000 };

	test('half the way to the floor from an idle pool', () => {
		expect(decide(sample(Array(32).fill(0), settled), scalabus)).toEqual({
			workers: 16,
			reason: 'cpu 0% across all but one worker < 40%; '
				+ '1 would sit mid-band, releasing 16',
		});
	});

	// Twelve workers at 25% carry 300 points, which six carry at 50%, the
	// middle of a 40-60 band. Aimed at the release edge instead, eight would
	// carry them at under 40 and the step is two; aimed at the scale edge,
	// five would at 60 and the step is four. Half the way to six is three.
	test('half the way to the size that would sit mid-band', () => {
		expect(decide(sample(Array(12).fill(25), settled), scalabus)).toEqual({
			workers: 9,
			reason: 'cpu 27% across all but one worker < 40%; '
				+ '6 would sit mid-band, releasing 3',
		});
	});

	// Three workers at 20% are 60 points, which two would carry at 30%. Half
	// the way from three to two is half a worker, and a pool that rounded
	// that down would sit one over its size for good. At two a release would
	// leave the one survivor at 40%, which is not under 40: held.
	test('rounds a half step up, so a pool one over its size still moves', () => {
		expect(decide(sample([20, 20, 20], settled), scalabus)).toEqual({
			workers: 2,
			reason: 'cpu 30% across all but one worker < 40%; '
				+ '2 would sit mid-band, releasing 1',
		});

		expect(decide(sample([20, 20], settled), scalabus)).toEqual({
			workers: null,
			reason: 'average cpu 20% is within the band',
		});
	});

	// The floor is where the extrapolation stops, not where the release does:
	// a pool eight over a floor of four releases four, never more.
	test('never past the floor', () => {
		const floored = { ...scalabus, minWorkers: 4 };

		expect(decide(sample(Array(12).fill(0), settled), floored)).toEqual({
			workers: 8,
			reason: 'cpu 0% across all but one worker < 40%; '
				+ '4 would sit mid-band, releasing 4',
		});
	});

	// A pool above a lowered ceiling is corrected in one step before the load
	// is read at all, so the two paths cannot both fire on one tick.
	test('is not reached by a pool above its ceiling', () => {
		const capped = { ...scalabus, maxWorkers: 6 };

		expect(decide(sample(Array(8).fill(0), settled), capped)).toEqual({
			workers: 6,
			reason: 'above the ceiling of 6',
		});
	});
});

// A worker reports 0% both when the pool has capacity to spare and when nothing
// has been routed to it, and keep-alive makes the second common: node cluster
// round-robins new connections, so clients stay on the workers they already
// hold sockets to and a fresh one can idle beside a busy pool. Averaged across
// every worker that reads as spare capacity; measured against the workers a
// release would leave it reads as what it is.
test('the scalabus strategy holds a release the survivors could not absorb', () => {
	const scalabus = { ...config, strategy: 'scalabus' as const };

	const lopsided = sample([70, 0], { lastScaleUpAt: NOW - 400_000 });

	expect(decide(lopsided, scalabus)).toEqual({
		workers: null,
		reason: 'average cpu 35% is within the band',
	});
});

// The warming worker is in the pool's size and not in its statistic, so the
// divisor a release projects over would not match the workers it is judging.
test('the scalabus strategy holds a release while a worker warms up', () => {
	const scalabus = { ...config, strategy: 'scalabus' as const };

	const warming = sample([20, 0], {
		warmingWorkers: 1,
		lastScaleUpAt: NOW - 400_000,
	});

	expect(decide(warming, scalabus)).toEqual({
		workers: null,
		reason: '1 worker(s) still warming up',
	});
});
