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
 */
const OUTSTANDING_MIGRATION = '20990101A-never-applied.js';

describe('/server', () => {
	const directusInstances = {} as Record<Vendor, ChildProcess>;
	const ports = {} as Record<Vendor, number>;
	const directories = {} as Record<Vendor, string>;

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

			const port = await getPort();
			env[vendor].PORT = String(port);

			directories[vendor] = directory;
			ports[vendor] = port;

			directusInstances[vendor] = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

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
					observedValue: '20990101A',
					output: 'Database migrations have not all been run',
				},
			]);
		});

		it.each(vendors)('%s tells a non-admin only the status', async (vendor) => {
			const response = await request(`http://127.0.0.1:${ports[vendor]}`)
				.get('/server/health')
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			expect(response.statusCode).toBe(503);
			expect(response.body).toEqual({ status: 'error' });
		});
	});
});
