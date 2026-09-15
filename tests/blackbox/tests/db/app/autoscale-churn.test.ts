import vendors from '@common/get-dbs-to-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeSharedSettings,
	reportOf,
	sizesOver,
	startAutoscaler,
	startPool,
	stopRig,
	storeSharedSettings,
	waitForRestart,
	type Rig,
} from './autoscale/rig';

// A pool that is restarting is broken, not busy, and a restart reads as load
// on the way up and as idleness on the way down: a worker that has just died
// reports nothing at all. The add branch is already pinned against the first
// half, by an arm watching a crash-looping pool refuse to grow.
//
// This is the other half, and it needs a pool with nowhere to grow — at the
// ceiling, the add branch cannot move the size whatever it decides, so an arm
// starting below the ceiling proves nothing about what follows it. What is
// left to get wrong there is the release: a churning pool that reads idle
// enough to shed a worker would be taken apart one worker at a time, exactly
// while it is least able to serve. The warm-up freeze is what holds it, and a
// pool whose workers keep dying keeps re-arming that freeze.
describe('The autoscaler does not take apart a pool that is churning', () => {
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

	it('holds a churning pool at the ceiling instead of releasing it', async () => {
		// Only instance 0 crashes, so instance 1 stays up long enough to be
		// past its warm-up and report a real CPU. A pool reporting nothing at
		// all is held by the sample being empty, which is not the freeze this
		// arm is about.
		const rig = startPool({
			appName: 'autoscale-churn-ceiling',
			instances: 2,
			crashAfterMs: 3_000,
			crashOnlyInstance: '0',
		});

		rigs.push(rig);

		// Started beside a pool that has not crashed yet, the autoscaler sees
		// a calm idle pool — correctly — and releases a worker before the
		// first crash lands.
		expect(await waitForRestart(rig, 30_000)).toBe(true);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			// The pool is at the ceiling, which is what leaves the release the
			// only branch that can move it.
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			// Idle workers under a threshold this high read as releasable on
			// every tick, so nothing but the freeze is holding the pool.
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '90',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '0',
			// Longer than the crash interval, so each restart re-arms the
			// freeze before the last one lapses.
			PM2_AUTOSCALE_WARMUP_SECONDS: '5',
		});

		// `sizesOver` rather than a floor assertion: a released pool reaches 1
		// and stays, and a pool between a crash and its replacement dips
		// through 1 on its way back to 2 — only the order they are first seen
		// in tells those apart.
		expect(await sizesOver(rig, 30_000), reportOf(rig)).toEqual([2]);
	}, 300_000);
});
