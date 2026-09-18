import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
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

// root -> links (o2m) -> segment (m2o): an M2O parent reached through an o2m child,
// so it pins by its own pk, descending `links` to the surfaced rows.
const ROOT = 'mth_root';
const LINK = 'mth_link';
const SEGMENT = 'mth_segment';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read key-slices an M2O parent reached through an o2m child, by pk (#415)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-m2o-through-o2m-${vendor}`;

		let instance: ChildProcess;
		let ownedRootId: number;
		let ownedSegmentId: number;
		let siblingSegmentId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: LINK,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						// No scope field needed: the pin is by pk, which every write emits.
						collection: SEGMENT,
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			// root -o2m-> link, then link -m2o-> segment: reaching the segment crosses
			// the `links` array before the final M2O hop.
			await CreateFieldO2M(vendor, {
				collection: ROOT,
				field: 'links',
				otherCollection: LINK,
				otherField: 'root',
			});

			await CreateFieldM2O(vendor, {
				collection: LINK,
				field: 'segment',
				otherCollection: SEGMENT,
			});

			const segments = await CreateItem(vendor, {
				collection: SEGMENT,
				item: [{ body: 'owned segment' }, { body: 'sibling segment' }],
			});

			ownedSegmentId = segments[0].id;
			siblingSegmentId = segments[1].id;

			const roots = await CreateItem(vendor, {
				collection: ROOT,
				item: [{ name: 'root-owned' }, { name: 'root-sibling' }],
			});

			ownedRootId = roots[0].id;

			await CreateItem(vendor, {
				collection: LINK,
				item: [
					{ name: 'owned link', root: roots[0].id, segment: segments[0].id },
					{ name: 'sibling link', root: roots[1].id, segment: segments[1].id },
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

			await DeleteCollection(vendor, { collection: LINK });
			await DeleteCollection(vendor, { collection: ROOT });
			await DeleteCollection(vendor, { collection: SEGMENT });
		});

		function readRoot() {
			return request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({
					'filter[id][_eq]': String(ownedRootId),
					fields: '*,links.segment.*',
				})
				.set('Authorization', auth);
		}

		function updateSegment(id: number, body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${SEGMENT}/${id}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('pins the segment behind the junction by its pk, never bare', async () => {
			const tags = (await readRoot()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${SEGMENT}:id=${ownedSegmentId}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${SEGMENT}(,|$)`));
		});

		it('a write to another root\'s segment keeps the read cached', async () => {
			await clearCache();

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRoot()).headers[cacheStatusHeader]).toBe('HIT');

			await updateSegment(siblingSegmentId, 'sibling segment touched');

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a write to this root\'s own segment evicts the read', async () => {
			await clearCache();

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRoot()).headers[cacheStatusHeader]).toBe('HIT');

			await updateSegment(ownedSegmentId, 'owned segment touched');

			expect((await readRoot()).headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
