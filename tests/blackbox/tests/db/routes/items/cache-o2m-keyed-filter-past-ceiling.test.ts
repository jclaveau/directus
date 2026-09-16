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

// A root read filtered by an o2m child's keys nests no child, yet the o2m pinner
// pins the child by the parent keys it returned (`part:course=<parent>`). Under
// the ceiling the keyed filter's own pins stand beside that and name every part
// the filter reads; past it they are dropped and the parent pins stand alone —
// a part the filter names but no returned course owns is then covered by nothing.
const COURSE = 'o2mceil_course';
const PART = 'o2mceil_part';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an o2m child a filter keys past the ceiling stays bare, not pinned by its parents
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] = '2';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-keyed-past-ceiling-${vendor}`;

		let instance: ChildProcess;
		let ownedCourseId: number;
		let orphanCourseId: number;
		let orphanPartId: number;
		let keyedPartIds: number[];
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: COURSE,
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
					{
						collection: PART,
						meta: { scoped_cache_fields: ['course'] },
						fields: [{ field: 'note', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldO2M(vendor, {
				collection: COURSE,
				field: 'parts',
				otherCollection: PART,
				otherField: 'course',
			});

			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [{ title: 'owned' }, { title: 'orphan' }],
			});

			ownedCourseId = courses[0].id;
			orphanCourseId = courses[1].id;

			const parts = await CreateItem(vendor, {
				collection: PART,
				item: [
					{ note: 'one', course: ownedCourseId },
					{ note: 'two', course: ownedCourseId },
					{ note: 'orphan', course: null },
				],
			});

			keyedPartIds = parts.map((part: { id: number }) => part.id);
			orphanPartId = parts[2].id;

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

			await DeleteCollection(vendor, { collection: PART });
			await DeleteCollection(vendor, { collection: COURSE });
		});

		function readCourses() {
			return request(getUrl(vendor, env))
				.get(`/items/${COURSE}`)
				.query({
					fields: 'title',
					sort: 'id',
					'filter[parts][id][_in]': keyedPartIds.join(','),
				})
				.set('Authorization', auth);
		}

		it('carries the bare child tag, not the returned parents\' pins', async () => {
			const tags = (await readCourses()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${PART}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${PART}:`));
		});

		it('a keyed part adopted by another course evicts the read', async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			expect((await readCourses()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readCourses()).headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.patch(`/items/${PART}/${orphanPartId}`)
				.send({ course: orphanCourseId })
				.set('Authorization', auth);

			const after = await readCourses();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');

			expect(after.body.data.map((course: { title: string }) => course.title))
				.toEqual(['owned', 'orphan']);
		});
	});
});
