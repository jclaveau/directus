import vendors from '@common/get-dbs-to-test';
import { afterEach, describe, expect, it } from 'vitest';
import {
	type Deployment,
	deploy,
	healthTurns,
} from './autoscale/prewarm-deployment';
import {
	SUPERVISOR_TIMEOUT_MS,
	WORKER_LISTEN_TIMEOUT_MS,
	poolSize,
	restartSupervisor,
	startAutoscaler,
	stopRig,
} from './autoscale/rig';

describe('A prewarm the daemon lost on its way is asked for again', () => {
	const deployed: Deployment[] = [];

	afterEach(() => {
		for (const deployment of deployed.splice(0)) {
			stopRig(deployment.rig);
			deployment.instance.kill();
		}
	});

	// pm2 keeps a call's callback in the connection that carried it, and the
	// client's socket finds a daemon started in the old one's place on its own:
	// the reads go on being answered, by a daemon that never heard of the scale
	// still waiting in the autoscaler. Left unbounded, that ask would wait for
	// good, and asked once at a time the prewarm would never be asked again.
	// Bounded at the boots it asked for — seven at the fixture's ten seconds,
	// and a call's default on top — it fails, and the pool the daemon came back
	// with is asked to grow.
	it.each(vendors)('%s asks again for a prewarm the daemon lost', async (vendor) => {
		const deployment = await deploy(vendor, '8', {
			instances: 1,
			readyDelayMs: 3000,
		});

		deployed.push(deployment);

		startAutoscaler(deployment.rig, {
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: deployment.namespace,
			PM2_AUTOSCALE_PREWARM: '8',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '8',
			PM2_AUTOSCALE_WARMUP_SECONDS: '2',
		});

		// Mid-scale: the daemon is still booting the workers the ask named.
		expect(await poolSize(deployment.rig, 3, 60_000)).toBe(3);

		restartSupervisor(deployment.rig);

		expect(await poolSize(deployment.rig, 8, 150_000)).toBe(8);

		expect(await healthTurns(deployment.url, 200, 60_000)).toBe(200);

		const logs = deployment.rig.logs.join('');
		const prewarms = logs.match(/prewarming .+ workers/g);

		// Once for the pool the deployment started with, once for the one the
		// supervisor came back with, from the size the ecosystem declares.
		expect(prewarms).toEqual([
			`prewarming ${deployment.rig.appName} from 1 to 8 workers`,
			`prewarming ${deployment.rig.appName} from 1 to 8 workers`,
		]);

		const bound = 7 * WORKER_LISTEN_TIMEOUT_MS + SUPERVISOR_TIMEOUT_MS;

		expect(logs).toContain(
			`the supervisor did not answer a scale to 8 in ${bound}ms`,
		);
	}, 300_000);
});
