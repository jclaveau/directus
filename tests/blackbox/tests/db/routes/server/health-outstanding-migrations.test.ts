import config, { paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A migration file the database has never recorded, staged in an extensions path
 * of this instance's own so no other instance in the run can see it. That is what
 * the boot guard is meant to notice, and the only way to reach it from outside:
 * the watch stops as soon as it reads a clean database, so a correctly migrated
 * instance cannot be pushed into this state after the fact.
 *
 * The version has to be one no other suite records, since they all share the
 * vendor's database: `migration-transaction` applies `20990101A` and `20990102A`
 * and only removes them once its own file is done, so a shard packing the two
 * side by side boots this instance against a database that has already recorded
 * the migration it is meant to be missing.
 */
const OUTSTANDING_MIGRATION = '20991231A-never-applied.js';

describe('/server', () => {
	const directusInstances = {} as Record<Vendor, ChildProcess>;
	const ports = {} as Record<Vendor, number>;
	const directories = {} as Record<Vendor, string>;
	const logs = {} as Record<Vendor, string>;

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			const directory = await mkdtemp(
				join(tmpdir(), 'directus-blackbox-migrations-'),
			);

			await mkdir(join(directory, 'migrations'));

			await writeFile(
				join(directory, 'migrations', OUTSTANDING_MIGRATION),
				'export async function up() {}\n',
			);

			const env = cloneDeep(config.envs) as { [vendor: string]: Env };
			env[vendor]['EXTENSIONS_PATH'] = directory;
			env[vendor]['MIGRATIONS_WAIT_INTERVAL'] = '100ms';
			env[vendor]['MIGRATIONS_WAIT_TIMEOUT'] = '2s';

			// The suite runs at `error`, and a held job reports at `warn`.
			env[vendor]['LOG_LEVEL'] = 'warn';

			// The job the incident was found on, on a cadence that ticks inside the
			// test rather than every ten seconds. It holds before it touches Redis,
			// so an unreachable one would not mask the hold — but a configured one
			// is what gets the job registered at all.
			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = '6108';
			env[vendor]['CACHE_STATS_ENABLED'] = 'true';
			env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '* * * * * *';

			const port = await getPort();
			env[vendor].PORT = String(port);

			directories[vendor] = directory;
			ports[vendor] = port;

			directusInstances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			logs[vendor] = '';

			for (const stream of [
				directusInstances[vendor].stdout,
				directusInstances[vendor].stderr,
			]) {
				stream?.on('data', (chunk: Buffer) => {
					logs[vendor] += String(chunk);
				});
			}

			promises.push(awaitDirectusConnection(port));
		}

		await Promise.all(promises);
	}, 180_000);

	afterAll(async () => {
		for (const vendor of vendors) {
			directusInstances[vendor].kill();
			await rm(directories[vendor]!, { recursive: true, force: true });
		}
	});

	describe('GET /health with an outstanding migration', () => {
		it.each(vendors)('%s still serves other routes', async (vendor) => {
			// The guard deliberately does not stop the server listening: refusing the
			// port would take a live deployment down on any restart landing in this
			// state, with no healthcheck watching to put it back.
			const response = await request(`http://127.0.0.1:${ports[vendor]}`).get('/server/ping');

			expect(response.statusCode).toBe(200);
			expect(response.text).toBe('pong');
		});

		it.each(vendors)('%s reports unhealthy', async (vendor) => {
			const response = await request(`http://127.0.0.1:${ports[vendor]}`)
				.get('/server/health')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(503);
			expect(response.body.status).toBe('error');
		});

		it.each(vendors)('%s names the migration to an admin', async (vendor) => {
			const response = await request(`http://127.0.0.1:${ports[vendor]}`)
				.get('/server/health')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.body.checks.migrations).toEqual([
				{
					componentType: 'datastore',
					status: 'error',
					observedValue: '20991231A',
					output: 'Database migrations have not all been run',
				},
			]);
		});

		it.each(vendors)('%s holds its scheduled jobs meanwhile', async (vendor) => {
			// The gate this pins is not the health route: a build the database has
			// not caught up with must not write through a schema it does not match,
			// and `scheduleSynchronizedJob` hands each tick to one node cluster-wide,
			// so a node that declines after claiming spends the slot for everyone.
			const held = /holding job \\?"cache-stats\\?"/;
			let waited = 0;

			while (!held.test(logs[vendor]!) && waited < 20_000) {
				await new Promise((resolve) => {
					setTimeout(resolve, 250);
				});

				waited += 250;
			}

			expect(logs[vendor]).toMatch(held);
		}, 30_000);

		it.each(vendors)('%s tells a non-admin only the status', async (vendor) => {
			const response = await request(`http://127.0.0.1:${ports[vendor]}`)
				.get('/server/health')
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			expect(response.statusCode).toBe(503);
			expect(response.body).toEqual({ status: 'error' });
		});
	});
});
