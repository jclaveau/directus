import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import type { PgBouncerInstance, PgBouncerReport } from '@directus/types';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The compose pgbouncer fronts the `postgres` service alone, with three pools
// over the same database: free (pool_size=1), premium (4) and default (50).
const PGBOUNCER_VENDORS = vendors.filter((vendor) => vendor === 'postgres');

const PGBOUNCER_PORT = '6109';

/**
 * How long the saturating queries are held while the report is read. Wide enough
 * that a loaded runner still lands its reads inside the window.
 */
const SATURATION_SECONDS = 12;

describe('PgBouncer Report Tests', () => {
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };

	const envs = {} as Record<Vendor, { envReport: Env; envDisabled: Env }>;

	beforeAll(async () => {
		const promises = [];

		for (const vendor of PGBOUNCER_VENDORS) {
			// Two tiers through the one pooler, so the report has both a pool this
			// deployment uses and a second one to keep separate from it.
			const envReport = cloneDeep(config.envs);
			envReport[vendor]['DB_CONNECTIONS'] = 'free,premium';
			envReport[vendor]['DB_CONNECTION_FREE_PORT'] = PGBOUNCER_PORT;
			envReport[vendor]['DB_CONNECTION_FREE_DATABASE'] = 'directus_free';
			envReport[vendor]['DB_CONNECTION_FREE_PRIORITY'] = '100';
			envReport[vendor]['DB_CONNECTION_FREE_POOL__MAX'] = '8';
			envReport[vendor]['DB_CONNECTION_PREMIUM_PORT'] = PGBOUNCER_PORT;
			envReport[vendor]['DB_CONNECTION_PREMIUM_DATABASE'] = 'directus_premium';
			envReport[vendor]['DB_CONNECTION_PREMIUM_POOL__MAX'] = '8';
			envReport[vendor]['PGBOUNCER_REPORT_ENABLED'] = 'true';
			envReport[vendor]['PGBOUNCER_CONNECTIONS'] = 'free,premium';

			// The same registry, with the report turned off: the endpoint has to be
			// absent, not merely refusing.
			const envDisabled = cloneDeep(envReport);
			envDisabled[vendor]['PGBOUNCER_REPORT_ENABLED'] = 'false';

			const [reportPort, disabledPort] = await Promise.all([
				getPort(),
				getPort(),
			]);

			envReport[vendor].PORT = String(reportPort);
			envDisabled[vendor].PORT = String(disabledPort);

			envs[vendor] = { envReport, envDisabled };

			directusInstances[vendor] = [envReport, envDisabled].map((env) => {
				return spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: env[vendor],
				});
			});

			promises.push(awaitDirectusConnection(reportPort));
			promises.push(awaitDirectusConnection(disabledPort));
		}

		await Promise.all(promises);
	}, 300_000);

	afterAll(() => {
		for (const vendor of PGBOUNCER_VENDORS) {
			for (const instance of directusInstances[vendor] ?? []) {
				instance.kill();
			}
		}
	});

	// No pgbouncer vendor in this run (e.g. a sqlite3-only shard) → nothing to
	// read. Register a skipped test so the file isn't an empty suite.
	if (PGBOUNCER_VENDORS.length === 0) {
		it.skip('no pgbouncer vendor in this run', () => {
			// nothing to report on
		});
	}

	function readReport(vendor: Vendor, token: string, details?: string) {
		const pending = request(getUrl(vendor, envs[vendor].envReport))
			.get('/utils/pgbouncer')
			.set('Authorization', `Bearer ${token}`);

		return details === undefined
			? pending
			: pending.query({ details });
	}

	function soleInstance(report: PgBouncerReport): PgBouncerInstance {
		expect(report.instances).toHaveLength(1);

		return report.instances[0]!;
	}

	function poolNamed(instance: PgBouncerInstance, database: string) {
		return instance.pools.find((pool) => pool.database === database);
	}

	describe('Refuses the report to anyone but an admin', () => {
		it.each(PGBOUNCER_VENDORS)('%s', async (vendor) => {
			const response = await readReport(vendor, USER.APP_ACCESS.TOKEN);

			expect(response.statusCode).toBe(403);
		});
	});

	describe('Removes the endpoint where the report is turned off', () => {
		it.each(PGBOUNCER_VENDORS)('%s', async (vendor) => {
			const response = await request(getUrl(vendor, envs[vendor].envDisabled))
				.get('/utils/pgbouncer')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(404);
		});
	});

	describe('Reads the live pools of the pooler it is configured against', () => {
		it.each(PGBOUNCER_VENDORS)('%s', async (vendor) => {
			const response = await readReport(vendor, USER.ADMIN.TOKEN);

			expect(response.statusCode).toBe(200);

			const instance = soleInstance(response.body.data);

			// Both tiers share one pooler, so they fold into a single instance that
			// accounts for them both.
			expect(instance.id).toBe(`127.0.0.1:${PGBOUNCER_PORT}`);
			expect(instance.reachable).toBe(true);
			expect(instance.error).toBeNull();
			expect(instance.version).toMatch(/^PgBouncer /);
			expect(instance.connections).toEqual(['free', 'premium']);

			// Every configured database is listed, including the one this deployment
			// does not use — and the console's own is not one of them.
			expect(instance.pools.map((pool) => pool.database)).toEqual([
				'directus_default',
				'directus_free',
				'directus_premium',
			]);

			expect(poolNamed(instance, 'directus_free')).toMatchObject({
				poolSize: 1,
				connections: ['free'],
				paused: false,
				disabled: false,
			});

			expect(poolNamed(instance, 'directus_premium')).toMatchObject({
				poolSize: 4,
				connections: ['premium'],
			});

			// A pool no connection of this deployment routes to still shows, with
			// nothing claimed about who uses it.
			expect(poolNamed(instance, 'directus_default')).toMatchObject({
				poolSize: 50,
				connections: [],
			});
		});
	});

	describe('Carries the limits a queue is argued from', () => {
		it.each(PGBOUNCER_VENDORS)('%s', async (vendor) => {
			const response = await readReport(vendor, USER.ADMIN.TOKEN);
			const { limits } = soleInstance(response.body.data);

			// The mounted config sets both away from their defaults, which is what
			// makes the tiny pool queue and then give up after a second.
			expect(limits).toContainEqual(
				expect.objectContaining({ key: 'query_wait_timeout', value: '1' }),
			);

			expect(limits).toContainEqual(
				expect.objectContaining({
					key: 'max_client_conn',
					value: '1000',
					isDefault: false,
				}),
			);

			expect(limits).toContainEqual(
				expect.objectContaining({ key: 'pool_mode', value: 'transaction' }),
			);

			// Nothing outside the curated set rides along.
			expect(limits.map((limit) => limit.key)).not.toContain('auth_file');
		});
	});

	describe('Shows a saturated pool while it is saturated', () => {
		it.each(PGBOUNCER_VENDORS)('%s', async (vendor) => {
			// The probe fires its sleeping queries and answers straight away without
			// awaiting them, so they are still held for `sleep` seconds after this
			// resolves — that is the window the report is read in.
			const saturation = await request(getUrl(vendor, envs[vendor].envReport))
				.post('/db-connection-probe/pools-under-load')
				.send({
					saturate: [{ connection: 'free', concurrency: 2 }],
					probe: [],
					sleep: SATURATION_SECONDS,
					onProbeError: 'report',
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(saturation.statusCode).toBe(200);

			// Poll for the state being asserted rather than sleeping a guessed
			// interval — a loaded runner takes longer to get a query in flight, and
			// the window closes when the sleeps end.
			let instance!: PgBouncerInstance;

			for (let attempt = 0; attempt < 20; attempt++) {
				const response = await readReport(
					vendor,
					USER.ADMIN.TOKEN,
					'pools,stats,clients,servers',
				);

				expect(response.statusCode).toBe(200);
				instance = soleInstance(response.body.data);

				if (poolNamed(instance, 'directus_free')!.serversActive > 0) {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 250));
			}

			const free = poolNamed(instance, 'directus_free')!;

			// The one server the pool is allowed is busy running the held query.
			expect(free.serversActive).toBe(1);
			expect(free.clientsActive).toBeGreaterThanOrEqual(1);

			// And the clients are attributable: every connection Directus opens
			// announces the node and the pool it belongs to.
			const clients = instance.clients.filter((client) => {
				return client.database === 'directus_free';
			});

			expect(clients.length).toBeGreaterThanOrEqual(1);

			expect(clients.every((client) => {
				return /^directus:[\w-]+:free$/.test(client.applicationName);
			})).toBe(true);

			// The backend running it is named, which is what ties a pooled server
			// back to a row of pg_stat_activity.
			const servers = instance.servers.filter((server) => {
				return server.database === 'directus_free';
			});

			expect(servers).toHaveLength(1);
			expect(servers[0]!.remotePid).toBeGreaterThan(0);

			// The queue that formed is not a live reading, so it is read off the
			// counter that keeps it: waiting time only accrues when a client waited.
			// The second saturating client queues behind the first and gives up at
			// `query_wait_timeout`, which is a second — so by now it has accrued.
			const after = await readReport(vendor, USER.ADMIN.TOKEN);

			const stats = soleInstance(after.body.data).stats.find((row) => {
				return row.database === 'directus_free';
			});

			expect(stats!.totalWaitTimeUs).toBeGreaterThan(0);
		}, 120_000);
	});

	describe('Asks the pooler only for the parts it was asked for', () => {
		it.each(PGBOUNCER_VENDORS)('%s', async (vendor) => {
			const response = await readReport(vendor, USER.ADMIN.TOKEN, 'pools');

			expect(response.statusCode).toBe(200);
			expect(response.body.data.details).toEqual(['pools']);

			const instance = soleInstance(response.body.data);

			expect(instance.pools.length).toBeGreaterThan(0);
			expect(instance.clients).toEqual([]);
			expect(instance.servers).toEqual([]);
			expect(instance.stats).toEqual([]);
			expect(instance.limits).toEqual([]);
		});
	});
});
