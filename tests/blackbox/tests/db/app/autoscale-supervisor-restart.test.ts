import { afterAll, describe, expect, it } from 'vitest';
import {
	countWorkers,
	decisionAfter,
	decisionsOf,
	poolSize,
	reportOf,
	restartSupervisor,
	startAutoscaler,
	startPool,
	stopRig,
	type Rig,
} from './autoscale/rig';

// A pm2 daemon is not forever: `pm2 update` replaces it, an OOM takes it, and
// the planner restarts its services on a nightly cron. The autoscaler connects
// to one once, at boot, and never again — so if that connection did not survive
// the daemon behind it, every tick after would fail into the loop's catch and
// the pool would sit unmanaged behind a log line a second, which is the shape of
// failure this whole component exists to not have.
describe('The autoscaler outlives its supervisor', () => {
	const rigs: Rig[] = [];

	afterAll(() => {
		for (const rig of rigs) {
			stopRig(rig);
		}
	});

	it('goes on scaling after the daemon is restarted under it', async () => {
		const rig = startPool({
			appName: 'autoscale-supervisor',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '5',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
			PM2_AUTOSCALE_WARMUP_SECONDS: '4',
		});

		expect(await poolSize(rig, 2, 60_000), reportOf(rig)).toBe(2);

		const decidedBeforeRestart = decisionsOf(rig).length;

		restartSupervisor(rig);

		// The ecosystem declares one worker, so the pool comes back at one
		// whatever it had grown to. Asserted rather than waited for: without it
		// the climb below would be satisfied by the two the arm already had.
		expect(countWorkers(rig), reportOf(rig)).toBe(1);

		// A decision taken over a connection whose daemon has died since it was
		// made. Asserted as a decision rather than as the pool size below,
		// because that is where the two outcomes first differ: an autoscaler
		// that survived says so on the tick after the restart, and one wedged on
		// a call the dead daemon never answered says nothing at all — for the
		// whole minute the size below spends failing to name what went wrong.
		const decided = await decisionAfter(rig, decidedBeforeRestart, 60_000);

		expect(decided, reportOf(rig)).not.toEqual([]);
		expect(await poolSize(rig, 2, 60_000), reportOf(rig)).toBe(2);
	}, 150_000);
});
