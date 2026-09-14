import config, { getUrl, paths } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import { createRequire } from 'module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const cliScript = require.resolve(paths.cli);
const auth = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * The environment of one deployment, with every variable naming one of these
 * dependencies dropped.
 *
 * Dropped rather than left to the runner: `config.envs` carries the runner's
 * own environment through, so an arm claiming a deployment has no Redis has to
 * be the thing that makes that true.
 */
function envWithout(
	vendor: Vendor,
	prefixes: string[],
): Record<string, string> {
	const env = cloneDeep(config.envs)[vendor]!;

	for (const key of Object.keys(env)) {
		if (prefixes.some((prefix) => key.startsWith(prefix))) {
			delete env[key];
		}
	}

	return env;
}

/** How long a deployment is given to finish booting and answer. */
const BOOT_MS = 90_000;

/**
 * How long the autoscaler is watched for, once it has said anything at all.
 *
 * It runs until it is stopped, so the claim is that it is still running — and
 * the failure it is watched for is a call inside its boot ending the process
 * rather than answering.
 */
const WATCH_MS = 10_000;

// Every layer of the processes module is a dependency of the deployment it
// describes and not of the deployment itself: the pool is reported over the
// bus, the shared settings are read out of the database, and a deployment can
// be missing either. Missing, they cost the module what it can say — never the
// deployment its ability to come up.
describe.each(vendors)('%s', (vendor) => {
	// Without Redis the bus is an emitter each process shares with nobody, so
	// the reading the autoscaler publishes reaches no worker, ever. A hold
	// waiting for one is a hold nothing can lift: the deployment answers every
	// probe with an error and the platform gating on it never switches over.
	it('reports ready where a prewarm can never be reported', async () => {
		const env = envWithout(vendor, ['REDIS']);
		const port = await getPort();

		env['PORT'] = String(port);
		env['CACHE_NAMESPACE'] = `blackbox-missing-dependency-${vendor}`;

		// The variable the hold is gated on. Asked for by a deployment that has
		// no way of hearing whether it was reached.
		env['PM2_AUTOSCALE_PREWARM'] = '2';

		const instance = spawn('node', [cliScript, 'start'], {
			cwd: paths.cwd,
			env,
		});

		try {
			await awaitDirectusConnection(port);

			const response = await request(getUrl(vendor, { [vendor]: env } as never))
				.get('/server/health')
				.set('Authorization', auth);

			expect(response.status).toBe(200);
			expect(response.body['status']).toBe('ok');

			// Nothing to answer for: no process of this deployment can see the
			// pool, and a check saying otherwise would be reporting a reading
			// nobody took.
			expect(response.body['checks']['processes:pool']).toBeUndefined();
		}
		finally {
			instance.kill();
		}
	}, 180_000);

	// The autoscaler reads the shared settings out of the database, and the
	// call that reaches it answers a missing connection variable by ending the
	// process. An autoscaler that ends leaves the pool at whatever size it was
	// found at, with its own supervisor restarting it into the same boot.
	it('keeps scaling where the shared settings cannot be read', async () => {
		// Without the bus too: this autoscaler reports on a pool of its own, and
		// a suite beside it reads that channel for a pool of its own.
		const env = envWithout(vendor, ['DB_HOST', 'REDIS']);

		// Its own daemon, so a run this arm outlives cannot reach a pool
		// another suite is scaling.
		env['PM2_HOME'] = mkdtempSync(join(tmpdir(), 'bb-missing-dependency-'));
		env['PM2_AUTOSCALE_APP_NAME'] = `missing-dependency-${vendor}`;
		env['PM2_AUTOSCALE_ENABLED'] = 'false';
		env['LOG_LEVEL'] = 'info';

		const autoscaler = spawn('node', [cliScript, 'autoscale'], {
			cwd: paths.cwd,
			env,
		});

		let output = '';

		autoscaler.stdout.on('data', (chunk) => (output += String(chunk)));
		autoscaler.stderr.on('data', (chunk) => (output += String(chunk)));

		try {
			const deadline = Date.now() + BOOT_MS;

			while (Date.now() < deadline && output.includes('[autoscale]') === false) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			// It got past the read, so it has a loop to keep.
			expect(output, output).toContain('[autoscale]');

			await new Promise((resolve) => setTimeout(resolve, WATCH_MS));

			expect(autoscaler.exitCode, output).toBeNull();
		}
		finally {
			autoscaler.kill();
		}
	}, 180_000);
});
