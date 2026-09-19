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

// A leaf nested two to-manys under a key-read root, whose scope walks back to
// that root (`mid.root`), slices by the root's key even when the middle level
// returns no row: the parent pins the middle would have given are empty, so
// the leaf's tag comes from its own scope path, not from a bare tag.
const ROOT = 'eps_root';
const MID = 'eps_mid';
const LEAF = 'eps_leaf';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a to-many under an empty to-many slices along its scope path
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-under-o2m-empty-parent-${vendor}`;

		let instance: ChildProcess;
		let emptyRootId: number;
		let filledRootId: number;
		let filledLeafId: number;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						meta: {},
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: MID,
						meta: { scoped_cache_fields: ['root'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: LEAF,
						meta: { scoped_cache_fields: ['mid', 'mid.root'] },
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
				item: [{ name: 'empty' }, { name: 'filled' }],
			});

			emptyRootId = roots[0].id;
			filledRootId = roots[1].id;

			const mids = await CreateItem(vendor, {
				collection: MID,
				item: [{ name: 'mid', root: filledRootId }],
			});

			const leaves = await CreateItem(vendor, {
				collection: LEAF,
				item: [{ body: 'leaf', mid: mids[0].id }],
			});

			filledLeafId = leaves[0].id;

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

			for (const collection of [LEAF, MID, ROOT]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		const readRoot = (id: number) => {
			return request(getUrl(vendor, env))
				.get(`/items/${ROOT}/${id}`)
				.query({ fields: 'name,mids.leaves.body' })
				.set('Authorization', admin);
		};

		async function expectCached(id: number): Promise<request.Response> {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', admin);

			const missed = await readRoot(id);

			expect(missed.status).toBe(200);
			expect(missed.headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRoot(id)).headers[cacheStatusHeader]).toBe('HIT');

			return missed;
		}

		it(oneLine`
			slices the leaves by the root's key through the empty middle level
		`, async () => {
			const response = await readRoot(emptyRootId);
			const tags: string = response.headers[cacheTagsHeader];

			expect(response.body.data).toEqual({ name: 'empty', mids: [] });

			expect(tags, tags).toMatch(
				new RegExp(`(^|, )${LEAF}:mid.root=${emptyRootId}(,|$)`),
			);

			expect(tags, tags).toMatch(
				new RegExp(`(^|, )${MID}:root=${emptyRootId}(,|$)`),
			);

			expect(tags, tags).not.toMatch(new RegExp(`(^|, )${LEAF}(,|$)`));
			expect(tags, tags).not.toMatch(new RegExp(`(^|, )${MID}(,|$)`));
		});

		it('a leaf under another root leaves the read cached', async () => {
			await expectCached(emptyRootId);

			await request(getUrl(vendor, env))
				.patch(`/items/${LEAF}/${filledLeafId}`)
				.send({ body: 'leaf touched' })
				.set('Authorization', admin);

			expect((await readRoot(emptyRootId)).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a leaf given to the root evicts the read', async () => {
			await expectCached(emptyRootId);

			// Written through the cached instance: only its own purge reaches the
			// entry this read holds, the seed helpers write to the shared one.
			const mid = await request(getUrl(vendor, env))
				.post(`/items/${MID}`)
				.send({ name: 'late mid', root: emptyRootId })
				.set('Authorization', admin);

			expect(mid.status).toBe(200);

			// Creating the mid evicts through `mid:root`; read again so the
			// leaf's own slice is the one under test.
			await expectCached(emptyRootId);

			const leaf = await request(getUrl(vendor, env))
				.post(`/items/${LEAF}`)
				.send({ body: 'late leaf', mid: mid.body.data.id })
				.set('Authorization', admin);

			expect(leaf.status).toBe(200);

			const response = await readRoot(emptyRootId);

			expect(response.headers[cacheStatusHeader]).toBe('MISS');
			expect(response.body.data.mids).toEqual([{ leaves: [{ body: 'late leaf' }] }]);
		});
	});
});
