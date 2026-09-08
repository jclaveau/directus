import config, { getUrl, paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import type { ProcessesReport } from '@directus/types';
import { ChildProcess, execFileSync, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The autoscaler runs as a pm2 app rather than a pm2 module, which buys it the
// fork's env, Redis and logger — and costs it the one thing a module gets for
// free: modules are kept out of `pm2 list`, apps are not. The processes report
// is built on that list, so an autoscaler that did not describe itself would sit
// on the Processes page for ever as a process that never answers, which is what
// that page means by a worker crash-looping too fast to reply.
//
// The rig is the smallest one that can tell: a plain Directus to collect and
// serve the endpoint, and a pm2 daemon whose only app is the autoscaler, both on
// the same Redis bus and named as the same service.
const pm2Bin = join(paths.cwd, '..', '..', 'api', 'node_modules', '.bin', 'pm2');
const cliScript = `${paths.cli}.js`;
const autoscalerAppName = 'autoscaler-blackbox';

describe('The autoscaler describes itself to the processes report', () => {
	const collectors = {} as Record<string, ChildProcess>;
	const envs = {} as Record<string, Record<string, string>>;
	const pm2Homes = {} as Record<string, string>;
	const serviceNames = {} as Record<string, string>;

	beforeAll(async () => {
		const waits = [];

		for (const vendor of vendors) {
			const env = cloneDeep(config.envs)[vendor]!;
			const port = await getPort();

			serviceNames[vendor] = `autoscale-processes-${vendor}`;
			env['PORT'] = String(port);
			env['REDIS_HOST'] = 'localhost';
			env['REDIS_PORT'] = '6108';
			env['PROCESSES_SERVICE_NAME'] = serviceNames[vendor]!;
			env['RAILWAY_REPLICA_ID'] = `${vendor}-collector`;
			// Generous next to the 750ms default: a loaded runner must not turn a
			// slow reply into a "the autoscaler never answered" assertion failure.
			env['PROCESSES_COLLECT_TIMEOUT'] = '3s';
			envs[vendor] = env;

			collectors[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env,
			});

			// Its own PM2_HOME so this daemon is this suite's alone. `mkdtemp` under
			// the system temp dir keeps the path short: PM2's daemon opens a Unix
			// socket in it, and past ~108 characters the bind fails and `pm2 start`
			// hangs with no error at all.
			pm2Homes[vendor] = mkdtempSync(join(tmpdir(), `bb-autoscale-rep-${vendor}-`));

			execFileSync(
				pm2Bin,
				[
					'start',
					cliScript,
					'--name', autoscalerAppName,
					// Everything past the separator is the CLI's own argv.
					'--', 'autoscale',
				],
				{
					cwd: paths.cwd,
					env: {
						...env,
						PM2_HOME: pm2Homes[vendor]!,
						RAILWAY_REPLICA_ID: `${vendor}-autoscaler`,
						// There is no pool here to manage. The autoscaler reports
						// itself either way, and finding no such app is a case it
						// already has to survive.
						PM2_AUTOSCALE_APP_NAME: 'no-such-app',
					},
					stdio: 'pipe',
				},
			);

			waits.push(awaitDirectusConnection(port));
		}

		await Promise.all(waits);
	}, 300_000);

	afterAll(() => {
		for (const vendor of vendors) {
			collectors[vendor]?.kill();

			try {
				execFileSync(pm2Bin, ['kill'], {
					env: { ...envs[vendor], PM2_HOME: pm2Homes[vendor]! },
					stdio: 'pipe',
				});
			}
			catch {
				// The daemon dies with the job either way; a failed kill must not
				// red an otherwise passing suite.
			}
		}
	});

	it.each(vendors)('%s', async (vendor) => {
		const response = await request(getUrl(vendor, { [vendor]: envs[vendor] }))
			.get('/utils/processes')
			.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

		expect(response.statusCode).toBe(200);

		const report: ProcessesReport = response.body.data;

		const service = report.services
			.find((candidate) => candidate.service === serviceNames[vendor]);

		expect(service, 'the autoscaler shares the collector\'s service').toBeDefined();

		const replica = service!.replicas
			.find((candidate) => candidate.replicaId === `${vendor}-autoscaler`);

		expect(replica, 'the autoscaler is a replica of its own').toBeDefined();
		expect(replica!.processes).toHaveLength(1);

		const node = replica!.processes[0]!;

		// The whole point: listed by the supervisor *and* answering for itself.
		// Before it reported, this read false and the page showed it as a worker
		// too broken to reply.
		expect(node.responding).toBe(true);
		expect(node.name).toBe(autoscalerAppName);
		expect(node.nodeId).not.toBeNull();
		expect(node.pmId).not.toBeNull();

		// Answering means answering in full: it is a process like any other.
		expect(node.runtime!.rssBytes).toBeGreaterThan(0);
		expect(node.runtime!.nodeVersion).toBe(process.version);
		expect(node.supervisor!.status).toBe('online');
	}, 120_000);
});
