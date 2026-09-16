import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	CreateUser,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { ROLE, USER } from '@common/variables';
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

		// A node auditing itself every other second, over the same cache: the
		// descriptors are one table for the database, so a node that could not
		// hold an entry would retire it for the node that does. Spawned for
		// its own cases alone, once the CLI arm's are done, so its runs never
		// hold the one in-flight claim when the CLI asks.
		const scheduledEnv = cloneDeep(env);
		scheduledEnv[vendor]['CACHE_AUDIT_SCHEDULE'] = '*/2 * * * * *';

		// Keyed by the request itself rather than its digest: a key the history
		// has to hold whole, however long the request was.
		scheduledEnv[vendor]['CACHE_KEY_HASH_ENABLED'] = 'false';

		let instance: ChildProcess;
		let db: Knex;
		let url: string;

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

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			db = knex(config.knexConfig[vendor]!);
			url = getUrl(vendor, env);

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();
			await db.destroy();
			await DeleteCollection(vendor, { collection: ROWS });
			await DeleteCollection(vendor, { collection: CLOCK });
		});

		// Its own process, with the running node's env: the shell the command is
		// for, not an in-process call.
		function runCacheAudit(
			args: string[] = [],
			extraEnv: Record<string, string> = {},
		): Promise<{ code: number | null; output: string }> {
			return new Promise((resolve) => {
				const cli = spawn('node', [paths.cli, 'cache', 'audit', ...args], {
					cwd: paths.cwd,
					env: { ...env[vendor], LOG_LEVEL: 'error', ...extraEnv },
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
			const start = output.indexOf('{\n  "id"');
			expect(start).toBeGreaterThanOrEqual(0);

			return JSON.parse(output.slice(start));
		}

		function readOwner(owner: string, from = url, token = USER.ADMIN.TOKEN) {
			return request(from)
				.get(`/items/${ROWS}`)
				.query(`filter[owner][_eq]=${owner}`)
				.set('Authorization', `Bearer ${token}`);
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

		// The audit takes its entries off the descriptors, which land on the
		// one-second drain: wait for the running node to describe every entry
		// warmed before the CLI reads them.
		async function settled(warmed = 1) {
			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				const response = await request(url)
					.post('/utils/cache/audit')
					.set('Authorization', auth);

				if (response.body.data.scanned >= warmed) {
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
			await settled(2);

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
			takes CACHE_AUDIT_LIMIT as the limit of a run that names none, and
			resumes behind it on the next
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			await settled(2);

			const capped = { CACHE_AUDIT_LIMIT: '1' };

			const first = reportIn((await runCacheAudit(['--json'], capped)).output);
			expect(first.scanned).toBe(1);

			// Recorded as the limit the run had, not as one it never named.
			const recorded = await request(url)
				.get(`/utils/cache/audits/${first.id}`)
				.set('Authorization', auth);

			expect(recorded.body.data.options.limit).toBe(1);

			const second = reportIn((await runCacheAudit(['--json'], capped)).output);
			expect(second.scanned).toBe(1);

			// A named limit is the run's own.
			const named = reportIn(
				(await runCacheAudit(['--json', '--limit', '2'], capped)).output,
			);

			expect(named.scanned).toBe(2);
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

			// Recorded like every other run, under the surface that ran it.
			const recorded = await db('directus_cache_audits')
				.where({ trigger: 'cli' })
				.orderBy('id', 'desc')
				.first();

			expect(recorded).toMatchObject({ scanned: 1, stale: 1, evicted: 0 });
			expect(recorded.finished_at).not.toBeNull();

			const findings = await db('directus_cache_audit_findings')
				.where({ audit: recorded.id });

			expect(findings).toHaveLength(1);

			expect(findings[0]).toMatchObject({
				verdict: 'stale',
				url: `/items/${ROWS}?filter[owner][_eq]=acme`,
				collection: ROWS,
			});
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
			const token = `cache-audit-cli-gone-${vendor}`;

			const gone = await CreateUser(vendor, {
				token,
				email: `cache-audit-cli-gone-${vendor}@example.com`,
				roleName: ROLE.ADMIN.NAME,
			});

			await clearCache();
			await warm(() => readOwner('globex', url, token));
			await settled();

			// The user goes behind the API, so the entry filled for them lives on
			// with no one to replay it as.
			await db('directus_users').where({ id: gone.id })
				.delete();

			const lenient = await runCacheAudit(['--json']);

			expect(lenient.code).toBe(0);

			expect(reportIn(lenient.output).findings[0]).toMatchObject({
				verdict: 'unreplayable',
				reason: 'user_gone',
				user: gone.id,
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

			await settled(3);

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
			reaps the history past CACHE_AUDIT_RETENTION on every run
		`, async () => {
			// Over an empty cache: a clean run is what exits 0 here.
			await clearCache();

			// Every case above left runs behind: the cutoff is taken before the
			// run boots, so whatever was older then is older than the run's own
			// cutoff too.
			const cutoff = new Date(Date.now() - 2_000);

			const older = () => {
				return db('directus_cache_audits')
					.where('started_at', '<', cutoff)
					.count({ n: '*' })
					.first()
					.then((row) => Number(row?.['n']));
			};

			expect(await older()).toBeGreaterThan(0);

			// The retention rides the process env, so this run reads a short one
			// without touching the running nodes.
			const { code, output } = await runCacheAudit(['--json'], {
				CACHE_AUDIT_RETENTION: '2s',
			});

			expect(code).toBe(0);
			expect(await older()).toBe(0);

			const own = await db('directus_cache_audits')
				.where({ id: reportIn(output).id })
				.first();

			expect(own).toBeDefined();
		}, 90_000);

		it(oneLine`
			refuses on a node with CACHE_AUDIT_ENABLED off, leaving no run behind
		`, async () => {
			const cliRuns = () => {
				return db('directus_cache_audits')
					.where({ trigger: 'cli' })
					.count({ n: '*' })
					.first()
					.then((row) => Number(row?.['n']));
			};

			const before = await cliRuns();

			const { code, output } = await runCacheAudit(['--json'], {
				CACHE_AUDIT_ENABLED: 'false',
			});

			expect(code).toBe(1);
			expect(output).toContain('CACHE_AUDIT_ENABLED is false on this node');
			expect(output).not.toContain('"scanned"');
			expect(await cliRuns()).toBe(before);
		}, 60_000);

		it(oneLine`
			refuses a --limit that is not a count before the boot, leaving no run
			behind
		`, async () => {
			const cliRuns = () => {
				return db('directus_cache_audits')
					.where({ trigger: 'cli' })
					.count({ n: '*' })
					.first()
					.then((row) => Number(row?.['n']));
			};

			const before = await cliRuns();

			const { code, output } = await runCacheAudit(['--json', '--limit', 'abc']);

			expect(code).toBe(1);

			expect(output)
				.toContain('--limit has to be a whole number of 1 or more, not "abc"');

			expect(output).not.toContain('"scanned"');
			expect(await cliRuns()).toBe(before);
		}, 60_000);

		describe('the scheduled audit', () => {
			let scheduled: ChildProcess;
			let scheduledUrl: string;

			beforeAll(async () => {
				const scheduledPort = await getPort();
				scheduledEnv[vendor].PORT = String(scheduledPort);

				scheduled = spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: scheduledEnv[vendor],
				});

				scheduledUrl = getUrl(vendor, scheduledEnv);

				await awaitDirectusConnection(scheduledPort);
			}, 60_000);

			afterAll(() => {
				scheduled.kill();
			});

			function schedule(from: string) {
				return request(from)
					.get('/utils/cache/audit/schedule')
					.set('Authorization', auth);
			}

			it(oneLine`
				the scheduled audit lands a stale entry on the cache page by itself
			`, async () => {
				await clearCache(scheduledUrl);
				await warm(() => readOwner('initech', scheduledUrl));

				await db(ROWS).where({ owner: 'initech' })
					.update({ amount: '11' });

				// Nothing calls the endpoint: the node's own schedule replays the
				// entry, and the finding drains through the anomaly stream. Read off
				// the table rather than the listing, which is the top 200 groups by
				// count over a table every suite in the shard writes to.
				let flagged: any;

				for (let attempt = 0; attempt < SETTLE_ATTEMPTS && !flagged; attempt++) {
					flagged = await db('directus_cache_stats_anomalies as a')
						.join(
							'directus_cache_stats_descriptors as d',
							'd.cache_key',
							'a.cache_key',
						)
						.where({
							'a.reason': 'stale_entry',
							'd.path': `/items/${ROWS}`,
							'd.query': 'filter[owner][_eq]=initech',
						})
						.select('a.detail')
						.first();

					if (!flagged) {
						await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
					}
				}

				expect(flagged).toBeDefined();
				expect(flagged.detail).toContain('/data/0/amount');

				const recorded = await db('directus_cache_audits')
					.where({ trigger: 'cron' })
					.where('stale', '>', 0)
					.first();

				expect(recorded).toBeDefined();

				// Found, not fixed: the schedule reports, the entry stays for a purge
				// or an operator.
				const stillHeld = await readOwner('initech', scheduledUrl);
				expect(stillHeld.headers[cacheStatusHeader]).toBe('HIT');
			}, 90_000);

			it(oneLine`
				keeps a finding whose readable key is longer than a name column holds
			`, async () => {
				// Sixty owners in one filter: under CACHE_KEY_HASH_ENABLED=false the
				// Redis key carries the whole query, well past 255 characters.
				const query = `filter[owner][_in]=${[
					'initech',
					...Array.from({ length: 60 }, (_, index) => `nobody-${index}`),
				].join(',')}`;

				await clearCache(scheduledUrl);

				await warm(() => {
					return request(scheduledUrl)
						.get(`/items/${ROWS}`)
						.query(query)
						.set('Authorization', auth);
				});

				await db(ROWS).where({ owner: 'initech' })
					.update({ amount: '12' });

				let finding: any;

				for (let attempt = 0; attempt < SETTLE_ATTEMPTS && !finding; attempt++) {
					finding = await db('directus_cache_audit_findings')
						.where({ verdict: 'stale', query })
						.select('redis_key', 'url')
						.first();

					if (!finding) {
						await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
					}
				}

				expect(finding).toBeDefined();
				expect(finding.redis_key.length).toBeGreaterThan(255);
				expect(finding.redis_key).toContain(`"path":"/items/${ROWS}"`);
				expect(finding.redis_key).toContain('"nobody-59"');
				expect(finding.url).toBe(`/items/${ROWS}?${query}`);
			}, 90_000);

			it(oneLine`
				a schedule written on one node reaches the other over the bus
			`, async () => {
				// The other node has no rule of its own: whatever it reports as in
				// force after the write came off the bus. That the rule then runs is
				// the REST suite's case; here both nodes share the cache, so a
				// finding could not say which of them made it.
				const unscheduled = await schedule(url);
				expect(unscheduled.body.data).toMatchObject({ rule: null, source: null });

				const written = await request(scheduledUrl)
					.patch('/utils/cache/audit/schedule')
					.send({ rule: '* * * * * *' })
					.set('Authorization', auth);

				expect(written.statusCode).toBe(200);

				try {
					let relayed: any;

					for (let attempt = 0; attempt < SETTLE_ATTEMPTS && !relayed; attempt++) {
						const state = await schedule(url);

						if (state.body.data.rule === '* * * * * *') {
							relayed = state.body.data;
						}
						else {
							await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
						}
					}

					expect(relayed).toMatchObject({
						rule: '* * * * * *',
						source: 'settings',
						envRule: null,
					});
				}
				finally {
					await request(scheduledUrl)
						.patch('/utils/cache/audit/schedule')
						.send({ rule: null })
						.set('Authorization', auth);
				}

				// Cleared the same way: the other node is back to no rule at all.
				let cleared: any;

				for (let attempt = 0; attempt < SETTLE_ATTEMPTS && !cleared; attempt++) {
					const state = await schedule(url);

					if (state.body.data.rule === null) {
						cleared = state.body.data;
					}
					else {
						await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
					}
				}

				expect(cleared).toMatchObject({ rule: null, source: null });
			}, 60_000);
		});
	});
});
