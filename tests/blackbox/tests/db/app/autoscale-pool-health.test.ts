import config, { getUrl, paths } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type Rig,
	poolSize,
	startAutoscaler,
	startPool,
	stopRig,
} from './autoscale/rig';

// A worker that cannot finish its boot never binds, so it never answers
// `/server/health` — and its siblings do. The supervisor is the only thing
// that can see it, and no worker of a pool holds a connection to one, so the
// process that does has to carry what it sees to the rest of the deployment.
//
// The smallest rig that can tell: a pool the daemon is not keeping whole, an
// autoscaler watching it, and a Directus on the same bus being asked how it
// is. Nothing here scales anything — `PM2_AUTOSCALE_ENABLED` is off, and the
// reading is taken on the same tick either way.
describe('A pool the supervisor cannot keep whole reaches /server/health', () => {
	const rigs = {} as Record<Vendor, Rig>;
	const instances = {} as Record<Vendor, ChildProcess>;
	const envs = {} as Record<Vendor, Record<string, string>>;
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		for (const vendor of vendors) {
			const env = cloneDeep(config.envs)[vendor]!;
			const port = await getPort();

			env['PORT'] = String(port);
			env['REDIS_HOST'] = 'localhost';
			env['REDIS_PORT'] = '6108';
			env['CACHE_NAMESPACE'] = `blackbox-pool-health-${vendor}`;
			envs[vendor] = env;

			// Listening before anything reports: a reading is delivered once and
			// nothing replays it, so a process that boots after one was sent
			// waits for the repeat. Which is the shape in production too — a
			// worker the pool gained mid-incident hears the next reading, not
			// the one it missed.
			instances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env,
			});

			await awaitDirectusConnection(port);

			const rig = startPool({
				appName: `pool-health-${vendor}`,
				instances: 2,
				crashAfterMs: 2000,
				crashOnlyInstance: '1',
				// The state a worker the supervisor has given up on sits in,
				// without the arm waiting out a restart budget to reach it.
				giveUpAfterRestarts: 1,
			});

			rigs[vendor] = rig;

			// Started once the pool is already short, so the first reading it
			// takes is the one this file is about.
			expect(await poolSize(rig, 1, 60_000)).toBe(1);

			startAutoscaler(rig, {
				REDIS_HOST: 'localhost',
				REDIS_PORT: '6108',
				CACHE_NAMESPACE: env['CACHE_NAMESPACE']!,
				PM2_AUTOSCALE_ENABLED: 'false',
			});
		}
	}, 300_000);

	afterAll(() => {
		for (const vendor of vendors) {
			stopRig(rigs[vendor]!);
			instances[vendor]!.kill();
		}
	});

	it.each(vendors)('%s', async (vendor) => {
		const url = getUrl(vendor, { [vendor]: envs[vendor] } as never);
		const deadline = Date.now() + 120_000;
		let body: Record<string, any> = {};
		let status = 0;

		while (Date.now() < deadline) {
			const response = await request(url)
				.get('/server/health')
				.set('Authorization', auth);

			status = response.status;
			body = response.body;

			if (body['checks']?.['processes:pool'] !== undefined) {
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		expect(body['checks']?.['processes:pool']).toEqual([
			{
				componentType: 'system',
				status: 'warn',
				observedValue: 1,
				observedUnit: 'workers',
				output: 'The supervisor could not keep every worker running',
			},
		]);

		// The 200 is the point of the warning: this instance is serving, and a
		// platform that read an error here would take it out of rotation over
		// a worker somewhere else that is already gone.
		expect(status).toBe(200);
		expect(body['status']).toBe('warn');

		// The log of the process that measured it, which is what a deployment
		// with nothing polling the endpoint has to go on.
		expect(rigs[vendor]!.logs.join('')).toContain(
			'could not keep 1 worker(s) running',
		);
	}, 180_000);
});
