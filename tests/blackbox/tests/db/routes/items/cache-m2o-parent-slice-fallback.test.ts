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

// A read that nests M2O parents pins them by primary key, one tag per parent —
// until there are more of them than `CACHE_SCOPED_MAX_PINS_PER_COLLECTION`, the
// point past which the pins cost more Redis than the hit ratio they buy. The
// fallback is not the bare tag: the parent collection's OWN value slices cover
// the same rows at whatever cardinality those columns have, so a listing of a
// thousand parents across three zones still pins three tags instead of giving up
// on the whole collection.
//
// Every other nesting spec seeds a handful of rows and so never crosses the
// ceiling, which leaves the fallback reachable only by a listing big enough that
// nobody writes one as a test. Lowering the ceiling reaches the same branch with
// five rows, and keeps the key-pinned case beside it as the contrast.

const PARENT = 'slice_fallback_parent';
const ROOT = 'slice_fallback_root';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a nested M2O past the pin ceiling falls back to the parent's own value slices,
	not to the bare collection tag
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-slice-fallback-${vendor}`;

		// Three: above the two zones the fallback pins, below the five parents the
		// full listing nests. Both sides of the ceiling in one fixture.
		env[vendor]['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] = '3';

		let instance: ChildProcess;
		let parentIds: number[] = [];
		let quietParentId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: PARENT,
						meta: { scoped_cache_fields: ['zone'] },
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'zone', type: 'string', meta: {} },
						],
					},
					{
						collection: ROOT,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: ROOT,
				field: 'parent',
				otherCollection: PARENT,
			});

			// Five nested parents over two zones, plus one in a zone the read never
			// reaches — the slice that has to survive a purge of the other two.
			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [
					{ name: 'p1', zone: 'north' },
					{ name: 'p2', zone: 'north' },
					{ name: 'p3', zone: 'north' },
					{ name: 'p4', zone: 'south' },
					{ name: 'p5', zone: 'south' },
					{ name: 'p6', zone: 'quiet' },
				],
			});

			parentIds = parents.slice(0, 5).map((row: any) => row.id);
			quietParentId = parents[5].id;

			await CreateItem(vendor, {
				collection: ROOT,
				item: parentIds.map((parent, index) => {
					return { label: `r${index + 1}`, parent };
				}),
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

			await DeleteCollection(vendor, { collection: ROOT });
			await DeleteCollection(vendor, { collection: PARENT });
		});

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		function readRoots(query: Record<string, string>) {
			return request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({ fields: '*,parent.*', sort: 'id', ...query })
				.set('Authorization', auth);
		}

		function renameParent(id: number) {
			return request(getUrl(vendor, env))
				.patch(`/items/${PARENT}/${id}`)
				.send({ name: `renamed-${Date.now()}` })
				.set('Authorization', auth);
		}

		function tagsOf(response: request.Response): string[] {
			return String(response.headers[cacheTagsHeader] ?? '')
				.split(', ')
				.filter((tag) => tag !== '');
		}

		it(oneLine`
			pins each nested parent by key while the read stays under the ceiling
		`, async () => {
			await clearCache();

			const miss = await readRoots({ limit: '2' });
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');

			const tags = tagsOf(miss);

			expect(tags).toContain(`${PARENT}:id=${parentIds[0]}`);
			expect(tags).toContain(`${PARENT}:id=${parentIds[1]}`);
			expect(tags).not.toContain(PARENT);
		}, 60_000);

		it(oneLine`
			pins the parents' zones instead once the read nests more of them than the
			ceiling allows, leaving an untouched zone's slice warm
		`, async () => {
			await clearCache();

			const miss = await readRoots({});
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(miss.body.data).toHaveLength(5);

			const tags = tagsOf(miss);

			expect(tags).toContain(`${PARENT}:zone=north`);
			expect(tags).toContain(`${PARENT}:zone=south`);

			// Neither given up on nor pinned key by key: the fallback is the point.
			expect(tags).not.toContain(PARENT);

			expect(
				tags.some((tag) => tag.startsWith(`${PARENT}:id=`)),
			).toBe(false);

			expect((await readRoots({})).headers[cacheStatusHeader]).toBe('HIT');

			// A parent no root nests, in a zone no tag names — the entry must survive
			// it, or the fallback would be a bare tag under another name.
			await renameParent(quietParentId);
			expect((await readRoots({})).headers[cacheStatusHeader]).toBe('HIT');

			await renameParent(parentIds[0]!);
			expect((await readRoots({})).headers[cacheStatusHeader]).toBe('MISS');
		}, 60_000);
	});
});
