import { afterAll, describe, expect, it } from 'vitest';
import {
	heldAt,
	poolSize,
	startAutoscaler,
	startPool,
	stopRig,
	type Rig,
} from './autoscale/rig';

// What the pool does is a function of the configuration, so each arm changes
// one setting and reads the pool back. The load is held constant by the
// fixture — a duty cycle the daemon reports as a steady percentage — which is
// what lets a threshold above it and a threshold below it be compared at all.
//
// No vendor loop: nothing here touches a database, and every arm costs a pm2
// daemon plus the workers it spawns.
describe('The autoscaler ramps a pool according to its configuration', () => {
	const rigs: Rig[] = [];

	afterAll(() => {
		for (const rig of rigs) {
			stopRig(rig);
		}
	});

	it('grows to the ceiling while the load clears the threshold', async () => {
		const rig = startPool({
			appName: 'autoscale-ramp-up',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '5',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
		});

		expect(await poolSize(rig, 3, 60_000)).toBe(3);

		// And stops there: the ceiling is a ceiling, not a pace.
		expect(await heldAt(rig, 3, 5_000)).toBe(true);
	}, 90_000);

	it('holds at the floor when that load is under the threshold', async () => {
		const rig = startPool({
			appName: 'autoscale-ramp-held',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
			// Zero, so holding is the threshold's doing and not a cooldown
			// that has not run out yet.
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
		});

		expect(await heldAt(rig, 1, 20_000)).toBe(true);
	}, 90_000);

	// The first version of this scaled an app it could not see back up to the
	// floor, pm2 answered `App not found`, and the rejection ended the process.
	// An autoscaler that dies leaves the pool frozen at whatever size the
	// failure caught it in.
	it('survives an app the supervisor does not have', async () => {
		const rig = startPool({ appName: 'autoscale-present', instances: 1 });
		rigs.push(rig);

		startAutoscaler(rig, {
			PM2_AUTOSCALE_APP_NAME: 'autoscale-absent',
			PM2_AUTOSCALE_MIN_WORKERS: '2',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
		});

		expect(await heldAt(rig, 1, 15_000)).toBe(true);
		expect(rig.autoscaler?.exitCode).toBe(null);
	}, 90_000);

	it('prewarms above the floor, then releases back to it', async () => {
		const rig = startPool({ appName: 'autoscale-prewarm', instances: 1 });
		rigs.push(rig);

		startAutoscaler(rig, {
			PM2_AUTOSCALE_PREWARM: '3',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '50',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '5',
		});

		expect(await poolSize(rig, 3, 60_000)).toBe(3);

		// Prewarm is not the floor: an idle pool gives the workers back.
		expect(await poolSize(rig, 1, 60_000)).toBe(1);
	}, 120_000);
});
