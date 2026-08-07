import config, { getUrl, paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Boots directus the way prod does: pm2-runtime in cluster mode, not a bare `node
// cli.js start`. In cluster mode pm2/lib/ProcessContainer.js re-invokes the worker
// with the ecosystem args followed by the config path and another copy of the args,
// so `directus start` effectively runs as `start <ecosystem path> start` — two
// excess positionals. Without allowExcessArguments() on the start command, commander
// 14 rejects them, the worker exits 1, pm2 restart-loops, and the port never opens.
const require = createRequire(import.meta.url);
const pm2Runtime = require.resolve('pm2/bin/pm2-runtime');

// pm2 checks fs.existsSync(script), so it needs the real file — `paths.cli` is
// extensionless and only `node` would resolve it to cli.js.
const cliScript = require.resolve(paths.cli);

describe('CLI start boots under pm2-runtime cluster mode', () => {
	const env = cloneDeep(config.envs);
	const runtimes = {} as Record<string, ChildProcess>;
	const pm2Homes: string[] = [];

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			const port = await getPort();
			env[vendor].PORT = String(port);

			const pm2Home = mkdtempSync(join(tmpdir(), `pm2-${vendor}-`));
			pm2Homes.push(pm2Home);

			const ecosystem = join(pm2Home, 'ecosystem.config.cjs');

			writeFileSync(
				ecosystem,
				`module.exports = ${JSON.stringify({
					apps: [
						{
							name: 'directus',
							script: cliScript,
							args: 'start',
							exec_mode: 'cluster',
							instances: 1,
							env: env[vendor],
						},
					],
				})};\n`,
			);

			runtimes[vendor] = spawn('node', [pm2Runtime, 'start', ecosystem], {
				cwd: paths.cwd,
				env: { ...process.env, PM2_HOME: pm2Home },
			});

			promises.push(awaitDirectusConnection(port));
		}

		await Promise.all(promises);
	}, 60_000);

	afterAll(() => {
		for (const vendor of vendors) {
			runtimes[vendor]?.kill('SIGINT');
		}

		for (const pm2Home of pm2Homes) {
			rmSync(pm2Home, { recursive: true, force: true });
		}
	});

	it.each(vendors)('%s serves requests', async (vendor) => {
		const response = await request(getUrl(vendor, env))
			.get('/server/ping')
			.expect(200);

		expect(response.text).toBe('pong');
	});
});
