import vendors from '@common/get-dbs-to-test';
import { afterEach, describe, expect, it } from 'vitest';
import {
	type Deployment,
	deploy,
	healthOf,
	healthTurns,
} from './autoscale/prewarm-deployment';
import {
	poolSize,
	startAutoscaler,
	stopRig,
} from './autoscale/rig';

// A worker binds before the pool is whole: pm2 runs it in cluster mode, where
// the primary owns the listening socket, so the port answers as soon as the
// first worker is up. A platform gating its switchover on `/server/health`
// would take that as the pool being ready and move traffic onto a fraction of
// the one that was asked for — which is the moment prewarm exists to cover.
//
// So a deployment that asked for a prewarm holds its health down until it has
// been told the pool reached it, and a deployment that cannot get there never
// reports itself ready at all.
describe('A prewarm the deployment has not reached holds /server/health', () => {
	const deployed: Deployment[] = [];

	afterEach(() => {
		for (const deployment of deployed.splice(0)) {
			stopRig(deployment.rig);
			deployment.instance.kill();
		}
	});

	it.each(vendors)('%s reports ready once the pool is prewarmed', async (vendor) => {
		const deployment = await deploy(vendor, '2', { instances: 1 });
		deployed.push(deployment);

		const held = await healthOf(deployment.url);

		expect(held.status).toBe(503);
		expect(held.body['status']).toBe('error');

		expect(held.body['checks']['processes:pool']).toEqual([
			{
				componentType: 'system',
				status: 'error',
				observedValue: 0,
				observedUnit: 'workers',
				output: 'The pool has not reached the size it serves with',
			},
		]);

		startAutoscaler(deployment.rig, {
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: deployment.namespace,
			PM2_AUTOSCALE_PREWARM: '2',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_WARMUP_SECONDS: '2',
		});

		expect(await poolSize(deployment.rig, 2, 90_000)).toBe(2);

		expect(await healthTurns(deployment.url, 200, 60_000)).toBe(200);

		const ready = await healthOf(deployment.url);
		expect(ready.body['status']).toBe('ok');
		expect(ready.body['checks']['processes:pool']).toBeUndefined();
	}, 240_000);

	it.each(vendors)('%s stays held while a worker will not run', async (vendor) => {
		const deployment = await deploy(vendor, '2', {
			instances: 2,
			crashAfterMs: 2000,
			crashOnlyInstance: '1',
		});

		deployed.push(deployment);

		// Short before the autoscaler takes its first reading, so the pool it
		// reports on is the one this arm is about. A reading taken while every
		// worker was still up would say the pool came up, and it would have.
		expect(await poolSize(deployment.rig, 1, 90_000)).toBe(1);

		startAutoscaler(deployment.rig, {
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: deployment.namespace,
			PM2_AUTOSCALE_PREWARM: '2',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_WARMUP_SECONDS: '2',
		});

		// A deployment that cannot come up whole is a defect rather than a
		// deployment being slow: it never reports ready, and the platform
		// keeps the previous one serving.
		expect(await healthTurns(deployment.url, 200, 60_000)).toBe(503);

		const held = await healthOf(deployment.url);

		expect(held.body['checks']['processes:pool'][0]['status']).toBe('error');
	}, 240_000);

	// pm2 answers a scale once every worker it added has reported ready, and
	// it boots them one after another, so a scale costs the whole batch's boot
	// while a waited supervisor call is bounded at fifteen seconds. A prewarm
	// waited on inside that bound was cut off on a supervisor that was
	// perfectly healthy: the workers it had already started went on arriving,
	// nothing asked for the rest, and the deployment waited to be told it had
	// reached a size nothing was still growing towards
	// (https://github.com/jclaveau/directus/issues/490). Eight workers three
	// seconds apart is twenty-one seconds of boot, which is that shape at a
	// size a runner can hold.
	it.each(vendors)('%s reaches a prewarm one scale cannot carry', async (vendor) => {
		const deployment = await deploy(vendor, '8', {
			instances: 1,
			readyDelayMs: 3000,
		});

		deployed.push(deployment);

		expect((await healthOf(deployment.url)).status).toBe(503);

		startAutoscaler(deployment.rig, {
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: deployment.namespace,
			PM2_AUTOSCALE_PREWARM: '8',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '8',
			PM2_AUTOSCALE_WARMUP_SECONDS: '2',
		});

		expect(await poolSize(deployment.rig, 8, 120_000)).toBe(8);

		expect(await healthTurns(deployment.url, 200, 60_000)).toBe(200);

		// Asked for once, as one scale for the whole pool: a second scale sent
		// while the first was still adding would have counted the workers added
		// so far and grown the pool past eight.
		expect(deployment.rig.logs.join('').match(/prewarming .+ workers/g))
			.toEqual([`prewarming ${deployment.rig.appName} from 1 to 8 workers`]);
	}, 240_000);
});
