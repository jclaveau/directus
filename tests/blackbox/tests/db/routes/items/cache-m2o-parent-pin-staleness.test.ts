import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
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

// Pinning a nested collection by the keys of the parent rows a response carried is
// sound only while the rows of that collection the response DEPENDS ON are a subset
// of the ones it nested. Two queries break that: a root filter on the nested
// collection, and a `deep` filter hiding a parent the response still references. In
// both, a write to a parent row the response never nested changes what the read
// should return, so the entry has to go — only the bare tag covers that.

const OWNER = 'pin_stale_owner';
const OWNED_ITEM = 'pin_stale_owned_item';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a key pin must not outlive a write to a parent row it never nested (#361)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-pin-staleness-${vendor}`;

		let instance: ChildProcess;
		let filterMatchedOwnerId: number;
		let filterOtherOwnerId: number;
		let deepMatchedOwnerId: number;
		let deepOtherOwnerId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNED_ITEM,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: OWNED_ITEM,
				field: 'owner',
				otherCollection: OWNER,
			});

			// One pair per case, named apart so each case's filter selects only its own.
			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [
					{ name: 'filter-matched' },
					{ name: 'filter-other' },
					{ name: 'deep-matched' },
					{ name: 'deep-other' },
				],
			});

			filterMatchedOwnerId = owners[0].id;
			filterOtherOwnerId = owners[1].id;
			deepMatchedOwnerId = owners[2].id;
			deepOtherOwnerId = owners[3].id;

			await CreateItem(vendor, {
				collection: OWNED_ITEM,
				item: [
					{ label: 'filter-a', owner: filterMatchedOwnerId },
					{ label: 'filter-b', owner: filterOtherOwnerId },
					{ label: 'deep-a', owner: deepMatchedOwnerId },
					{ label: 'deep-b', owner: deepOtherOwnerId },
				],
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
			instance.kill();

			await DeleteCollection(vendor, { collection: OWNED_ITEM });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		it(oneLine`
			a root filter on the parent collection keeps the read bound to rows it
			never nested
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			function readOwnedItemsNamedFilterMatched() {
				return request(url)
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owner][name][_eq]': 'filter-matched',
						fields: 'id,label,owner.id,owner.name',
					})
					.set('Authorization', auth);
			}

			const warm = await readOwnedItemsNamedFilterMatched();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			// This owner was never nested by the read above, but renaming it moves its
			// item INTO the filtered set, so the cached body is now wrong.
			await request(url)
				.patch(`/items/${OWNER}/${filterOtherOwnerId}`)
				.send({ name: 'filter-matched' })
				.set('Authorization', auth);

			const written = await request(url)
				.get(`/items/${OWNER}/${filterOtherOwnerId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('filter-matched');

			const refetched = await readOwnedItemsNamedFilterMatched();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data).toHaveLength(2);
		});

		it(oneLine`
			a deep filter that hid a parent keeps the read bound to that parent
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			function readDeepItemsWithMatchedOwner() {
				return request(url)
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[label][_starts_with]': 'deep-',
						fields: 'id,label,owner.id,owner.name',
						'deep[owner][_filter][name][_eq]': 'deep-matched',
						sort: 'label',
					})
					.set('Authorization', auth);
			}

			const warm = await readDeepItemsWithMatchedOwner();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(2);

			// The second row references this owner but the deep filter hid it, so the
			// response carries `owner: null` — indistinguishable from a null column.
			expect(warm.body.data[1].owner).toBe(null);

			await request(url)
				.patch(`/items/${OWNER}/${deepOtherOwnerId}`)
				.send({ name: 'deep-matched' })
				.set('Authorization', auth);

			const written = await request(url)
				.get(`/items/${OWNER}/${deepOtherOwnerId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('deep-matched');

			const refetched = await readDeepItemsWithMatchedOwner();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data[1].owner).not.toBe(null);
		});
	});
});
