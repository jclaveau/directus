import config, { getUrl, paths } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
	type Rig,
	poolSize,
	startAutoscaler,
	startPool,
	stopRig,
} from './autoscale/rig';

const auth = `Bearer ${USER.ADMIN.TOKEN}`;

interface Deployment {
	instance: ChildProcess;
	url: string;
	rig: Rig;
}

/**
 * A Directus that has been told it serves with a prewarmed pool, and a pm2
 * daemon holding a pool it can be told about.
 *
 * The instance is not a worker of that pool — a blackbox runner has no
 * supervisor over the suite itself — but it reads the same environment and
 * hears the same bus, which is everything the check under test depends on.
 */
async function deploy(
	vendor: Vendor,
	prewarm: string,
	pool: {
		instances: number;
		crashAfterMs?: number;
		crashOnlyInstance?: string;
	},
): Promise<Deployment> {
	const env = cloneDeep(config.envs)[vendor]!;
	const port = await getPort();

	env['PORT'] = String(port);
	env['REDIS_HOST'] = 'localhost';
	env['REDIS_PORT'] = '6108';
	env['CACHE_NAMESPACE'] = `blackbox-prewarm-health-${vendor}-${prewarm}`;
	env['PM2_AUTOSCALE_PREWARM'] = prewarm;

	const instance = spawn('node', [paths.cli, 'start'], {
		cwd: paths.cwd,
		env,
	});

	// `/server/ping`, not `/server/health`: the point of this file is that the
	// second one is refusing while the first one answers.
	await awaitDirectusConnection(port);

	return {
		instance,
		rig: startPool({
			appName: `prewarm-health-${vendor}-${prewarm}`,
			keepRestarting: false,
			...pool,
		}),
		url: getUrl(vendor, { [vendor]: env } as never),
	};
}

async function healthOf(url: string): Promise<{ status: number; body: any }> {
	const response = await request(url)
		.get('/server/health')
		.set('Authorization', auth);

	return { status: response.status, body: response.body };
}

async function healthTurns(
	url: string,
	status: number,
	timeoutMs: number,
): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let last = 0;

	while (Date.now() < deadline) {
		last = (await healthOf(url)).status;

		if (last === status) {
			return last;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	return last;
}

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
});
