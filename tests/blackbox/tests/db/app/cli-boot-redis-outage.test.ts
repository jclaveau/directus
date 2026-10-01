import config, { paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const cliScript = require.resolve(paths.cli);

// A port nothing is listening on, so the client never connects rather than
// losing a connection it had.
const DEAD_PORT = 6111;

type Run = { code: number | null; output: string };

function runCli(vendor: string, args: string[]): Promise<Run> {
	return new Promise((resolve) => {
		const cli = spawn('node', [cliScript, ...args], {
			cwd: paths.cwd,
			env: {
				...process.env,
				...config.envs[vendor],
				LOG_LEVEL: 'error',
				REDIS_ENABLED: 'true',
				// A connection string wins over the host and port below, so the
				// dead port only holds while there is none to prefer.
				REDIS: '',
				REDIS_HOST: '127.0.0.1',
				REDIS_PORT: String(DEAD_PORT),
				// No reconnection at all, so the client ends on the first refused
				// connection and rejects what it was holding there and then.
				// Tuned instead — a short backoff and a small retry budget — the
				// rejection would be due after a delay the boot has to outlast,
				// and the line this arm reads would come or not come depending
				// on which of the two finished first.
				REDIS_RETRY_MAX_ATTEMPTS: '0',
			},
		});

		let output = '';

		cli.stdout.on('data', (chunk) => (output += String(chunk)));
		cli.stderr.on('data', (chunk) => (output += String(chunk)));

		cli.on('close', (code) => resolve({ code, output }));
	});
}

// Building the CLI loads the extensions, and they subscribe over the bus
// without awaiting it. Against an unreachable Redis that subscription is
// rejected once the client stops retrying, and Node ends a process on a
// rejection nothing awaited — so every command, `start` and `autoscale`
// included, has to be guarded before the CLI is built rather than inside the
// command it dispatches to.
describe('The CLI boots through a Redis outage', () => {
	it.each(vendors)('%s', async (vendor) => {
		const run = await runCli(vendor, ['count', 'directus_users']);

		expect(run.code, run.output).toBe(0);
		expect(run.output).toMatch(/^\d+$/m);

		// The rejection is what the guard is here for, so a run that never met
		// one proves nothing: this says the boot really did meet it and carried
		// on. A change that stops the extensions floating that promise retires
		// this line rather than passing quietly without it.
		expect(run.output).toContain('Unhandled promise rejection');
	}, 60_000);
});
