import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A configuration is judged by what the loop does with it, and a quiet pool
// does nothing with any of it: no threshold is reached, no cooldown starts,
// and a ceiling that is wrong stays wrong until the traffic that proves it
// arrives at the worst possible moment. The drill produces that traffic's
// effect on demand.
//
// It is a lever that deliberately loads a production pool, so what is proven
// here is as much what it refuses as what it does: the route is absent where
// nobody asked for it, the duration and the share are bounded, and a worker
// holding the processor still answers.

/** Long enough to observe, short enough to wait out inside one case. */
const DRILL_SECONDS = 3;

describe('The autoscale load drill', () => {
	const instances = {} as Record<Vendor, ChildProcess>;
	const envs = {} as Record<Vendor, Env>;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		const started = [];

		for (const vendor of vendors) {
			const env = cloneDeep(config.envs);

			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = '6108';
			env[vendor]['CACHE_NAMESPACE'] = `blackbox-autoscale-drill-${vendor}`;
			env[vendor]['PM2_AUTOSCALE_DRILL_ENABLED'] = 'true';

			const port = await getPort();
			env[vendor].PORT = String(port);
			envs[vendor] = env;

			instances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			started.push(awaitDirectusConnection(port));
		}

		await Promise.all(started);
	}, 180_000);

	afterAll(async () => {
		for (const vendor of vendors) {
			await request(getUrl(vendor, envs[vendor]))
				.delete('/utils/autoscale/drill')
				.set('Authorization', auth);

			instances[vendor]!.kill();
		}
	});

	function start(vendor: Vendor, body: object) {
		return request(getUrl(vendor, envs[vendor]))
			.post('/utils/autoscale/drill')
			.set('Authorization', auth)
			.send(body);
	}

	function stop(vendor: Vendor) {
		return request(getUrl(vendor, envs[vendor]))
			.delete('/utils/autoscale/drill')
			.set('Authorization', auth);
	}

	function read(vendor: Vendor) {
		return request(getUrl(vendor, envs[vendor]))
			.get('/utils/autoscale/drill')
			.set('Authorization', auth);
	}

	// The lever exists where a deployment asked for it and nowhere else, which
	// is the shared instance every other file here runs against.
	describe('is absent from a deployment that did not ask for it', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await request(getUrl(vendor))
				.get('/utils/autoscale/drill')
				.set('Authorization', auth);

			expect(response.statusCode).toBe(404);
		});
	});

	describe('answers with the deadline the pool was given', () => {
		it.each(vendors)('%s', async (vendor) => {
			await stop(vendor);
			const before = Date.now();
			const response = await start(vendor, { seconds: DRILL_SECONDS, percent: 20 });

			expect(response.statusCode).toBe(200);
			expect(response.body.data.percent).toBe(20);

			expect(response.body.data.until)
				.toBeGreaterThanOrEqual(before + DRILL_SECONDS * 1000);

			// Read back rather than taken from the answer: the worker that burns
			// holds its own deadline, and that is the one that ends the drill.
			const live = await read(vendor);

			expect(live.body.data.until).toBe(response.body.data.until);

			await new Promise((resolve) => {
				setTimeout(resolve, DRILL_SECONDS * 1000 + 500);
			});

			const over = await read(vendor);

			expect(over.body.data.until).toBeNull();
		});
	});

	// A worker that never yields answers nothing, and a drill that takes the
	// deployment down measures nothing — so the share it burns stops short of
	// the whole slice and the gap is what a request is served in.
	describe('keeps answering while it burns', () => {
		it.each(vendors)('%s', async (vendor) => {
			await stop(vendor);
			await start(vendor, { seconds: DRILL_SECONDS, percent: 95 });

			const ping = await request(getUrl(vendor, envs[vendor])).get('/server/ping');

			expect(ping.statusCode).toBe(200);

			await stop(vendor);
		});
	});

	describe('can be called off before its deadline', () => {
		it.each(vendors)('%s', async (vendor) => {
			await start(vendor, { seconds: 120, percent: 20 });

			const stopped = await stop(vendor);

			expect(stopped.statusCode).toBe(200);
			expect(stopped.body.data.until).toBeNull();

			// The stop is a broadcast, so the worker leaves its current slice
			// before it takes it — read after one.
			await new Promise((resolve) => {
				setTimeout(resolve, 500);
			});

			const over = await read(vendor);

			expect(over.body.data.until).toBeNull();
		});
	});

	// The cap is what makes a lost stop harmless, so a request past it is
	// refused rather than quietly brought back to it.
	describe('refuses a drill longer than a worker will run one for', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await start(vendor, { seconds: 600, percent: 20 });

			expect(response.statusCode).toBe(400);

			expect(response.body.errors[0].message)
				.toContain(`'seconds' has to be a whole number between 1 and 120`);

			const stored = await read(vendor);

			expect(stored.body.data.until).toBeNull();
		});
	});

	describe('refuses a share outside what a worker will burn', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await start(vendor, { seconds: 5, percent: 200 });

			expect(response.statusCode).toBe(400);

			expect(response.body.errors[0].message)
				.toContain(`'percent' has to be a whole number between 10 and 95`);
		});
	});
});
