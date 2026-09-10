import { afterAll, describe, expect, it } from 'vitest';
import {
	poolSize,
	sizesOver,
	startAutoscaler,
	startPool,
	stopRig,
	type Rig,
} from './autoscale/rig';

// The rule that took the planner's Api down on 2026-09-08 could add workers and
// not release them: the module adds on the hottest worker and releases on the
// average, so while one worker sits above the threshold the pool cannot shrink
// at all. A pool that only ever grows reaches its ceiling and stays there, and
// the ceiling is a container.
//
// Every other arm here watches a pool that is under load. This one watches the
// load go away, which is the half of the cycle that failed.
describe('The autoscaler gives back what the load no longer needs', () => {
	const rigs: Rig[] = [];

	afterAll(() => {
		for (const rig of rigs) {
			stopRig(rig);
		}
	});

	it('walks a grown pool back to its floor once the load goes', async () => {
		const rig = startPool({
			appName: 'autoscale-release',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
			// Long enough for the pool to have finished climbing before any of
			// it falls idle: a worker counts its own from the moment it starts,
			// so the ones added during the climb calm later than the first.
			calmAfterMs: 25_000,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '10',
			// Under the scale threshold, which is where the two have to sit or
			// the release one is corrected down to meet it. An idle worker
			// reports below this and a loaded one above the other, so the pool's
			// direction is the load's and nothing else.
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '5',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '2',
			// Long enough that the pool is reporting its load rather than its
			// boot: a worker's CPU percent is cumulative over its short life, so
			// one just out of a two-second warm-up still reads mostly as the
			// second it spent starting — on a loaded runner, near 100%, which
			// clears any threshold an arm like this sets out of reach.
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		expect(await poolSize(rig, 3, 90_000)).toBe(3);
		expect(await poolSize(rig, 1, 150_000)).toBe(1);

		// One is the floor, so a pool that kept releasing would be releasing
		// past what it was told to keep.
		expect(await sizesOver(rig, 10_000)).toEqual([1]);
	}, 300_000);
});
