import config, { getUrl, paths } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
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

// The variables the processes module reads as booleans, named here rather than
// imported from the source that lists them: a key dropped from that list is
// the regression this file is for, and a test reading the same list would drop
// it too.
const BOOLEAN_KEYS = ['PM2_AUTOSCALE_ENABLED', 'PM2_AUTOSCALE_DRILL_ENABLED'];

// A spelling an environment reaches for and `toBoolean` reads as `false`,
// which is the whole failure: the deployment asked for the feature and got a
// process running as though it had asked for the opposite.
const REFUSED_SPELLING = 'TRUE';

// Long enough for a full boot on a loaded runner, and short enough to end a
// process the check was supposed to stop: without it, a regression here does
// not fail this file, it leaves a server or an autoscaler running for as long
// as the shard does.
const RUN_LIMIT_MS = 90_000;

type Run = { code: number | null; output: string };

/** What the refusal says, which is what a deployment has to read to fix it. */
function refusal(key: string): string {
	return `"${key}" Environment Variable is "${REFUSED_SPELLING}"`;
}

/**
 * Runs one CLI command to its end, keeping everything it said.
 *
 * At `info` so that the lines a boot that got past the check would log are in
 * the output to assert the absence of. The refusal is logged at `error` and is
 * there either way.
 */
function runToEnd(
	vendor: Vendor,
	args: string[],
	env: Record<string, string>,
): Promise<Run> {
	return new Promise((resolve) => {
		const cli = spawn('node', [cliScript, ...args], {
			cwd: paths.cwd,
			env: {
				...process.env,
				...config.envs[vendor],
				LOG_LEVEL: 'info',
				...env,
			},
		});

		let output = '';

		cli.stdout.on('data', (chunk) => (output += String(chunk)));
		cli.stderr.on('data', (chunk) => (output += String(chunk)));

		const limit = setTimeout(() => cli.kill('SIGKILL'), RUN_LIMIT_MS);

		cli.on('close', (code) => {
			clearTimeout(limit);
			resolve({ code, output });
		});
	});
}

// Every process of a deployment reads the same environment, and the two that
// read these keys end before they can act on a bad one: the server before it
// listens, so the deployment that shipped the typo never goes live behind a
// health check; the autoscaler before it connects to a daemon, so it never
// resizes a pool on a value it misread. The unit arms cannot say either — they
// watch a mocked `process.exit` in a process that carries on past it.
describe.each(vendors)('%s', (vendor) => {
	describe('The boot refuses a boolean variable that is not one', () => {
		it.each(BOOLEAN_KEYS)('the server, on %s', async (key) => {
			const port = await getPort();

			const run = await runToEnd(vendor, ['start'], {
				PORT: String(port),
				[key]: REFUSED_SPELLING,
			});

			expect(run.code, run.output).toBe(1);
			expect(run.output).toContain(refusal(key));

			// The line `listen` logs once it is bound. A server that refused
			// the value after binding would have answered whatever reached it
			// first with the feature in the state it misread, and a platform
			// watching the health check would have switched over to it.
			expect(run.output).not.toContain('Server started');
		}, 120_000);

		it('the autoscaler, before it reaches the daemon', async () => {
			const run = await runToEnd(vendor, ['autoscale'], {
				// Its own, so that a run this check fails to stop cannot
				// attach to a daemon another suite is scaling a pool with.
				PM2_HOME: mkdtempSync(join(tmpdir(), 'bb-boolean-env-')),
				PM2_AUTOSCALE_ENABLED: REFUSED_SPELLING,
			});

			expect(run.code, run.output).toBe(1);
			expect(run.output).toContain(refusal('PM2_AUTOSCALE_ENABLED'));

			// Every line the autoscaler logs carries this prefix, and it runs
			// until it is stopped: a check anywhere later than its first
			// statement would have had to outlive a connection, and would
			// leave the lines that connection logs behind it.
			expect(run.output).not.toContain('[autoscale]');
		}, 120_000);
	});

	it('a spelling the cast can read boots', async () => {
		const env = cloneDeep(config.envs);
		const port = await getPort();

		env[vendor]['PORT'] = String(port);
		env[vendor]['PM2_AUTOSCALE_ENABLED'] = 'false';
		env[vendor]['PM2_AUTOSCALE_DRILL_ENABLED'] = 'false';
		env[vendor]['CACHE_NAMESPACE'] = `blackbox-boolean-env-${vendor}`;

		const instance = spawn('node', [cliScript, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		try {
			await awaitDirectusConnection(port);

			const response = await request(getUrl(vendor, env))
				.get('/server/ping');

			expect(response.status).toBe(200);

			// A check that refused every value would pass the arms above and
			// take the deployment down with it.
			expect(instance.exitCode).toBeNull();
		}
		finally {
			instance.kill();
		}
	}, 120_000);
});
