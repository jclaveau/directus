import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The two ways the cache audit runs without anyone calling the endpoint
// (jclaveau/directus#498): `directus cache audit` from a shell, which boots its
// own copy of the app and reads the cache the running node fills, and
// CACHE_AUDIT_SCHEDULE, which runs it inside the node itself and lands what it
// finds on the cache page as anomalies.
//
// The CLI arm is its own process: what has to hold is its exit code, that its
// report describes the running node's entries, and that booting it neither
// flushes those entries nor fills any of its own.

const ROWS = 'test_cache_audit_cli_rows';
const CLOCK = 'test_cache_audit_cli_clock';

const cacheStatusHeader = 'x-cache-status';
const SETTLE_ATTEMPTS = 30;
const SETTLE_DELAY_MS = 500;

describe('`directus cache audit` and the scheduled audit', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);

		env[vendor]['REDIS'] = 'redis://localhost:6108';
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['CACHE_NAMESPACE'] = `directus-cache-audit-cli-${vendor}`;
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';
		env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '* * * * * *';

		// The env-side ignore list, read by the audit wherever it runs: the clock
		// hook's stamp is what it names, so the clock entry audits fresh here.
		env[vendor]['CACHE_AUDIT_IGNORE_PATHS'] = '/data/*/served_at';

		// A node auditing itself every other second, on its own namespace so the
		// CLI arm's counts stay its own.
		const scheduledEnv = cloneDeep(env);
		scheduledEnv[vendor]['CACHE_NAMESPACE'] = `directus-cache-audit-cron-${vendor}`;
		scheduledEnv[vendor]['CACHE_AUDIT_SCHEDULE'] = '*/2 * * * * *';

		let instance: ChildProcess;
		let scheduled: ChildProcess;
		let db: Knex;
		let url: string;
		let scheduledUrl: string;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROWS,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'amount', type: 'string', meta: {} },
						],
					},
					{
						collection: CLOCK,
						meta: {},
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await CreateItem(vendor, {
				collection: ROWS,
				item: [
					{ owner: 'acme', amount: '1' },
					{ owner: 'globex', amount: '2' },
					// The scheduled node's own slice, so what its audit flags is
					// told apart from what the CLI arm flagged on the same path.
					{ owner: 'initech', amount: '3' },
				],
			});

			await CreateItem(vendor, { collection: CLOCK, item: { label: 'tick' } });

			const port = await getPort();
			env[vendor].PORT = String(port);

			const scheduledPort = await getPort();
			scheduledEnv[vendor].PORT = String(scheduledPort);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			scheduled = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: scheduledEnv[vendor],
			});

			db = knex(config.knexConfig[vendor]!);
			url = getUrl(vendor, env);
			scheduledUrl = getUrl(vendor, scheduledEnv);

			await Promise.all([
				awaitDirectusConnection(port),
				awaitDirectusConnection(scheduledPort),
			]);
		}, 60_000);

		afterAll(async () => {
			instance.kill();
			scheduled.kill();
			await db.destroy();
			await DeleteCollection(vendor, { collection: ROWS });
			await DeleteCollection(vendor, { collection: CLOCK });
		});

		// Its own process, with the running node's env: the shell the command is
		// for, not an in-process call.
		function runCacheAudit(
			args: string[] = [],
		): Promise<{ code: number | null; output: string }> {
			return new Promise((resolve) => {
				const cli = spawn('node', [paths.cli, 'cache', 'audit', ...args], {
					cwd: paths.cwd,
					env: { ...env[vendor], LOG_LEVEL: 'error' },
				});

				let output = '';

				cli.stdout.on('data', (chunk) => (output += String(chunk)));
				cli.stderr.on('data', (chunk) => (output += String(chunk)));

				cli.on('exit', (code) => resolve({ code, output }));
			});
		}

		// The report is the last thing the command prints, after whatever the
		// boot logged ahead of it.
		function reportIn(output: string): any {
			const start = output.indexOf('{\n  "scanned"');
			expect(start).toBeGreaterThanOrEqual(0);

			return JSON.parse(output.slice(start));
		}

		function readOwner(owner: string, from = url) {
			return request(from)
				.get(`/items/${ROWS}`)
				.query(`filter[owner][_eq]=${owner}`)
				.set('Authorization', auth);
		}

		async function warm(read: () => request.Test) {
			await read();
			const warmed = await read();
			expect(warmed.headers[cacheStatusHeader]).toBe('HIT');
		}

		async function clearCache(from = url) {
			await request(from).post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		// The descriptors the audit joins land on the one-second drain: wait for
		// the running node to describe every entry before the CLI reads them.
		async function settled(from = url) {
			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				const response = await request(from)
					.post('/utils/cache/audit')
					.set('Authorization', auth);

				const report = response.body.data;

				const undescribed = report.findings.some((finding: any) => {
					return finding.reason === 'no_descriptor';
				});

				if (report.scanned > 0 && !undescribed) {
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
			}
		}

		it(oneLine`
			exits 0 over a cache the database still agrees with, and leaves that
			cache as it found it
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			await settled();

			const { code, output } = await runCacheAudit(['--json']);

			expect(code).toBe(0);

			const report = reportIn(output);

			expect(report.scanned).toBe(2);
			expect(report.counts.fresh).toBe(2);

			// Booting a second copy of the app flushed nothing, and its replays
			// filled nothing of their own.
			const stillHeld = await readOwner('acme');
			expect(stillHeld.headers[cacheStatusHeader]).toBe('HIT');

			const after = await request(url)
				.post('/utils/cache/audit')
				.set('Authorization', auth);

			expect(after.body.data.scanned).toBe(2);
		}, 90_000);

		it(oneLine`
			exits 1 on a stale entry, naming it in the report
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await settled();

			await db(ROWS).where({ owner: 'acme' })
				.update({ amount: '9' });

			const { code, output } = await runCacheAudit();

			expect(code).toBe(1);
			expect(output).toMatch(/1 entries audited in \d+ms/);
			expect(output).toContain(`stale  GET /items/${ROWS}?filter[owner][_eq]=acme`);
			expect(output).toContain('diff /data/0/amount');
			expect(output).toContain('no purge covered it since the fill');
		}, 90_000);

		it(oneLine`
			evicts what it found under --purge, so the node answers the database
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await settled();

			await db(ROWS).where({ owner: 'acme' })
				.update({ amount: '10' });

			const { code, output } = await runCacheAudit(['--json', '--purge']);

			expect(code).toBe(1);
			expect(reportIn(output).evicted).toBe(1);

			const refilled = await readOwner('acme');

			expect(refilled.headers[cacheStatusHeader]).toBe('MISS');
			expect(refilled.body.data[0].amount).toBe('10');
		}, 90_000);

		it(oneLine`
			exits 2 under --strict, and 0 without, over an entry it cannot replay
		`, async () => {
			await clearCache();
			await warm(() => readOwner('globex'));
			await settled();

			// Drops the descriptors while the entry lives on: nothing to replay
			// it from.
			await request(url)
				.post('/utils/cache/stats/truncate')
				.set('Authorization', auth);

			const lenient = await runCacheAudit(['--json']);

			expect(lenient.code).toBe(0);

			expect(reportIn(lenient.output).findings[0]).toMatchObject({
				verdict: 'unreplayable',
				reason: 'no_descriptor',
			});

			const strict = await runCacheAudit(['--strict']);

			expect(strict.code).toBe(2);
		}, 120_000);

		it(oneLine`
			stops at --limit, narrows to --collection, and reads the ignore list
			off the environment
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));

			// The clock hook stamps every read of CLOCK with a nanosecond clock, so
			// this entry is time_varying unless CACHE_AUDIT_IGNORE_PATHS covers it.
			await warm(() => {
				return request(url).get(`/items/${CLOCK}`)
					.set('Authorization', auth);
			});

			await settled();

			const capped = await runCacheAudit(['--json', '--limit', '1']);

			expect(capped.code).toBe(0);
			expect(reportIn(capped.output).scanned).toBe(1);

			// A fresh entry leaves no finding, so the narrowing shows in the counts:
			// one collection holds one entry, the other two.
			const clock = await runCacheAudit(['--json', '--collection', CLOCK]);

			expect(clock.code).toBe(0);
			expect(reportIn(clock.output).scanned).toBe(1);
			expect(reportIn(clock.output).counts.fresh).toBe(1);

			const rows = await runCacheAudit(['--json', '--collection', ROWS]);

			expect(reportIn(rows.output).scanned).toBe(2);

			const whole = await runCacheAudit(['--json']);

			expect(reportIn(whole.output).counts).toMatchObject({
				fresh: 3,
				time_varying: 0,
			});
		}, 120_000);

		it(oneLine`
			the scheduled audit lands a stale entry on the cache page by itself
		`, async () => {
			await clearCache(scheduledUrl);
			await warm(() => readOwner('initech', scheduledUrl));

			await db(ROWS).where({ owner: 'initech' })
				.update({ amount: '11' });

			// Nothing calls the endpoint: the node's own schedule replays the
			// entry, and the finding drains through the anomaly stream.
			let flagged: any;

			for (let attempt = 0; attempt < SETTLE_ATTEMPTS && !flagged; attempt++) {
				const listed = await request(scheduledUrl)
					.get('/utils/cache/anomalies')
					.set('Authorization', auth);

				flagged = listed.body.data.find((row: any) => {
					return row.reason === 'stale_entry'
						&& row.url === `/items/${ROWS}?filter[owner][_eq]=initech`;
				});

				if (!flagged) {
					await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
				}
			}

			expect(flagged).toBeDefined();
			expect(flagged.sample).toContain('/data/0/amount');

			// Found, not fixed: the schedule reports, the entry stays for a purge
			// or an operator.
			const stillHeld = await readOwner('initech', scheduledUrl);
			expect(stillHeld.headers[cacheStatusHeader]).toBe('HIT');
		}, 90_000);
	});
});
