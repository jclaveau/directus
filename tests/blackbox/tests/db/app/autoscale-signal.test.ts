import vendors from '@common/get-dbs-to-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeSharedSettings,
	poolSize,
	reportOf,
	sizesOver,
	startAutoscaler,
	startPool,
	stopRig,
	storeSharedSettings,
	type Rig,
} from './autoscale/rig';

// `signal` picks the statistic every threshold in the configuration is then
// compared against, so it is the one setting that changes what every other
// setting means. It ships as `average` and the whole suite exercises it there;
// `max` is reachable from the env, from the shared layer and from the admin
// panel, and nothing outside a unit test has ever run a pool on it.
//
// The two can only be told apart by a pool whose workers disagree — across
// workers reporting alike, the average IS the maximum. So both arms run the
// same lopsided pool, one worker spinning and one idle, and change nothing but
// the signal: about 95% on one and about 0% on the other, which averages near
// 48 and maxes near 95. A threshold of 70 sits between them, so it is the
// signal alone that decides whether this pool is over the line.
describe('The autoscaler reads the pool through the signal it is given', () => {
	const rigs: Rig[] = [];

	// The autoscaler reads the shared layer out of the singleton every other
	// suite writes to, so a value one of them left behind would sit over the
	// environment these arms tune. Cleared here rather than trusted, and the
	// connection closed with the rigs.
	beforeAll(async () => {
		await storeSharedSettings(vendors[0]!, 'autoscale_settings', null);
	});

	afterAll(async () => {
		for (const rig of rigs) {
			stopRig(rig);
		}

		await closeSharedSettings();
	});

	const lopsided = {
		instances: 2,
		busyMs: 95,
		idleMs: 5,
		busyOnlyInstance: '1',
	};

	// The threshold the arms share, either side of which the same pool reads
	// differently. The release threshold is 0 so no reading can shed a worker:
	// both claims are about the add branch, and a pool that released one would
	// otherwise answer the size assertion for the wrong reason.
	const band = {
		PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '70',
		PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
		PM2_AUTOSCALE_MIN_WORKERS: '1',
		PM2_AUTOSCALE_MAX_WORKERS: '3',
		// No add cooldown, so whether the pool grows is the signal's doing
		// rather than a pace the window was too short to see.
		PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
		PM2_AUTOSCALE_WARMUP_SECONDS: '5',
	};

	it('holds a lopsided pool whose average is under the threshold', async () => {
		const rig = startPool({ appName: 'autoscale-signal-average', ...lopsided });
		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_SIGNAL: 'average',
			...band,
		});

		// Long enough for the warm-up to pass and the pool to be judged many
		// times over, so a signal reading the busy worker alone has grown well
		// inside it.
		expect(await sizesOver(rig, 45_000), reportOf(rig)).toEqual([2]);
	}, 300_000);

	// The strict witness for the arm above: the same pool, the same threshold,
	// and the only difference is the statistic they are compared through.
	it('grows the same pool when the busiest worker is the signal', async () => {
		const rig = startPool({ appName: 'autoscale-signal-max', ...lopsided });
		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_SIGNAL: 'max',
			...band,
		});

		expect(await poolSize(rig, 3, 90_000), reportOf(rig)).toBe(3);
	}, 300_000);
});
