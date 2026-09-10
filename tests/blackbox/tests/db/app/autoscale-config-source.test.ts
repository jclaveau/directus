import vendors from '@common/get-dbs-to-test';
import { afterAll, describe, expect, it } from 'vitest';
import {
	closeSharedSettings,
	databaseEnv,
	decisionsOf,
	neverExceeded,
	poolSize,
	restartsOf,
	sizesOver,
	startAutoscaler,
	startPool,
	stopRig,
	storeSharedSettings,
	type Rig,
} from './autoscale/rig';

// Tuning an autoscaler by redeploying restarts the pool being tuned, so the
// values have to be changeable while it runs. What that costs is a second
// place a value can come from, and these arms pin which one wins: the env
// chain while the settings hold nothing, the stored layer the moment it is
// written, and the env chain again once it is cleared.
//
// One vendor, because the claim is about which layer the loop takes a field
// from and every vendor answers that the same way — while each rig it needs to
// tell costs a pm2 daemon and a pool under load.
const vendor = vendors[0]!;

describe('The autoscaler takes live configuration from the settings', () => {
	const rigs: Rig[] = [];

	afterAll(async () => {
		for (const rig of rigs) {
			stopRig(rig);
		}

		await storeSharedSettings(vendor, 'autoscale_settings', null);
		await closeSharedSettings();
	});

	// A change is announced on the bus, and a bus message is delivered at most
	// once: a node that was restarting, or one on a deployment with no Redis at
	// all, is a node the announcement never reached. The floor is what makes
	// that staleness heal instead of waiting for the next deploy — so this arm
	// stores the layer and deliberately announces nothing.
	it('reaches a node the announcement never got to', async () => {
		await storeSharedSettings(
			vendor,
			'autoscale_settings',
			// Bounds rather than a threshold, so reading the layer is the only
			// thing that can move the pool: applied it pins three workers on the
			// tick that reads it, whatever the pool reports.
			{ minWorkers: 3, maxWorkers: 3 },
			false,
		);

		const rig = startPool({
			appName: 'autoscale-floor-only',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			...databaseEnv(vendor),
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '1',
		});

		expect(await poolSize(rig, 3, 90_000)).toBe(3);
	}, 150_000);

	describe('with the bus carrying the change', () => {
		let rig: Rig;

		it('uses the env chain while the settings hold nothing', async () => {
			await storeSharedSettings(vendor, 'autoscale_settings', null);

			rig = startPool({
				appName: 'autoscale-live',
				instances: 1,
				busyMs: 20,
				idleMs: 80,
			});

			rigs.push(rig);

			startAutoscaler(rig, {
				...databaseEnv(vendor),
				REDIS_ENABLED: 'true',
				REDIS_HOST: 'localhost',
				REDIS_PORT: '6108',
				PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
				PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
				PM2_AUTOSCALE_MIN_WORKERS: '1',
				// A floor and a ceiling that meet, so the arms here that assert a
				// hold are held by the bounds rather than by a threshold nothing
				// is supposed to reach. The supervisor reports a worker's CPU as
				// a delta since whichever client last asked, and this suite polls
				// it four times a second beside an autoscaler polling once: land
				// those 10-20ms apart and a worker spinning 20ms in every 100ms
				// is reported at 100%, for as long as the two stay in phase. The
				// arms below raise the ceiling in the layer that needs room.
				PM2_AUTOSCALE_MAX_WORKERS: '1',
				PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
				// Long enough that the arms below deciding on load read the load
				// rather than a boot: a worker's first CPU percent covers its
				// whole life so far, which on a loaded runner is mostly the
				// second it spent starting.
				PM2_AUTOSCALE_WARMUP_SECONDS: '8',
			});

			// Everything a size this arm did not expect could have come from:
			// the decision that took it, and the restarts that would explain a
			// size the autoscaler never asked for.
			expect({
				sizes: await sizesOver(rig, 20_000),
				decisions: decisionsOf(rig),
				restarts: restartsOf(rig),
			}).toEqual({ sizes: [1], decisions: [], restarts: 0 });
		}, 90_000);

		it('picks up a stored threshold without being restarted', async () => {
			// The ceiling comes with it because the env chain pins the pool at
			// one. The threshold is still what makes three reachable: the env
			// asks for 95% and the fixture holds itself at 20%, so a pool given
			// only the room would stay where it is.
			await storeSharedSettings(vendor, 'autoscale_settings', {
				scaleCpuThreshold: 5,
				maxWorkers: 3,
			});

			expect(await poolSize(rig, 3, 60_000)).toBe(3);
		}, 90_000);

		it('applies a lowered ceiling to a pool already above it', async () => {
			// Both fields, so the pool is shrunk by the new ceiling rather
			// than by the scale threshold reverting to the env's 95 at the
			// same moment.
			await storeSharedSettings(vendor, 'autoscale_settings', {
				scaleCpuThreshold: 5,
				maxWorkers: 2,
			});

			expect(await poolSize(rig, 2, 60_000)).toBe(2);
		}, 90_000);

		it('returns to the env chain once the layer is cleared', async () => {
			await storeSharedSettings(vendor, 'autoscale_settings', null);

			// The env ceiling is one, and the pool is at two: clearing the layer
			// is asserted by the shrink it causes rather than by a window in
			// which nothing happens, which a pool left where it was would pass
			// either way.
			expect(await poolSize(rig, 1, 60_000)).toBe(1);
		}, 90_000);

		// The layer is a document an operator writes during an incident, so it
		// is exactly where a zero too many arrives. Obeyed literally it would
		// ask pm2 for more workers than the box holds — the failure this
		// autoscaler exists to stop, arriving through its own configuration.
		it('clamps settings asking past the ceiling to the ceiling', async () => {
			await storeSharedSettings(vendor, 'autoscale_settings', {
				minWorkers: 10_000,
				maxWorkers: 3,
			});

			// Three, because that is the ceiling the same layer names: the floor
			// was applied, so it was read, and it was read as three rather than
			// as the ten thousand it asks for.
			expect(await poolSize(rig, 3, 60_000)).toBe(3);
			expect(await neverExceeded(rig, 3, 10_000)).toBe(3);
		}, 120_000);

		// The second of the three rollback levers, after the strategy: pinning
		// the pool to a size somebody chose. The pool is at three and the load
		// clears the threshold, so both directions are witnessed at once — it
		// comes down to the pin, and stays there rather than climbing back.
		it('pins the pool where the floor and the ceiling meet', async () => {
			await storeSharedSettings(vendor, 'autoscale_settings', {
				scaleCpuThreshold: 5,
				minWorkers: 2,
				maxWorkers: 2,
			});

			expect(await poolSize(rig, 2, 60_000)).toBe(2);
			expect(await neverExceeded(rig, 2, 15_000)).toBe(2);
		}, 120_000);

		// The last lever, and the bluntest: stop deciding. What it is for is an
		// autoscaler misreading a pool badly enough that no size it picks can be
		// trusted — so the test of it is a configuration it would obey, ignored.
		it('holds the pool where it is while autoscaling is disabled', async () => {
			await storeSharedSettings(vendor, 'autoscale_settings', {
				enabled: false,
				scaleCpuThreshold: 5,
				minWorkers: 1,
				maxWorkers: 1,
			});

			expect(await sizesOver(rig, 20_000)).toEqual([2]);
		}, 90_000);

		// And the freeze is the flag, not the pool having run out of reasons to
		// move: the same settings with the flag turned back on empty it to the
		// ceiling they were carrying all along.
		it('acts on those same settings once they are enabled again', async () => {
			await storeSharedSettings(vendor, 'autoscale_settings', {
				enabled: true,
				scaleCpuThreshold: 5,
				minWorkers: 1,
				maxWorkers: 1,
			});

			expect(await poolSize(rig, 1, 60_000)).toBe(1);
		}, 90_000);
	});
});
