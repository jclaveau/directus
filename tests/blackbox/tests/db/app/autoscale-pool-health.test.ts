import config, { getUrl, paths } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { once } from 'node:events';
import getPort from 'get-port';
import Redis from 'ioredis';
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
//
// The cases run in order over one rig: the reading arrives, then the bus goes
// quiet, then a Directus booted late asks for it, then the autoscaler stops.
describe('A pool the supervisor cannot keep whole reaches /server/health', () => {
	const rigs = {} as Record<Vendor, Rig>;
	const instances = {} as Record<Vendor, ChildProcess>;
	const lateInstances = {} as Record<Vendor, ChildProcess>;
	const envs = {} as Record<Vendor, Record<string, string>>;
	const listeners = {} as Record<Vendor, Redis>;
	const heard = {} as Record<Vendor, { channel: string; at: number }[]>;
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	/** Polls `/server/health` until `done` holds of its body, or two minutes. */
	async function healthUntil(
		url: string,
		done: (body: Record<string, any>) => boolean,
	) {
		const deadline = Date.now() + 120_000;
		const askHealth = () => {
			return request(url).get('/server/health').set('Authorization', auth);
		};

		let response = await askHealth();

		while (done(response.body) === false && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			response = await askHealth();
		}

		return response;
	}

	beforeAll(async () => {
		for (const vendor of vendors) {
			const env = cloneDeep(config.envs)[vendor]!;
			const port = await getPort();

			env['PORT'] = String(port);
			env['REDIS_HOST'] = 'localhost';
			env['REDIS_PORT'] = '6108';
			env['CACHE_NAMESPACE'] = `blackbox-pool-health-${vendor}`;
			envs[vendor] = env;

			// Listening before anything reports, so the reading reaches it as a
			// change. A process that boots after one was sent asks for it, which
			// is the third case.
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

			const namespace = `${env['CACHE_NAMESPACE']}:bus`;
			const listener = new Redis({ host: 'localhost', port: 6108 });

			heard[vendor] = [];

			listener.on('message', (channel: string) => {
				heard[vendor]!.push({ channel, at: Date.now() });
			});

			await listener.subscribe(
				`${namespace}:poolHealth`,
				`${namespace}:poolHealth:query`,
			);

			listeners[vendor] = listener;

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
			lateInstances[vendor]?.kill();
			listeners[vendor]!.disconnect();
		}
	});

	it.each(vendors)('%s', async (vendor) => {
		const url = getUrl(vendor, { [vendor]: envs[vendor] } as never);

		const { status, body } = await healthUntil(url, (health) => {
			return health['checks']?.['processes:pool'] !== undefined;
		});

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

	// Twice the interval the reading used to be repeated on: a deployment
	// whose pool holds still puts nothing on the bus, so a platform that stops
	// an idle service after a stretch without traffic can stop it.
	it.each(vendors)(
		'sends nothing more while the pool holds still: %s',
		async (vendor) => {
			const since = Date.now();

			await new Promise((resolve) => setTimeout(resolve, 25_000));

			const sent = heard[vendor]!.filter(({ channel, at }) => {
				return at >= since && channel.endsWith(':poolHealth');
			});

			expect(sent).toEqual([]);
		},
		60_000,
	);

	// Nothing repeats the reading any more, so a process that was not
	// listening when it changed only has it if it asks.
	it.each(vendors)(
		'answers a Directus that boots after it was sent: %s',
		async (vendor) => {
			const since = Date.now();
			const port = await getPort();
			const env = { ...envs[vendor]!, PORT: String(port) };

			lateInstances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env,
			});

			await awaitDirectusConnection(port);

			const url = getUrl(vendor, { [vendor]: env } as never);

			const { body } = await healthUntil(url, (health) => {
				return health['checks']?.['processes:pool'] !== undefined;
			});

			expect(body['checks']?.['processes:pool']?.[0]?.observedValue).toBe(1);

			const channels = heard[vendor]!
				.filter(({ at }) => at >= since)
				.map(({ channel }) => channel.split(':bus:')[1]);

			expect(channels).toEqual(['poolHealth:query', 'poolHealth']);
		},
		180_000,
	);

	// A reading nothing repeats is one nothing expires either: the autoscaler
	// takes it back on its way out, and the pool it described stops being
	// answered for.
	it.each(vendors)(
		'takes the reading back when the autoscaler stops: %s',
		async (vendor) => {
			const since = Date.now();
			const autoscaler = rigs[vendor]!.autoscaler!;

			autoscaler.kill('SIGTERM');
			await once(autoscaler, 'exit');

			const url = getUrl(vendor, { [vendor]: envs[vendor] } as never);

			const { status, body } = await healthUntil(url, (health) => {
				return health['checks']?.['processes:pool'] === undefined;
			});

			expect(body['checks']?.['processes:pool']).toBeUndefined();
			expect(status).toBe(200);

			const sent = heard[vendor]!
				.filter(({ at }) => at >= since)
				.map(({ channel }) => channel.split(':bus:')[1]);

			expect(sent).toEqual(['poolHealth']);
		},
		60_000,
	);
});
