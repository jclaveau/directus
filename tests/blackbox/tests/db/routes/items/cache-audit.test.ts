import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	CreatePermission,
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

// `POST /utils/cache/audit` replays every live entry against the database and
// says which ones the database no longer agrees with (jclaveau/directus#498).
// The unit tests drive the engine over a fake cache and a scripted replayer;
// these drive the real one: entries a running node filled through Redis,
// descriptors drained to Postgres, and replays over the node's own loopback,
// through the hooks that pin a read's tags.
//
// Every write that makes an entry stale here bypasses the API on purpose — a
// raw UPDATE fires no purge, which is exactly the class of write the audit
// exists to catch.

const ROWS = 'test_cache_audit_rows';
const CLOCK = 'test_cache_audit_clock';
const DRIFT = 'test_cache_audit_drift';
const DRIFT_DEP = 'test_cache_audit_drift_dep';
const RACE = 'test_cache_audit_race';
const RACE_FLAG = 'test_cache_audit_race_flag';

const cacheStatusHeader = 'x-cache-status';

// Replays are uncached reads, so an audit answers within a second or two; the
// descriptors it joins land on the one-second drain below.
const SETTLE_ATTEMPTS = 30;
const SETTLE_DELAY_MS = 500;

describe('The cache audit replays live entries against the database', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);

		env[vendor]['REDIS'] = 'redis://localhost:6108';
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['CACHE_NAMESPACE'] = `directus-cache-audit-${vendor}`;
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';
		env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '* * * * * *';

		let instance: ChildProcess;
		let db: Knex;
		let url: string;
		let appUserId: string;
		let raceFlagId: string;
		const appUserToken = `cache-audit-${vendor}`;

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
					{
						collection: DRIFT,
						meta: {},
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						collection: DRIFT_DEP,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [{ field: 'owner', type: 'string', meta: {} }],
					},
					{
						collection: RACE,
						meta: {},
						fields: [{ field: 'amount', type: 'string', meta: {} }],
					},
					{
						collection: RACE_FLAG,
						meta: {},
						fields: [{ field: 'armed', type: 'string', meta: {} }],
					},
				],
			});

			await CreateItem(vendor, {
				collection: ROWS,
				item: [
					{ owner: 'acme', amount: '1' },
					{ owner: 'globex', amount: '2' },
				],
			});

			await CreateItem(vendor, { collection: CLOCK, item: { label: 'tick' } });
			await CreateItem(vendor, { collection: DRIFT_DEP, item: { owner: 'first' } });
			await CreateItem(vendor, { collection: DRIFT, item: { label: 'pinned' } });
			await CreateItem(vendor, { collection: RACE, item: { amount: 'still' } });

			const flag = await CreateItem(vendor, {
				collection: RACE_FLAG,
				item: { armed: 'no' },
			});

			raceFlagId = flag.id;

			// A non-admin reader of ROWS, so an entry can be filled for a user the
			// audit then finds gone.
			await CreatePermission(vendor, {
				role: 'APP_ACCESS',
				policyName: 'cache-audit',
				permission: { collection: ROWS, action: 'read', fields: ['*'] },
			});

			const appUser = await CreateUser(vendor, {
				token: appUserToken,
				email: `cache-audit-${vendor}@example.com`,
				roleName: ROLE.APP_ACCESS.NAME,
			});

			appUserId = appUser.id;

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

			for (const collection of [ROWS, CLOCK, DRIFT, DRIFT_DEP, RACE, RACE_FLAG]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		// The query string as a string: the descriptor keeps it as sent, and the
		// finding's url is rebuilt from that.
		function readOwner(owner: string, token: string = USER.ADMIN.TOKEN) {
			return request(url)
				.get(`/items/${ROWS}`)
				.query(`filter[owner][_eq]=${owner}`)
				.set('Authorization', `Bearer ${token}`);
		}

		function readCollection(collection: string) {
			return request(url)
				.get(`/items/${collection}`)
				.set('Authorization', auth);
		}

		function readGraphql(owner: string) {
			return request(url)
				.post('/graphql')
				.send({
					query: `{ ${ROWS}(filter: { owner: { _eq: "${owner}" } }) { amount } }`,
				})
				.set('Authorization', auth);
		}

		async function clearCache() {
			await request(url).post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		// Filled and then answered from the cache: the second read is the HIT the
		// audit has to catch out.
		async function warm(read: () => request.Test) {
			await read();
			const warmed = await read();
			expect(warmed.headers[cacheStatusHeader]).toBe('HIT');
		}

		function audit(body: Record<string, unknown> = {}) {
			return request(url)
				.post('/utils/cache/audit')
				.send(body)
				.set('Authorization', auth);
		}

		// The descriptors the audit joins are drained to Postgres on a schedule,
		// so a just-filled entry reads `unreplayable:no_descriptor` for up to a
		// second: audit until every entry is described.
		async function auditSettled(body: Record<string, unknown> = {}) {
			let report: any;

			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				const response = await audit(body);
				expect(response.statusCode).toBe(200);
				report = response.body.data;

				const undescribed = report.findings.some((finding: any) => {
					return finding.reason === 'no_descriptor';
				});

				if (report.scanned > 0 && !undescribed) {
					return report;
				}

				await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
			}

			return report;
		}

		// One row per reason and entry: two entries on the same path (two users,
		// say) are told apart by the sample their finding wrote. Read off the
		// table rather than `/utils/cache/anomalies`: that listing is the top 200
		// groups BY COUNT over a table every suite in the shard writes to, and a
		// fresh count-of-one row falls off its bottom under load.
		async function anomaly(reason: string, path: string, sample?: string) {
			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				const rows = await db('directus_cache_stats_anomalies as a')
					.join(
						'directus_cache_stats_descriptors as d',
						'd.cache_key',
						'a.cache_key',
					)
					.where({ 'a.reason': reason, 'd.path': path })
					.select('a.detail', 'd.path', 'd.query');

				const found = rows.find((row: any) => {
					return sample === undefined || row.detail === sample;
				});

				if (found) {
					return {
						sample: found.detail,
						url: found.query === ''
							? found.path
							: `${found.path}?${found.query}`,
					};
				}

				await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
			}

			return undefined;
		}

		it(oneLine`
			reports every entry fresh while the database still agrees, and leaves
			the entries it replayed in place
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));

			const report = await auditSettled();

			expect(report.scanned).toBe(2);
			expect(report.counts.fresh).toBe(2);
			expect(report.findings).toEqual([]);
			expect(report.evicted).toBe(0);

			// Neither served from the cache nor written back: the entries the
			// replays computed against are the ones still there.
			const stillHeld = await readOwner('acme');
			expect(stillHeld.headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		it(oneLine`
			finds an entry a write behind the API left behind: stale, down to the
			pointer that moved, with no purge that ever named it, and an anomaly
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));

			await db(ROWS).where({ owner: 'acme' })
				.update({ amount: '9' });

			// The trap: the cache goes on answering the old amount.
			const trapped = await readOwner('acme');
			expect(trapped.headers[cacheStatusHeader]).toBe('HIT');
			expect(trapped.body.data[0].amount).toBe('1');

			const report = await auditSettled();

			expect(report.scanned).toBe(1);
			expect(report.counts.stale).toBe(1);

			expect(report.findings[0]).toMatchObject({
				verdict: 'stale',
				reason: null,
				method: 'GET',
				url: `/items/${ROWS}?filter[owner][_eq]=acme`,
				collection: ROWS,
				diff: ['/data/0/amount'],
				purgesSinceFilled: [],
				tags: expect.arrayContaining([`${ROWS}:owner=acme`]),
			});

			expect(report.findings[0].ageMs).toBeGreaterThanOrEqual(0);

			// Surfaced where the cache page reads, joined to the request that
			// filled the entry, with the pointer in the detail.
			const flagged = await anomaly('stale_entry', `/items/${ROWS}`);

			expect(flagged).toBeDefined();
			expect(flagged.sample).toContain('/data/0/amount');
		}, 60_000);

		it(oneLine`
			evicts the stale entries under purge, so the next read answers the
			database
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));

			await db(ROWS).where({ owner: 'acme' })
				.update({ amount: '10' });

			const report = await auditSettled({ purge: true });

			expect(report.counts.stale).toBe(1);
			expect(report.evicted).toBe(1);

			const refilled = await readOwner('acme');

			expect(refilled.headers[cacheStatusHeader]).toBe('MISS');
			expect(refilled.body.data[0].amount).toBe('10');
		}, 60_000);

		it(oneLine`
			leaves an entry alone under purge while it is fresh
		`, async () => {
			await clearCache();
			await warm(() => readOwner('globex'));

			const report = await auditSettled({ purge: true });

			expect(report.counts.fresh).toBe(1);
			expect(report.evicted).toBe(0);

			const stillHeld = await readOwner('globex');
			expect(stillHeld.headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		it(oneLine`
			calls a body a hook stamps with a clock time_varying rather than stale,
			and fresh once the stamped pointer is ignored
		`, async () => {
			await clearCache();
			await warm(() => readCollection(CLOCK));

			const report = await auditSettled();

			expect(report.counts.time_varying).toBe(1);
			expect(report.counts.stale).toBe(0);

			expect(report.findings[0]).toMatchObject({
				verdict: 'time_varying',
				url: `/items/${CLOCK}`,
				diff: ['/data/0/served_at'],
			});

			const ignoring = await auditSettled({ ignore: ['/data/*/served_at'] });

			expect(ignoring.counts.fresh).toBe(1);
			expect(ignoring.findings).toEqual([]);
		}, 60_000);

		it(oneLine`
			finds a replay pinning other tags than the entry was filled under:
			tag_drift, the body agreeing, with both tag sets and an anomaly
		`, async () => {
			await clearCache();
			await db(DRIFT_DEP).update({ owner: 'first' });
			await warm(() => readCollection(DRIFT));

			// The hook pins whichever slice the dependency row is in: moved behind
			// the API, a replay pins the new slice while the entry sits under the
			// old one — the next write to `moved` purges nothing it should.
			await db(DRIFT_DEP).update({ owner: 'moved' });

			const report = await auditSettled();

			expect(report.counts.tag_drift).toBe(1);

			expect(report.findings[0]).toMatchObject({
				verdict: 'tag_drift',
				url: `/items/${DRIFT}`,
				diff: null,
				tags: expect.arrayContaining([`${DRIFT_DEP}:owner=first`]),
				replayTags: expect.arrayContaining([`${DRIFT_DEP}:owner=moved`]),
			});

			expect(report.findings[0].tags).not.toContain(`${DRIFT_DEP}:owner=moved`);

			const flagged = await anomaly('tag_drift', `/items/${DRIFT}`);

			expect(flagged).toBeDefined();
			expect(flagged.sample).toContain(`replay pinned`);
			expect(flagged.sample).toContain(`${DRIFT_DEP}:owner=moved`);
		}, 60_000);

		it(oneLine`
			calls an entry the replay itself purged raced, not stale, and lands no
			anomaly for it
		`, async () => {
			await clearCache();
			await warm(() => readCollection(RACE));

			// Armed, the race hook moves the row through the API on the next read
			// — the replay — so the entry is purged under the audit's feet.
			await request(url)
				.patch(`/items/${RACE_FLAG}/${raceFlagId}`)
				.send({ armed: 'yes' })
				.set('Authorization', auth);

			const armed = await readCollection(RACE);
			expect(armed.headers[cacheStatusHeader]).toBe('HIT');

			const report = await auditSettled({ collection: RACE });

			expect(report.counts).toMatchObject({ raced: 1, stale: 0 });

			expect(report.findings[0]).toMatchObject({
				verdict: 'raced',
				url: `/items/${RACE}`,
				diff: null,
			});

			const evicted = await readCollection(RACE);
			expect(evicted.headers[cacheStatusHeader]).toBe('MISS');
			expect(evicted.body.data[0].amount).toBe('moved');

			const listed = await request(url)
				.get('/utils/cache/anomalies')
				.set('Authorization', auth);

			expect(listed.body.data.filter((row: any) => row.path === `/items/${RACE}`))
				.toEqual([]);
		}, 60_000);

		it(oneLine`
			replays a GraphQL entry as a POST of its stored document
		`, async () => {
			await clearCache();
			await warm(() => readGraphql('globex'));

			await db(ROWS).where({ owner: 'globex' })
				.update({ amount: '20' });

			const report = await auditSettled();

			expect(report.counts.stale).toBe(1);

			expect(report.findings[0]).toMatchObject({
				verdict: 'stale',
				method: 'POST',
				url: '/graphql',
				diff: [`/data/${ROWS}/0/amount`],
			});

			expect(JSON.parse(report.findings[0].query).query).toContain(ROWS);
		}, 60_000);

		it(oneLine`
			narrows the sweep to one user, one collection, or a count of entries
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('acme', appUserToken));
			await warm(() => readCollection(CLOCK));

			const whole = await auditSettled();
			expect(whole.scanned).toBe(3);

			const byCollection = await audit({ collection: ROWS });
			expect(byCollection.body.data.scanned).toBe(2);

			const byUser = await audit({ user: appUserId });
			expect(byUser.body.data.scanned).toBe(1);
			expect(byUser.body.data.counts.fresh).toBe(1);

			const capped = await audit({ limit: 1 });
			expect(capped.body.data.scanned).toBe(1);
		}, 60_000);

		it(oneLine`
			reads its options off the query string as well
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			await auditSettled();

			const capped = await request(url)
				.post('/utils/cache/audit')
				.query({ limit: 1 })
				.set('Authorization', auth);

			expect(capped.statusCode).toBe(200);
			expect(capped.body.data.scanned).toBe(1);
		}, 60_000);

		it(oneLine`
			calls an entry stale once its user may no longer read it: the replay
			answers 403 where the cache still answers the rows
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme', appUserToken));

			// The permission moves behind the API, and only the system cache is
			// dropped: a permission written through it would flush the response
			// cache along, and there would be nothing left to audit.
			const policy = await db('directus_policies')
				.where({ name: 'APP_ACCESS-cache-audit' })
				.first('id');

			const permission = db('directus_permissions')
				.where({ policy: policy.id, action: 'read' });

			async function grant(collection: string) {
				await permission.clone().update({ collection });

				await request(url).post('/utils/cache/clear')
					.query({ targets: 'system' })
					.set('Authorization', auth);
			}

			await grant(`${ROWS}_revoked`);

			const served = await readOwner('acme', appUserToken);
			expect(served.headers[cacheStatusHeader]).toBe('HIT');
			expect(served.body.data).toHaveLength(1);

			const report = await auditSettled({ user: appUserId });

			expect(report.counts.stale).toBe(1);

			expect(report.findings[0]).toMatchObject({
				verdict: 'stale',
				reason: 'replay_status_403',
				user: appUserId,
				url: `/items/${ROWS}?filter[owner][_eq]=acme`,
				diff: null,
			});

			const flagged = await anomaly(
				'stale_entry',
				`/items/${ROWS}`,
				'replay_status_403',
			);

			expect(flagged).toMatchObject({
				url: `/items/${ROWS}?filter[owner][_eq]=acme`,
			});

			await grant(ROWS);
		}, 60_000);

		it(oneLine`
			cannot replay an entry for a user since deleted, and says so
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme', appUserToken));

			await db('directus_users').where({ id: appUserId })
				.delete();

			const report = await auditSettled();

			expect(report.counts.unreplayable).toBe(1);

			expect(report.findings[0]).toMatchObject({
				verdict: 'unreplayable',
				reason: 'user_gone',
				user: appUserId,
				url: `/items/${ROWS}?filter[owner][_eq]=acme`,
			});
		}, 60_000);

		it(oneLine`
			cannot replay an entry whose descriptor is gone, and leaves it in place
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await auditSettled();

			await request(url)
				.post('/utils/cache/stats/truncate')
				.set('Authorization', auth);

			const response = await audit();

			expect(response.body.data.counts.unreplayable).toBe(1);

			expect(response.body.data.findings[0]).toMatchObject({
				verdict: 'unreplayable',
				reason: 'no_descriptor',
				redisKey: expect.any(String),
				url: null,
				collection: null,
			});

			const stillHeld = await readOwner('acme');
			expect(stillHeld.headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		it(oneLine`
			records every run in the history, its findings with it, whichever way
			it was asked for
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));

			await db(ROWS).where({ owner: 'acme' })
				.update({ amount: '12' });

			const report = await auditSettled({ collection: ROWS });

			expect(report.counts.stale).toBe(1);
			expect(report.id).toEqual(expect.any(Number));

			const listed = await request(url)
				.get('/utils/cache/audits')
				.set('Authorization', auth);

			expect(listed.statusCode).toBe(200);

			// Newest first, so the run just answered leads whatever the other
			// suites in this database recorded.
			expect(listed.body.data[0]).toMatchObject({
				id: report.id,
				trigger: 'rest',
				options: { limit: null, user: null, collection: ROWS, purge: false },
				scanned: report.scanned,
				counts: report.counts,
				evicted: 0,
				error: null,
			});

			expect(listed.body.data[0].finishedAt)
				.toBeGreaterThanOrEqual(listed.body.data[0].startedAt);

			// The listing carries no findings; the run does.
			expect(listed.body.data[0].findings).toBeUndefined();

			const read = await request(url)
				.get(`/utils/cache/audits/${report.id}`)
				.set('Authorization', auth);

			expect(read.statusCode).toBe(200);
			expect(read.body.data.id).toBe(report.id);
			expect(read.body.data.findings).toEqual(report.findings);

			// The window is read the way every cache listing reads it.
			const badWindow = await request(url)
				.get('/utils/cache/audits')
				.query({ window: 'yesterday' })
				.set('Authorization', auth);

			expect(badWindow.statusCode).toBe(400);

			const unknown = await request(url)
				.get('/utils/cache/audits/999999999')
				.set('Authorization', auth);

			expect(unknown.statusCode).toBe(403);

			const notAnId = await request(url)
				.get('/utils/cache/audits/latest')
				.set('Authorization', auth);

			expect(notAnId.statusCode).toBe(400);

			const forbidden = await request(url)
				.get('/utils/cache/audits')
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			expect(forbidden.statusCode).toBe(403);
		}, 60_000);

		it(oneLine`
			takes a schedule live off the settings, runs on it without a restart,
			and hands it back to the environment when cleared
		`, async () => {
			// This node boots with no CACHE_AUDIT_SCHEDULE: nothing runs.
			const unscheduled = await request(url)
				.get('/utils/cache/audit/schedule')
				.set('Authorization', auth);

			expect(unscheduled.statusCode).toBe(200);

			expect(unscheduled.body.data).toEqual({
				rule: null,
				source: null,
				envRule: null,
				nextRunAt: null,
			});

			const refused = await request(url)
				.patch('/utils/cache/audit/schedule')
				.send({ rule: 'hourly' })
				.set('Authorization', auth);

			expect(refused.statusCode).toBe(400);
			expect(refused.body.errors[0].extensions.code).toBe('INVALID_PAYLOAD');
			expect(refused.body.errors[0].message).toContain('hourly');

			const unnamed = await request(url)
				.patch('/utils/cache/audit/schedule')
				.send({})
				.set('Authorization', auth);

			expect(unnamed.statusCode).toBe(400);

			// A stale entry nothing has flagged yet, for the schedule to find.
			await clearCache();
			await warm(() => readOwner('globex'));

			await db(ROWS).where({ owner: 'globex' })
				.update({ amount: '13' });

			const before = Date.now();

			const scheduled = await request(url)
				.patch('/utils/cache/audit/schedule')
				.send({ rule: '* * * * * *' })
				.set('Authorization', auth);

			expect(scheduled.statusCode).toBe(200);

			expect(scheduled.body.data).toMatchObject({
				rule: '* * * * * *',
				source: 'settings',
				envRule: null,
			});

			expect(scheduled.body.data.nextRunAt).toBeGreaterThan(before);

			// Durable, where every node re-reads it on boot.
			const settings = await request(url)
				.get('/settings')
				.query({ fields: 'cache_audit_schedule' })
				.set('Authorization', auth);

			expect(settings.body.data.cache_audit_schedule).toBe('* * * * * *');

			// Nothing calls the endpoint: the node's own schedule, taken off the
			// bus, replays the entry and lands its finding.
			const flagged = await anomaly('stale_entry', `/items/${ROWS}`);

			expect(flagged).toMatchObject({
				url: `/items/${ROWS}?filter[owner][_eq]=globex`,
			});

			const cronRun = await db('directus_cache_audits')
				.where({ trigger: 'cron' })
				.where('started_at', '>', new Date(before))
				.where('stale', '>', 0)
				.first();

			expect(cronRun).toBeDefined();

			const cleared = await request(url)
				.patch('/utils/cache/audit/schedule')
				.send({ rule: null })
				.set('Authorization', auth);

			expect(cleared.statusCode).toBe(200);
			expect(cleared.body.data).toMatchObject({ rule: null, source: null });

			const forbidden = await request(url)
				.patch('/utils/cache/audit/schedule')
				.send({ rule: null })
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			expect(forbidden.statusCode).toBe(403);
		}, 90_000);

		it('refuses a non-admin', async () => {
			const response = await request(url)
				.post('/utils/cache/audit')
				.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			expect(response.statusCode).toBe(403);
		});

		it('refuses options it cannot read', async () => {
			const response = await audit({ limit: 0 });

			expect(response.statusCode).toBe(400);
			expect(response.body.errors[0].extensions.code).toBe('INVALID_QUERY');
		});

		it('is published to administrators alone', async () => {
			const [admin, anonymous] = await Promise.all([
				request(url).get('/server/specs/oas')
					.set('Authorization', auth),
				request(url).get('/server/specs/oas'),
			]);

			expect(admin.body.paths['/utils/cache/audit'].post.operationId)
				.toBe('audit-cache');

			expect(admin.body.paths['/utils/cache/audits'].get.operationId)
				.toBe('list-cache-audits');

			expect(admin.body.paths['/utils/cache/audits/{id}'].get.operationId)
				.toBe('read-cache-audit');

			expect(admin.body.paths['/utils/cache/audit/schedule'].get.operationId)
				.toBe('read-cache-audit-schedule');

			expect(admin.body.paths['/utils/cache/audit/schedule'].patch.operationId)
				.toBe('update-cache-audit-schedule');

			for (const path of [
				'/utils/cache/audit',
				'/utils/cache/audits',
				'/utils/cache/audits/{id}',
				'/utils/cache/audit/schedule',
			]) {
				expect(anonymous.body.paths[path]).toBeUndefined();
			}
		});
	});
});
