import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	CreatePermission,
	CreateUser,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { createRedisProxy } from '@common/redis-proxy';
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

		// A run answers as the history records it, findings apart: those are
		// read back from the history, where every case below witnesses them.
		async function recorded(response: request.Response) {
			expect(response.statusCode).toBe(200);
			expect(response.body.data.findings).toBeUndefined();

			const read = await request(url)
				.get(`/utils/cache/audits/${response.body.data.id}`)
				.set('Authorization', auth);

			expect(read.statusCode).toBe(200);

			return read.body.data;
		}

		// The audit takes its entries off the descriptors, which are drained to
		// Postgres on a schedule: a just-filled entry is not its to see for up
		// to a second. Audit until the entries warmed are all examined.
		async function auditSettled(body: Record<string, unknown> = {}, warmed = 1) {
			let report: any;

			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				report = await recorded(await audit(body));

				if (report.scanned >= warmed) {
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
		async function anomaly(reason: string, url: string, sample?: string) {
			// The whole request, query included: the anomalies every case before
			// this one raised on the same path are still in the table.
			const [path, query = ''] = url.split('?');

			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				const rows = await db('directus_cache_stats_anomalies as a')
					.join(
						'directus_cache_stats_descriptors as d',
						'd.cache_key',
						'a.cache_key',
					)
					.where({ 'a.reason': reason, 'd.path': path, 'd.query': query })
					.select('a.detail');

				const found = rows.find((row: any) => {
					return sample === undefined || row.detail === sample;
				});

				if (found) {
					return { sample: found.detail, url };
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

			const report = await auditSettled({}, 2);

			expect(report.scanned).toBe(2);
			expect(report.counts.fresh).toBe(2);
			expect(report.findings).toEqual([]);
			expect(report.findingsTotal).toBe(0);
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
			const flagged = await anomaly(
				'stale_entry',
				`/items/${ROWS}?filter[owner][_eq]=acme`,
			);

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

			const whole = await auditSettled({}, 3);
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
			stops a limited run there and resumes the next behind it, least recently
			verified first, coming back round once every entry has had its turn
		`, async () => {
			const testStart = Date.now();
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));

			// The admin's two descriptors, by the query each was filled for. Both
			// outlive the clear (the refill lands on the same key), so the audit
			// sees them live at once while their fill time is still the previous
			// one until the drain lands: the order under test is the new fills'.
			async function rows(): Promise<Record<string, any>> {
				const found = await db('directus_cache_stats_descriptors')
					.where({ collection: ROWS, path: `/items/${ROWS}` })
					.whereNot({ user_id: appUserId })
					.whereIn('query', ['filter[owner][_eq]=acme', 'filter[owner][_eq]=globex'])
					.select('query', 'last_filled', 'audited_at');

				return Object.fromEntries(found.map((row: any) => [row.query, row]));
			}

			async function drained(owners: string[], filledAfter: number) {
				for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
					const found = await rows();

					if (owners.every((owner) => {
						const row = found[`filter[owner][_eq]=${owner}`];

						return row !== undefined
							&& new Date(row.last_filled).getTime() >= filledAfter;
					})) {
						return;
					}

					await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
				}
			}

			await drained(['acme', 'globex'], testStart);
			await auditSettled({}, 2);

			// The stamp each run leaves on the descriptor it took.
			async function takenBy(run: () => Promise<any>): Promise<string[]> {
				const before = await rows();
				const response = await run();
				expect(response.body.data.scanned).toBe(1);
				const after = await rows();

				return Object.keys(after).filter((query) => {
					return new Date(after[query].audited_at).getTime()
						> new Date(before[query].audited_at).getTime();
				});
			}

			// Both were stamped together, so the older fill goes first.
			const first = await takenBy(() => audit({ limit: 1 }));
			expect(first).toEqual(['filter[owner][_eq]=acme']);

			const second = await takenBy(() => audit({ limit: 1 }));
			expect(second).toEqual(['filter[owner][_eq]=globex']);

			const third = await takenBy(() => audit({ limit: 1 }));
			expect(third).toEqual(['filter[owner][_eq]=acme']);

			// A refill is a read of the database too: globex, purged by a write
			// through the API and read again, is verified as of now and waits its
			// turn behind acme, audited before it was filled.
			const refilledAfter = Date.now();

			const globex = await db(ROWS)
				.where({ owner: 'globex' })
				.first('id');

			await request(url)
				.patch(`/items/${ROWS}/${globex.id}`)
				.send({ amount: '2' })
				.set('Authorization', auth);

			await warm(() => readOwner('globex'));
			await drained(['globex'], refilledAfter);

			const fourth = await takenBy(() => audit({ limit: 1 }));
			expect(fourth).toEqual(['filter[owner][_eq]=acme']);

			// The horizon is the least recently verified entry of all: never
			// later than either of these, whatever else the table holds.
			const queued = await request(url)
				.get('/utils/cache/audit/queue')
				.set('Authorization', auth);

			expect(queued.statusCode).toBe(200);

			const verified = Object.values(await rows()).map((row) => {
				return Math.max(
					new Date(row.last_filled).getTime(),
					new Date(row.audited_at).getTime(),
				);
			});

			expect(queued.body.data.size).toBeGreaterThanOrEqual(2);

			expect(queued.body.data.verifiedSince)
				.toBeLessThanOrEqual(Math.min(...verified));
		}, 60_000);

		it(oneLine`
			reads its options off the query string as well
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			await auditSettled({}, 2);

			const capped = await request(url)
				.post('/utils/cache/audit')
				.query({ limit: 1 })
				.set('Authorization', auth);

			expect(capped.statusCode).toBe(200);
			expect(capped.body.data.scanned).toBe(1);
		}, 60_000);

		it(oneLine`
			retires a descriptor whose entry is gone, and takes it back once the
			entry is filled again
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			await auditSettled({ collection: ROWS }, 2);

			// The admin's two descriptors, by the query each was filled for.
			async function rows(): Promise<Record<string, any>> {
				const found = await db('directus_cache_stats_descriptors')
					.where({ collection: ROWS, path: `/items/${ROWS}` })
					.whereNot({ user_id: appUserId })
					.whereIn('query', ['filter[owner][_eq]=acme', 'filter[owner][_eq]=globex'])
					.select('query', 'last_filled', 'gone_at');

				return Object.fromEntries(found.map((row: any) => [row.query, row]));
			}

			const held = await rows();
			expect(held['filter[owner][_eq]=acme'].gone_at).toBeNull();
			expect(held['filter[owner][_eq]=globex'].gone_at).toBeNull();

			// Both entries gone: the run finds nothing of the collection to
			// replay, and stamps the two out of the queue.
			await clearCache();
			const emptied = await recorded(await audit({ collection: ROWS }));
			expect(emptied.scanned).toBe(0);

			const retired = await rows();
			expect(retired['filter[owner][_eq]=acme'].gone_at).not.toBeNull();
			expect(retired['filter[owner][_eq]=globex'].gone_at).not.toBeNull();

			// Filled again, acme is back in the queue; globex, still gone, is not
			// walked again: the run examines exactly the one.
			const refilledAfter = Date.now();
			await warm(() => readOwner('acme'));

			const resumed = await auditSettled({ collection: ROWS }, 1);
			expect(resumed.scanned).toBe(1);
			expect(resumed.counts.fresh).toBe(1);

			const rearmed = await rows();
			expect(rearmed['filter[owner][_eq]=acme'].gone_at).toBeNull();

			expect(new Date(rearmed['filter[owner][_eq]=acme'].last_filled).getTime())
				.toBeGreaterThanOrEqual(refilledAfter);

			expect(rearmed['filter[owner][_eq]=globex'].gone_at).not.toBeNull();
		}, 60_000);

		it(oneLine`
			stops on CACHE_AUDIT_MAX_DURATION after the page it began, and says so
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			await auditSettled({ collection: ROWS }, 2);

			// Flipped on this instance's own env, as the run reads it; put back
			// whatever the witness finds.
			async function budget(value: string) {
				const set = await request(url)
					.post('/env-inject/set')
					.send({ key: 'CACHE_AUDIT_MAX_DURATION', value })
					.set('Authorization', auth);

				expect(set.statusCode).toBe(200);
			}

			await budget('1ms');

			try {
				const cut = await recorded(await audit({ collection: ROWS }));

				// One page holds both, and is examined whole before the clock is
				// read: nothing of it is left half done.
				expect(cut.scanned).toBe(2);
				expect(cut.timedOut).toBe(true);
				expect(cut.error).toBeNull();
				expect(cut.finishedAt).not.toBeNull();
			}
			finally {
				await budget('10m');
			}

			const whole = await recorded(await audit({ collection: ROWS }));
			expect(whole.timedOut).toBe(false);
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
				`/items/${ROWS}?filter[owner][_eq]=acme`,
				'replay_status_403',
			);

			expect(flagged).toBeDefined();

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
			does not see an entry whose descriptor is gone, and leaves it in place
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await auditSettled();

			await request(url)
				.post('/utils/cache/stats/truncate')
				.set('Authorization', auth);

			const response = await audit();

			expect(response.statusCode).toBe(200);
			expect(response.body.data.scanned).toBe(0);
			expect(response.body.data.counts.fresh).toBe(0);

			const stillHeld = await readOwner('acme');
			expect(stillHeld.headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		it(oneLine`
			records every run in the history and answers it as recorded, its
			findings read back from there a page at a time
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));
			await warm(() => readOwner('globex'));
			// Both examined once, so the run below takes both.
			await auditSettled({ collection: ROWS }, 2);

			await db(ROWS).whereIn('owner', ['acme', 'globex'])
				.update({ amount: '12' });

			const answered = await audit({ collection: ROWS });

			expect(answered.statusCode).toBe(200);

			const run = answered.body.data;

			expect(run).toMatchObject({
				id: expect.any(Number),
				trigger: 'rest',
				options: { limit: null, user: null, collection: ROWS, purge: false },
				scanned: 2,
				counts: expect.objectContaining({ stale: 2 }),
				evicted: 0,
				error: null,
			});

			expect(run.finishedAt).toBeGreaterThanOrEqual(run.startedAt);
			expect(run.findings).toBeUndefined();

			const listed = await request(url)
				.get('/utils/cache/audits')
				.set('Authorization', auth);

			expect(listed.statusCode).toBe(200);

			// The same row the listing carries.
			expect(listed.body.data.find((each: any) => each.id === run.id)).toEqual(run);

			const readRun = (query: Record<string, unknown>) => {
				return request(url)
					.get(`/utils/cache/audits/${run.id}`)
					.query(query)
					.set('Authorization', auth);
			};

			// The first page, which is every finding here.
			const read = await readRun({});

			expect(read.statusCode).toBe(200);
			expect(read.body.data).toMatchObject(run);
			expect(read.body.data.findingsTotal).toBe(2);

			expect(read.body.data.findings.map((finding: any) => finding.url)).toEqual([
				`/items/${ROWS}?filter[owner][_eq]=acme`,
				`/items/${ROWS}?filter[owner][_eq]=globex`,
			]);

			// A page cut to one, then the one behind it; the total stays.
			const first = await readRun({ limit: 1 });

			expect(first.body.data.findings.map((finding: any) => finding.url)).toEqual([
				`/items/${ROWS}?filter[owner][_eq]=acme`,
			]);

			expect(first.body.data.findingsTotal).toBe(2);

			const second = await readRun({ limit: 1, offset: 1 });

			expect(second.body.data.findings.map((finding: any) => finding.url)).toEqual([
				`/items/${ROWS}?filter[owner][_eq]=globex`,
			]);

			// One verdict at a time, the total counted under the same narrowing.
			const drifted = await readRun({ verdict: 'tag_drift' });

			expect(drifted.body.data.findings).toEqual([]);
			expect(drifted.body.data.findingsTotal).toBe(0);

			const stale = await readRun({ verdict: 'stale' });

			expect(stale.body.data.findings).toHaveLength(2);
			expect(stale.body.data.findingsTotal).toBe(2);

			for (const bad of [
				{ limit: 0 },
				{ limit: 1001 },
				{ offset: -1 },
				{ verdict: 'fresh' },
			]) {
				const refused = await readRun(bad);

				expect(refused.statusCode).toBe(400);
			}

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

			// The settings route writes the same singleton, and refuses the same.
			const direct = await request(url)
				.patch('/settings')
				.send({ cache_audit_schedule: 'hourly' })
				.set('Authorization', auth);

			expect(direct.statusCode).toBe(400);
			expect(direct.body.errors[0].message).toContain('hourly');

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
			const flagged = await anomaly(
				'stale_entry',
				`/items/${ROWS}?filter[owner][_eq]=globex`,
			);

			expect(flagged).toBeDefined();

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

		it(oneLine`
			drops the options a caller may not set: a budget of nothing in the
			body stops no run
		`, async () => {
			await clearCache();
			await warm(() => readOwner('acme'));

			const report = await auditSettled({ collection: ROWS, maxDurationMs: 0 });

			expect(report.scanned).toBe(1);
			expect(report.timedOut).toBe(false);

			expect(report.options).toEqual({
				limit: null,
				user: null,
				collection: ROWS,
				purge: false,
			});
		}, 60_000);

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

		// A second node over the same cache, reached through a proxy the case
		// can cut: what a run finds when Redis is not there to say what it
		// holds. Last, and on its own node: the one above keeps its connection.
		describe('a node whose cache went away', () => {
			let proxy: ReturnType<typeof createRedisProxy>;
			let cutOff: ChildProcess;
			let cutOffUrl: string;
			// What the node said: a 500 names nothing on its own.
			const cutOffLog: string[] = [];

			beforeAll(async () => {
				const proxyPort = await getPort();
				proxy = createRedisProxy(6108, proxyPort);
				await proxy.open();

				const cutOffEnv = cloneDeep(env);
				cutOffEnv[vendor]['REDIS'] = `redis://localhost:${proxyPort}`;
				cutOffEnv[vendor]['REDIS_RETRY_BASE_DELAY'] = '10';
				cutOffEnv[vendor]['REDIS_RETRY_MAX_DELAY'] = '50';

				const cutOffPort = await getPort();
				cutOffEnv[vendor].PORT = String(cutOffPort);

				cutOff = spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: cutOffEnv[vendor],
				});

				cutOff.stdout?.on('data', (chunk) => cutOffLog.push(String(chunk)));
				cutOff.stderr?.on('data', (chunk) => cutOffLog.push(String(chunk)));

				cutOffUrl = getUrl(vendor, cutOffEnv);
				await awaitDirectusConnection(cutOffPort);
			}, 60_000);

			afterAll(async () => {
				cutOff.kill();
				await proxy.cut();
			});

			function auditFrom(from: string) {
				return request(from)
					.post('/utils/cache/audit')
					.send({ collection: ROWS })
					.set('Authorization', auth);
			}

			async function descriptor(): Promise<any> {
				return db('directus_cache_stats_descriptors')
					.where({
						collection: ROWS,
						path: `/items/${ROWS}`,
						query: 'filter[owner][_eq]=acme',
					})
					.whereNot({ user_id: appUserId })
					.select('gone_at', 'audited_at')
					.first();
			}

			it(oneLine`
				retires nothing while the cache cannot say what it holds, and
				resumes over the same descriptors once it can
			`, async () => {
				await clearCache();
				await warm(() => readOwner('acme'));
				// Described, and examined once by the connected node.
				await auditSettled({ collection: ROWS }, 1);
				const { audited_at: examinedAt } = await descriptor();

				const cutAt = new Date();
				await proxy.cut();

				// The run fails rather than reading every entry as gone: a cache
				// that answers nothing is not one that dropped everything.
				const refused = await auditFrom(cutOffUrl);
				const said = () => cutOffLog.join('').slice(-6000);

				expect(refused.statusCode, JSON.stringify(refused.body)).toBe(500);

				// One run since the cut, recorded as failed: what the node said
				// is the failure's own words.
				const since = await db('directus_cache_audits')
					.where('started_at', '>=', cutAt)
					.orderBy('id', 'desc');

				expect(since, said()).toHaveLength(1);
				const [failed] = since;

				expect(failed.error, said())
					.toContain('The cache could not be asked what it holds');

				expect(failed.finished_at).not.toBeNull();
				expect(failed.scanned).toBe(0);

				const held = await descriptor();
				expect(held.gone_at).toBeNull();

				// Not stamped either: the entry was not examined.
				expect(new Date(held.audited_at).getTime())
					.toBe(new Date(examinedAt).getTime());

				await proxy.open();

				let resumed: any;

				for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
					const response = await auditFrom(cutOffUrl);

					if (response.statusCode === 200 && response.body.data.scanned >= 1) {
						resumed = response.body.data;
						break;
					}

					await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
				}

				expect(resumed).toMatchObject({ scanned: 1, error: null });
				expect(resumed.counts.fresh).toBe(1);
				expect((await descriptor()).gone_at).toBeNull();
			}, 90_000);
		});
	});
});
