import config, { getUrl, paths } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import { createRequire } from 'module';
import { mkdtempSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
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

/**
 * A listener that carries one connection through to another, and can stop.
 *
 * The database a shard runs against is the one every suite beside it runs
 * against, so an outage cannot be staged by stopping it. Staged on this side of
 * the socket instead: the deployment connects through here, and cutting this
 * leaves it holding a connection to a port nothing answers on any more, which
 * is what it would be holding either way.
 */
function forwardingProxy(host: string, port: number) {
	const carried = new Set<Socket>();

	const server = createServer((incoming) => {
		const outgoing = connect(port, host);

		carried.add(incoming);
		carried.add(outgoing);

		// A socket cut mid-query raises on both ends, and an unanswered `error`
		// event is thrown rather than reported — by the test's own process.
		incoming.on('error', () => {});
		outgoing.on('error', () => {});

		incoming.pipe(outgoing);
		outgoing.pipe(incoming);
	});

	return {
		listen: () => {
			return new Promise<number>((resolve) => {
				server.listen(0, '127.0.0.1', () => {
					resolve((server.address() as { port: number }).port);
				});
			});
		},
		// The listener and everything it is already carrying: a pool keeps its
		// connections, so a closed listener alone would be an outage the pool
		// never notices.
		cut: () => {
			server.close();

			for (const socket of carried) {
				socket.destroy();
			}
		},
	};
}

/** How long a deployment is given to finish booting and answer. */
const BOOT_MS = 90_000;

/** Poll until it holds, or until that budget is spent. */
async function waitFor(held: () => boolean): Promise<void> {
	const deadline = Date.now() + BOOT_MS;

	while (Date.now() < deadline && held() === false) {
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

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

			// Not `ok`: a busy shard pushes a response-time check into `warn`,
			// and only the hold this test refutes answers `error`.
			expect(response.body['status'], JSON.stringify(response.body['checks']))
				.not.toBe('error');

			// Nothing to answer for: no process of this deployment can see the
			// pool, and a check saying otherwise would be reporting a reading
			// nobody took.
			expect(response.body['checks']['processes:pool']).toBeUndefined();
		}
		finally {
			instance.kill();
		}
	}, 180_000);

	// The autoscaler reads the shared settings out of the database, which is a
	// dependency its loop never had before they were kept there. A database that
	// stops answering has to cost it that layer and nothing else: an autoscaler
	// that ends leaves the pool at whatever size the outage caught it at, and its
	// supervisor restarts it into the same outage.
	it('keeps scaling where the database stops answering', async () => {
		// Without the bus too: this autoscaler reports on a pool of its own, and
		// a suite beside it reads that channel for a pool of its own.
		const env = envWithout(vendor, ['REDIS']);

		const proxy = forwardingProxy(
			env['DB_HOST']!,
			Number(env['DB_PORT']),
		);

		// Reached rather than merely declared, because the outage this stages
		// arrives after the boot. A connection refused from the start ends the
		// process somewhere else entirely: building the CLI reads the extensions
		// out of the database, and that read is every command's boot rather than
		// this one's.
		env['DB_HOST'] = '127.0.0.1';
		env['DB_PORT'] = String(await proxy.listen());

		// So the tick that has to notice is seconds away rather than the floor's
		// half-minute.
		env['SHARED_SETTINGS_POLL_SECONDS'] = '1';

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
			await waitFor(() => output.includes('[autoscale] shared settings:'));

			// It read them, so what it loses next is a layer it had.
			expect(output, output).toContain('[autoscale] shared settings:');

			proxy.cut();

			await waitFor(() => output.includes('could not read the shared'));

			// Said rather than swallowed, and said by a process still running:
			// the pool is sized on the environment chain until the database
			// answers again.
			expect(output, output).toContain('could not read the shared settings');
			expect(autoscaler.exitCode, output).toBeNull();
		}
		finally {
			autoscaler.kill();
			proxy.cut();
		}
	}, 180_000);
});
