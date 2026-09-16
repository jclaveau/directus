import vendors from '@common/get-dbs-to-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeSharedSettings,
	instancesOf,
	poolSize,
	reportOf,
	resizesOf,
	sizesOver,
	startAutoscaler,
	startPool,
	stopRig,
	storeSharedSettings,
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

	// The release cooldown is measured from the last scaling in either
	// direction, so the worker a burst just bought is not taken back the moment
	// the burst ends. Both clocks start when the autoscaler does, which is what
	// makes this reachable in the steady state rather than only at boot: a pool
	// running longer than the cooldown has a release clock that reads as
	// satisfied whatever happens next, and the add is the only thing left
	// holding the worker.
	//
	// The settling time is set above the cooldown so the add lands late enough
	// for the load to stop right after it. A release gated on its own clock
	// alone fires about seven seconds after the load goes; one gated on the add
	// waits the cooldown out from there.
	it('holds a release that would undo the add that just landed', async () => {
		const rig = startPool({
			appName: 'autoscale-antiflap',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
			calmAfterMs: 24_000,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '10',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '5',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			// Two, so the climb is one add and the arm knows when it happened.
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '20',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '25',
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		expect(await poolSize(rig, 2, 90_000), reportOf(rig)).toBe(2);

		// The window the load spends going away and then some. A release
		// measured from the boot clock lands inside it; one measured from the
		// add is still ten seconds out when it closes.
		expect(await sizesOver(rig, 15_000), reportOf(rig)).toEqual([2]);

		// The gate is a delay, not a stop.
		expect(await poolSize(rig, 1, 60_000), reportOf(rig)).toBe(1);
	}, 300_000);

	// Handed a size, pm2 chooses the victim itself: `rmProcs` walks the app's
	// processes from the first one, which is the worker the pool has had
	// longest. Under keep-alive that is where the live requests are — node
	// cluster round-robins new connections, so clients stay on the sockets they
	// already hold — and stopping it drops them. A scale-down did exactly that
	// to a 27s POST on 2026-09-13 and the client got a 502.
	//
	// The pool here is staged so the two choices differ: the worker pm2 would
	// take is the one reporting work, and the idle one is the worker the
	// autoscaler has to name instead.
	it('stops a worker with nothing in flight, not the one pm2 picks', async () => {
		const rig = startPool({
			appName: 'autoscale-victim',
			instances: 2,
			busyMs: 0,
			idleMs: 100,
			inFlight: 4,
			inFlightBusyInstances: '0',
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			// Out of reach of an idle pool in both directions: the arm is about
			// which worker a release takes, so nothing here should depend on
			// what the runner's CPU happens to be doing.
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '80',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '50',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '5',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '5',
			PM2_AUTOSCALE_WARMUP_SECONDS: '5',
		});

		expect(await poolSize(rig, 1, 90_000), reportOf(rig)).toBe(1);

		// Instance 0 is pm2's own first pick, so the survivor's number is the
		// whole of the claim.
		expect(instancesOf(rig), reportOf(rig)).toEqual([0]);
	}, 300_000);

	// A worker reports 0% both when the pool has capacity to spare and when
	// nothing has been routed to it, and keep-alive makes the second common:
	// node cluster round-robins new connections, so clients stay on the sockets
	// they already hold and a worker can idle beside a pool that is working
	// hard. Averaged across the whole pool that idle worker pulls the reading
	// under the release threshold and argues for its own removal, and the work
	// it was not doing lands on the worker that was doing all of it.
	//
	// The pool here reads [~95, 0]. Its average is under the release threshold
	// whatever the runner gives the busy worker — two workers halve it, and a
	// release threshold of 50 is half of a percent no worker can reach — so the
	// unfixed rule releases on any reading. The fixed one holds on any reading
	// above 50, which is the whole band between what the worker is asked for
	// and half of it.
	it('holds a release the surviving worker could not absorb', async () => {
		const rig = startPool({
			appName: 'autoscale-lopsided',
			instances: 2,
			busyMs: 95,
			idleMs: 5,
			busyOnlyInstance: '1',
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			// Over the pool's average, so the arm is about the release branch
			// rather than about a pool that wanted to grow and could not.
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '70',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '50',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '5',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '5',
			PM2_AUTOSCALE_WARMUP_SECONDS: '5',
		});

		// Long enough for the warm-up and the cooldown to pass and then some,
		// so a release judged on the pool's average has fired well inside it.
		expect(await sizesOver(rig, 45_000), reportOf(rig)).toEqual([2]);
	}, 300_000);

	// A pool takes a worker every ten seconds; a release of one a cooldown
	// gives them back in `workers - floor` cooldowns, 31 five-minute ones from
	// the planner's ceiling of 32, holding the memory of 31 workers most of
	// the way. The release goes half the way to the size the load would keep,
	// so an idle pool drains geometrically — and the halving is what keeps a
	// reading that is not all load from overshooting into a pool that has to
	// grow back.
	it('drains an idle pool by halves, not one worker a cooldown', async () => {
		const rig = startPool({
			appName: 'autoscale-drain',
			instances: 8,
			busyMs: 0,
			idleMs: 100,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			// Out of an idle pool's reach by a wide margin: eight workers at
			// whatever an idle one reads on a loaded runner still project under
			// the middle of this band across a single survivor, so the size the
			// load keeps is the floor and the steps are the halving alone.
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '60',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '30',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '8',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '5',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '2',
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		expect(await poolSize(rig, 1, 120_000), reportOf(rig)).toBe(1);
		expect(await sizesOver(rig, 5_000), reportOf(rig)).toEqual([1]);

		// Seven workers over the floor is three steps rather than seven.
		expect(resizesOf(rig), reportOf(rig)).toEqual(['8 -> 4', '4 -> 2', '2 -> 1']);
	}, 300_000);

	// The step is toward the size the load would keep, not toward the floor:
	// a pool with one worker working and seven idle is a pool of two, and a
	// release that halved its way to the floor would take the eighth worker's
	// load down to one worker and buy it back on the next reading.
	//
	// The pool reads [0 ×7, ~65]. The load keeps two as long as the busy
	// worker reads at least the release threshold, or the last release would
	// leave one survivor under it, and under twice the threshold, or two
	// survivors would already be over it. Asked for 65, the worker has room
	// on both sides: a loaded runner can starve it down to 45 and a timer's
	// slack can push it past 80 without moving where the pool stops.
	it('stops a proportional release where the load holds it', async () => {
		const rig = startPool({
			appName: 'autoscale-proportional',
			instances: 8,
			busyMs: 65,
			idleMs: 35,
			busyOnlyInstance: '7',
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '65',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '45',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '8',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '5',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '2',
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		expect(await poolSize(rig, 2, 120_000), reportOf(rig)).toBe(2);

		// Two is where the load holds it, not where a release was still on its
		// way: a release past it would leave the one survivor its whole load.
		expect(await sizesOver(rig, 10_000), reportOf(rig)).toEqual([2]);

		// Six workers over the size the load keeps, in three steps at most:
		// `8 -> 5, 5 -> 3, 3 -> 2` on a reading two workers carry under the
		// middle of the band, `8 -> 4, 4 -> 2` on one a single worker does.
		// A release of one a cooldown would have taken six.
		const resizes = resizesOf(rig);

		expect(resizes.length, reportOf(rig)).toBeLessThanOrEqual(3);
		expect(resizes[0], reportOf(rig)).toMatch(/^8 -> [45]$/);
		expect(resizes.at(-1), reportOf(rig)).toMatch(/^[23] -> 2$/);
	}, 300_000);

	// A release of several workers chooses each of them the way a release of
	// one does, so the ones holding requests are the ones it leaves. Two of
	// the six report work, and they are the two pm2 would take first.
	it('leaves every working worker out of a release of several', async () => {
		const rig = startPool({
			appName: 'autoscale-victims',
			instances: 6,
			busyMs: 0,
			idleMs: 100,
			inFlight: 4,
			inFlightBusyInstances: '0,1',
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '60',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '30',
			PM2_AUTOSCALE_MIN_WORKERS: '2',
			PM2_AUTOSCALE_MAX_WORKERS: '6',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '5',
			PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: '2',
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		expect(await poolSize(rig, 2, 120_000), reportOf(rig)).toBe(2);
		expect(await sizesOver(rig, 5_000), reportOf(rig)).toEqual([2]);

		// The first step took two workers in one decision, and neither of
		// them was one of the two holding work — nor was any of the later
		// ones, or the survivors would not be exactly those two.
		expect(resizesOf(rig)[0], reportOf(rig)).toBe('6 -> 4');
		expect(instancesOf(rig), reportOf(rig)).toEqual([0, 1]);
	}, 300_000);
});
