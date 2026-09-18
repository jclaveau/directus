import config, { paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { sleep } from '@utils/sleep';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The cache audit replays entries over the process's own loopback, and the
// pressure limiter sat in front of them: a run's bookkeeping stalled the loop,
// the limiter shed the replays, and a whole page came back `unreplayable
// status_503` from a node answering everyone else (jclaveau/directus#508).
// An instance held overloaded from its first sample — a memory ceiling of one
// byte — sheds every request but the one carrying the replay's marker.

describe('/server under pressure', () => {
	const instances = {} as Record<Vendor, ChildProcess>;
	const ports = {} as Record<Vendor, number>;
	const markers = {} as Record<Vendor, string>;

	beforeAll(async () => {
		for (const vendor of vendors) {
			const env = cloneDeep(config.envs) as { [vendor: string]: Env };
			env[vendor]['PRESSURE_LIMITER_ENABLED'] = 'true';
			env[vendor]['PRESSURE_LIMITER_SAMPLE_INTERVAL'] = '50';
			env[vendor]['PRESSURE_LIMITER_MAX_MEMORY_RSS'] = '1';

			const port = await getPort();
			env[vendor].PORT = String(port);
			ports[vendor] = port;

			// The marker is the audit's HMAC over SECRET, computed as the engine
			// does: the wire contract between an auditing worker and the one its
			// loopback lands on.
			markers[vendor] = createHmac('sha256', String(env[vendor]['SECRET']))
				.update('cache-audit-replay')
				.digest('hex');

			instances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});
		}

		// The usual readiness wait needs a 200 from `/server/ping`, which this
		// instance refuses by design: up is the refusal. A 200 is the listener
		// up before the limiter's first sample, and is waited out like a refused
		// connection.
		for (const vendor of vendors) {
			for (let attempt = 0; attempt < 100; attempt++) {
				const probe = await request(`http://127.0.0.1:${ports[vendor]}`)
					.get('/server/ping')
					.catch(() => undefined);

				if (probe?.statusCode === 503) {
					break;
				}

				await sleep(1000);
			}
		}
	}, 180_000);

	afterAll(() => {
		for (const vendor of vendors) {
			instances[vendor].kill();
		}
	});

	it.each(vendors)('%s sheds a request of anyone else', async (vendor) => {
		const response = await request(`http://127.0.0.1:${ports[vendor]}`)
			.get('/server/ping');

		expect(response.statusCode).toBe(503);
		expect(response.body.errors[0].extensions.reason).toBe('Under pressure');
	});

	it.each(vendors)('%s answers the cache audit\'s replay', async (vendor) => {
		const response = await request(`http://127.0.0.1:${ports[vendor]}`)
			.get('/server/ping')
			.set('x-cache-audit-replay', markers[vendor]);

		expect(response.statusCode).toBe(200);
		expect(response.text).toBe('pong');
	});

	it.each(vendors)('%s sheds a replay marked by another SECRET', async (vendor) => {
		const response = await request(`http://127.0.0.1:${ports[vendor]}`)
			.get('/server/ping')
			.set('x-cache-audit-replay', 'f'.repeat(64));

		expect(response.statusCode).toBe(503);
	});
});
