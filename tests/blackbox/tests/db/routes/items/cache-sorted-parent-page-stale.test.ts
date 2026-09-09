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

// A sort across a relation is kept out of `beyond` when the sorted collection
// declares scope fields — `read-tags.ts` reads a sort as a reorder the collection's
// own slice catches, rather than a change of membership. What makes that sound is
// not the declaration: it is that the exemption is only ever reached by a
// collection the filter already NAMED by key (`namedByFilter`), and a keyed filter
// pins every one of those keys, unioned in beside the keys the page nested.
//
// A page is where the two would come apart if they ever did. Renaming a parent the
// page never carried changes which roots fall inside the limit, and only the
// filter's pin — not the nested rows' — names that parent. Take the union away and
// this read keeps serving the page the new ordering has moved out of.
const ROOT = 'sorted_page_root';
const PARENT = 'sorted_page_parent';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a paginated read sorted across a nested parent is purged by a rename of a parent
	the page never carried
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-sorted-page-${vendor}`;

		let instance: ChildProcess;
		let parentIds: number[] = [];
		let offPageParentId: number;
		let offPageRootId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						// A declared scope field is what makes `hasCoveringSlice` true,
						// and so what keeps the sorted parent out of `beyond`.
						collection: PARENT,
						meta: { scoped_cache_fields: ['tenant'] },
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'tenant', type: 'string', meta: {} },
						],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: ROOT,
				field: 'parent',
				otherCollection: PARENT,
			});

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [
					{ name: 'b-parent', tenant: 'acme' },
					{ name: 'c-parent', tenant: 'acme' },
					{ name: 'z-parent', tenant: 'acme' },
				],
			});

			parentIds = parents.map((row: { id: number }) => row.id);
			offPageParentId = parentIds[2]!;

			const roots = await CreateItem(vendor, {
				collection: ROOT,
				item: [
					{ label: 'first', parent: parentIds[0] },
					{ label: 'second', parent: parentIds[1] },
					{ label: 'third', parent: offPageParentId },
				],
			});

			offPageRootId = roots[2].id;

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

			await DeleteCollection(vendor, { collection: ROOT });
			await DeleteCollection(vendor, { collection: PARENT });
		});

		// Two of three, ordered by the nested parent's name: the third root and its
		// parent are outside the page, which is what the rename below moves.
		//
		// The `tenant` sibling is what stops the pk condition reading as
		// `independent` — a lone `parent.id` is answered by the root's own foreign
		// key column, and an independent collection is skipped rather than pinned.
		// With it, PARENT is `keyed` on its pk, which is the arm this exercises.
		function readFirstPage() {
			return request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({
					'filter[parent][id][_in]': parentIds.join(','),
					'filter[parent][tenant][_eq]': 'acme',
					fields: 'id,label,parent.name',
					sort: 'parent.name',
					limit: '2',
				})
				.set('Authorization', auth);
		}

		function renameParent(id: number, name: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${PARENT}/${id}`)
				.send({ name })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			serves the new page after a parent outside it is renamed to sort inside it
		`, async () => {
			await clearCache();

			const miss = await readFirstPage();
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');

			expect(miss.body.data.map((row: { label: string }) => row.label))
				.toEqual(['first', 'second']);

			// The pin names all three parents, not the two this page nested — the
			// third is what the rename moves, and only the filter's keys reach it.
			const pinned = String(miss.headers[cacheTagsHeader] ?? '');
			expect(pinned).toContain(`${PARENT}:id=${offPageParentId}`);

			expect((await readFirstPage()).headers[cacheStatusHeader]).toBe('HIT');

			// `z-parent` → `a-parent` puts the third root first, so the page it was
			// never part of now holds it.
			await renameParent(offPageParentId, 'a-parent');

			const after = await readFirstPage();
			expect(after.headers[cacheStatusHeader]).toBe('MISS');

			expect(after.body.data.map((row: { id: number }) => row.id)[0])
				.toBe(offPageRootId);
		}, 60_000);
	});
});
