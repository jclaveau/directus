import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldO2M,
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

// B#3: O2M array-form nested create routes to upsertMany, whose take-over path lacks
// createMany's guard, so a pure-insert move leaks the moved-from slice (stale HIT).

const PARENT = 'test_b3_parent';
const CHILD = 'test_b3_child';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	an O2M array-form take-over move via upsertMany leaks the moved-from slice
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-b3-upsert-move-${vendor}`;

		let instance: ChildProcess;
		let secondParentId: number;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: PARENT,
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
					{
						collection: CHILD,
						meta: { scoped_cache_fields: ['slot'] },
						fields: [
							{ field: 'slot', type: 'string', meta: {} },
							{ field: 'marker', type: 'string', meta: {} },
						],
					},
				],
			});

			await CreateFieldO2M(vendor, {
				collection: PARENT,
				field: 'children',
				otherCollection: CHILD,
				otherField: 'parent',
			});

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [{ title: 'p1' }, { title: 'p2' }],
			});

			secondParentId = parents[1].id;

			await CreateItem(vendor, {
				collection: CHILD,
				item: [{ slot: 'a', marker: 'movable', parent: parents[0].id }],
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

			await DeleteCollection(vendor, { collection: CHILD });
			await DeleteCollection(vendor, { collection: PARENT });
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlot(value: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${CHILD}`)
				.query({ 'filter[slot][_eq]': value })
				.set('Authorization', auth);
		}

		it(oneLine`
			the moved-from slice is purged, so a re-read MISSes not stale
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await readSlot('a');

			const warm = await readSlot('a');
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');
			expect(warm.body.data).toHaveLength(1);

			// Array-form nested create routes to upsertMany; the hook takes over the
			// seeded row and moves it from slot=a to slot=b.
			await request(url)
				.patch(`/items/${PARENT}/${secondParentId}`)
				.send({ children: [{ slot: 'b' }] })
				.set('Authorization', auth);

			const afterMove = await readSlot('a');

			expect(afterMove.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterMove.body.data).toHaveLength(0);
		});
	});
});
