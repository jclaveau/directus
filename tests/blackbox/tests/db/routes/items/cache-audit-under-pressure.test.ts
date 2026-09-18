import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The cache audit replays entries over the process's own loopback, and the
// pressure limiter sat in front of those replays: a run's bookkeeping stalled
// the loop, the limiter shed the replays, and a whole page came back
// `unreplayable status_503` from a node answering everyone else
// (jclaveau/directus#508). Here the limiter is already shedding when the run
// starts, and every replay of STALL stalls the loop again — the
// `cache-audit-stall` hook blocks it for 300ms per read once its flag is
// armed, three times the limiter's ceiling — and the run has to come back
// fresh all the same, while the limiter sheds anyone else throughout.
//
// The limiter is put under pressure with the marker itself: a page of marked
// reads of STALL, each a stall the limiter cannot shed, and none a fill (a
// marked read never writes the cache back), so the queue stays what was
// warmed. The limiter reads the mean delay of a window, and a stall or two in
// a window of idle ticks does not move it; 2.4s of stalls back to back leave
// a whole window inside the block, whatever the sampling clock.
//
// Every count is read off the run's own answer: the history is a plain request
// too, and after the run the limiter sheds it with everyone else.

const STALL = 'test_cache_audit_stall';
const STALL_FLAG = 'test_cache_audit_stall_flag';

const ENTRIES = 8;
const STALL_MS = 300;

const replayHeader = 'x-cache-audit-replay';

const cacheStatusHeader = 'x-cache-status';

// The descriptors the audit reads are drained to Postgres once a second.
const SETTLE_ATTEMPTS = 30;
const SETTLE_DELAY_MS = 500;

describe('The cache audit replays through the pressure limiter', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);

		env[vendor]['REDIS'] = 'redis://localhost:6108';
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['CACHE_NAMESPACE'] = `directus-cache-audit-pressure-${vendor}`;
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';
		env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '* * * * * *';
		env[vendor]['PRESSURE_LIMITER_ENABLED'] = 'true';
		env[vendor]['PRESSURE_LIMITER_SAMPLE_INTERVAL'] = '1000';
		env[vendor]['PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY'] = '100';

		let instance: ChildProcess;
		let db: Knex;
		let url: string;
		let ids: string[];

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: STALL,
						meta: {},
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						collection: STALL_FLAG,
						meta: {},
						fields: [{ field: 'armed', type: 'string', meta: {} }],
					},
				],
			});

			const rows = await CreateItem(vendor, {
				collection: STALL,
				item: Array.from({ length: ENTRIES }, (_, index) => {
					return { label: `r${index}` };
				}),
			});

			ids = rows.map((row: { id: string }) => row.id);

			await CreateItem(vendor, { collection: STALL_FLAG, item: { armed: 'no' } });

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

			for (const collection of [STALL, STALL_FLAG]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		function readRow(id: string) {
			return request(url)
				.get(`/items/${STALL}/${id}`)
				.set('Authorization', auth);
		}

		function audit() {
			return request(url)
				.post('/utils/cache/audit')
				.send({ collection: STALL })
				.set('Authorization', auth);
		}

		function ping() {
			return request(url).get('/server/ping');
		}

		it(oneLine`
			reports every replay fresh through a limiter already shedding, while each
			of them stalls the loop past its ceiling again
		`, async () => {
			for (const id of ids) {
				await readRow(id);
				const warmed = await readRow(id);
				expect(warmed.headers[cacheStatusHeader]).toBe('HIT');
			}

			// Into the queue before the hook is armed: the drain is what a run
			// finding fewer entries than warmed is waiting on, not the hook.
			let settled: request.Response;

			for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
				settled = await audit();
				expect(settled.statusCode).toBe(200);

				if (settled.body.data.scanned >= ENTRIES) {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
			}

			expect(settled!.body.data).toMatchObject({
				scanned: ENTRIES,
				counts: { fresh: ENTRIES },
			});

			// Armed off the API: a write through it would purge STALL's entries.
			await db(STALL_FLAG).update({ armed: 'yes' });

			// The marker is the audit's HMAC over SECRET, computed as the engine
			// does. The stalls it buys are the limiter's pressure.
			const marker = createHmac('sha256', String(env[vendor]['SECRET']))
				.update('cache-audit-replay')
				.digest('hex');

			for (const id of ids) {
				const primed = await readRow(id).set(replayHeader, marker);

				expect(primed.statusCode).toBe(200);
			}

			const before = await ping();

			expect(before.statusCode).toBe(503);
			expect(before.body.errors[0].extensions.reason).toBe('Under pressure');

			// The trigger is a plain request too, shed like any other: it goes
			// in marked, as the audit's own.
			const startedAt = Date.now();
			const run = await audit().set(replayHeader, marker);

			expect(run.statusCode).toBe(200);

			expect(run.body.data).toMatchObject({
				scanned: ENTRIES,
				counts: { fresh: ENTRIES, unreplayable: 0 },
			});

			// The stalls happened: the run took at least all of them, end to end.
			expect(Date.now() - startedAt).toBeGreaterThanOrEqual(ENTRIES * STALL_MS);

			// And the limiter is still shedding: the run's own stalls kept every
			// window it sampled inside a block.
			const after = await ping();

			expect(after.statusCode).toBe(503);
			expect(after.body.errors[0].extensions.reason).toBe('Under pressure');
		}, 60_000);
	});
});
