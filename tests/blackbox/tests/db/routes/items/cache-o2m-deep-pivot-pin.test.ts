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

// root → mids (o2m) → leaves (o2m): the leaf hangs off an all-O2M prefix, so the pin
// descends the `mids` array to the mid pks it keys `dp_leaf:mid=<midPk>` by.
const ROOT = 'dp_root';
const MID = 'dp_mid';
const LEAF = 'dp_leaf';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read key-slices a to-many nested under another to-many, a deep pivot (#412)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-deep-pivot-${vendor}`;

		let instance: ChildProcess;
		let ownedRootId: number;
		let ownedMidId: number;
		let ownedLeafId: number;
		let siblingLeafId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: MID,
						meta: { scoped_cache_fields: ['root'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: LEAF,
						meta: { scoped_cache_fields: ['mid'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldO2M(vendor, {
				collection: ROOT,
				field: 'mids',
				otherCollection: MID,
				otherField: 'root',
			});

			await CreateFieldO2M(vendor, {
				collection: MID,
				field: 'leaves',
				otherCollection: LEAF,
				otherField: 'mid',
			});

			const roots = await CreateItem(vendor, {
				collection: ROOT,
				item: [{ name: 'root-owned' }, { name: 'root-sibling' }],
			});

			ownedRootId = roots[0].id;

			const mids = await CreateItem(vendor, {
				collection: MID,
				item: [
					{ name: 'mid-owned', root: roots[0].id },
					{ name: 'mid-sibling', root: roots[1].id },
				],
			});

			ownedMidId = mids[0].id;

			const leaves = await CreateItem(vendor, {
				collection: LEAF,
				item: [
					{ body: 'leaf-owned', mid: mids[0].id },
					{ body: 'leaf-sibling', mid: mids[1].id },
				],
			});

			ownedLeafId = leaves[0].id;
			siblingLeafId = leaves[1].id;

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

			await DeleteCollection(vendor, { collection: LEAF });
			await DeleteCollection(vendor, { collection: MID });
			await DeleteCollection(vendor, { collection: ROOT });
		});

		// Reads the owned root and its whole `mids.leaves` subtree.
		function readRoot() {
			return request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({
					'filter[id][_eq]': String(ownedRootId),
					fields: '*,mids.leaves.*',
				})
				.set('Authorization', auth);
		}

		function updateLeaf(id: number, body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${LEAF}/${id}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('key-slices the two-hop-deep leaf by its parent fk, never bare', async () => {
			const tags = (await readRoot()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${LEAF}:mid=${ownedMidId}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${LEAF}(,|$)`));

			// The intermediate mid (a direct O2M under the root) slices too.
			expect(tags).toMatch(new RegExp(`(^|, )${MID}:root=${ownedRootId}(,|$)`));
		});

		it('a write to another root\'s deep leaf keeps the read cached', async () => {
			await clearCache();

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRoot()).headers[cacheStatusHeader]).toBe('HIT');

			await updateLeaf(siblingLeafId, 'sibling leaf touched');

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a write to this root\'s own deep leaf evicts the read', async () => {
			await clearCache();

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRoot()).headers[cacheStatusHeader]).toBe('HIT');

			await updateLeaf(ownedLeafId, 'owned leaf touched');

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it('leaves the deep leaf bare when a filter reaches into it', async () => {
			// A filter into the leaf makes the read depend on leaf rows beyond the ones
			// it nested, so the pin declines to bare at depth just as it does shallow.
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({
					'filter[mids][leaves][body][_eq]': 'leaf-owned',
					fields: '*,mids.leaves.*',
				})
				.set('Authorization', auth)).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${LEAF}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${LEAF}:mid=`));
		});
	});
});
