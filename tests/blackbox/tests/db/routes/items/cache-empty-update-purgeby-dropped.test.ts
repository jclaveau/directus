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
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// B#4: a hook declares purgeBy(slot=a) then empties the payload; updateMany's
// changedFields===0 early return skips the purge, so slot=a stays a stale HIT.

const COLLECTION = 'test_b4_scoped';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	an empty-payload update drops the hook's declared purgeBy
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-b4-empty-update-${vendor}`;

		let instance: ChildProcess;
		let otherRowId: number;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: COLLECTION,
						meta: { scoped_cache_fields: ['slot'] },
						fields: [
							{ field: 'slot', type: 'string', meta: {} },
							{ field: 'body', type: 'string', meta: {} },
						],
					},
				],
			});

			const rows = await CreateItem(vendor, {
				collection: COLLECTION,
				item: [
					{ slot: 'a', body: 'in-a' },
					{ slot: 'b', body: 'in-b' },
				],
			});

			otherRowId = rows[1].id;

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

			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlot(value: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${COLLECTION}`)
				.query({ 'filter[slot][_eq]': value })
				.set('Authorization', auth);
		}

		it(oneLine`
			the declared purge fires, so slot=a MISSes after the empty-payload update
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await readSlot('a');

			const warm = await readSlot('a');
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');
			expect(warm.body.data).toHaveLength(1);

			// The hook declares purgeBy(slot=a) then empties the payload to {}.
			await request(url)
				.patch(`/items/${COLLECTION}/${otherRowId}`)
				.send({ slot: '__drop__' })
				.set('Authorization', auth);

			const afterUpdate = await readSlot('a');

			expect(afterUpdate.headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
