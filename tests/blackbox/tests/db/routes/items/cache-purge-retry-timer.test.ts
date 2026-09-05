import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { redisCommand } from '@utils/redis-command';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A purge that fails after its mutation committed is recorded and finished later.
// Recovery used to be wired to the two clients' `ready` events alone, which assumes
// every such failure was the connection — but `OOM command not allowed`, a
// WRONGTYPE, a LOADING replica all fail with the link UP, and then no `ready` will
// ever fire again: the record, and the stale entries it names, survive until a
// reconnect or a restart.
//
// The failure here is a WRONGTYPE, which is the one that needs no outage to
// reproduce: the collection's bare tag key is overwritten with a string, so the
// sweep's SUNION over it is refused while every other command keeps working. The
// entry stays indexed under its intact value slice, which is what lets the retry
// finish the job once the bad key is gone.

const NOTE = 'retry_timer_note';
const PENDING = 'directus_scoped_cache_pending_purges';
const REDIS_PORT = 6108;
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a purge that fails with the connection still up is finished by the retry timer,
	not left waiting for a reconnect that never comes
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		const namespace = `directus-retry-timer-${vendor}`;
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = String(REDIS_PORT);
		env[vendor]['CACHE_NAMESPACE'] = namespace;
		// Short enough for a test to wait on it; the shipped default is a minute.
		env[vendor]['CACHE_SCOPED_PURGE_RETRY_INTERVAL'] = '2s';

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		const db = knex(config.knexConfig[vendor]!);

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: NOTE,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, {
				collection: NOTE,
				item: [{ slot: 'a', label: 'v1' }],
			});

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance?.kill();

			await redisCommand(REDIS_PORT, ['DEL', `${namespace}:tag:${NOTE}`])
				.catch(() => '');

			await db(PENDING).delete();
			await db.destroy();

			await DeleteCollection(vendor, { collection: NOTE });
		});

		function readSlotA() {
			return request(getUrl(vendor, env))
				.get(`/items/${NOTE}`)
				.query({ 'filter[slot][_eq]': 'a' })
				.set('Authorization', auth);
		}

		it(oneLine`
			records the refused purge, keeps serving the entry it could not drop, and
			drops it on the next timer pass once the refusal is gone
		`, async () => {
			const url = getUrl(vendor, env);

			await db(PENDING).delete();

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			expect((await readSlotA()).headers[cacheStatusHeader]).toBe('MISS');

			const cached = await readSlotA();
			expect(cached.headers[cacheStatusHeader]).toBe('HIT');
			expect(cached.body.data[0].label).toBe('v1');

			// The refusal: a SET over the collection's bare tag leaves a string where
			// the sweep expects a set. Every other command still works, and the
			// connection is never dropped — so nothing will emit `ready`.
			expect(
				await redisCommand(REDIS_PORT, ['SET', `${namespace}:tag:${NOTE}`, 'x']),
			).toBe('+OK');

			const write = await request(url)
				.patch(`/items/${NOTE}/${cached.body.data[0].id}`)
				.send({ label: 'v2' })
				.set('Authorization', auth);

			// The write is durable by the time the purge runs, so it must not 500.
			expect(write.status).toBe(200);

			const recorded = await db(PENDING).select('mode', 'scoped_cache_tag');
			expect(recorded.length).toBeGreaterThan(0);

			// Nothing dropped it, so the pre-write body is still being served — the
			// staleness the retry exists to end.
			const stale = await readSlotA();
			expect(stale.headers[cacheStatusHeader]).toBe('HIT');
			expect(stale.body.data[0].label).toBe('v1');

			expect(await redisCommand(REDIS_PORT, ['DEL', `${namespace}:tag:${NOTE}`]))
				.toBe(':1');

			// The timer is the only thing that can fire now: the link never dropped,
			// so no `ready` is coming, and nothing else writes to this collection.
			let served = stale;

			for (let attempt = 0; attempt < 20; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 1000));

				served = await readSlotA();

				if (served.headers[cacheStatusHeader] === 'MISS') {
					break;
				}
			}

			expect(served.headers[cacheStatusHeader]).toBe('MISS');
			expect(served.body.data[0].label).toBe('v2');
			expect(await db(PENDING).select('id')).toEqual([]);
		}, 60_000);
	});
});
