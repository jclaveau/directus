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

// A read hook scopes the response to `course:unit.owner=<owner>`, a path the course
// write derives off its flat `unit` scope. The cache-composed-path-scope-to
// extension hosts the hook; the collection names are shared with it.
const READ = 'p_composed_scope_read';
const COURSE = 'p_composed_scope_course';
const UNIT = 'p_composed_scope_unit';
const OWNER = 'p_composed_scope_owner';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a hook scoping to a composed path of a foreign collection keeps the read cached
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-composed-path-scope-to-${vendor}`;

		let instance: ChildProcess;
		let scopedOwnerId: number;
		let scopedCourseId: number;
		let otherCourseId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: UNIT,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: COURSE,
						meta: { scoped_cache_fields: ['unit'] },
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
					{
						collection: READ,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: UNIT,
				field: 'owner',
				otherCollection: OWNER,
			});

			await CreateFieldM2O(vendor, {
				collection: COURSE,
				field: 'unit',
				otherCollection: UNIT,
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'scoped' }, { name: 'other' }],
			});

			scopedOwnerId = owners[0].id;

			const units = await CreateItem(vendor, {
				collection: UNIT,
				item: [
					{ name: 'scoped unit', owner: scopedOwnerId },
					{ name: 'other unit', owner: owners[1].id },
				],
			});

			// The hook scopes to the lowest course id, so the scoped one goes first.
			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [
					{ title: 'scoped course', unit: units[0].id },
					{ title: 'other course', unit: units[1].id },
				],
			});

			scopedCourseId = courses[0].id;
			otherCourseId = courses[1].id;

			await CreateItem(vendor, { collection: READ, item: [{ name: 'row' }] });

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

			await DeleteCollection(vendor, { collection: READ });
			await DeleteCollection(vendor, { collection: COURSE });
			await DeleteCollection(vendor, { collection: UNIT });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		function readRows() {
			return request(getUrl(vendor, env))
				.get(`/items/${READ}`)
				.query({ fields: '*' })
				.set('Authorization', auth);
		}

		function updateCourse(courseId: number, title: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${COURSE}/${courseId}`)
				.send({ title })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('carries the composed-path tag the hook declared', async () => {
			expect((await readRows()).headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${COURSE}:unit\\.owner=${scopedOwnerId}(,|$)`),
			);
		});

		it('caches the read: a course write reproduces that path', async () => {
			await clearCache();

			expect((await readRows()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRows()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a course write under another owner keeps the read cached', async () => {
			await clearCache();

			expect((await readRows()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRows()).headers[cacheStatusHeader]).toBe('HIT');

			await updateCourse(otherCourseId, 'other course, edited');

			expect((await readRows()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a course write under the scoped owner evicts the read', async () => {
			await clearCache();

			expect((await readRows()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRows()).headers[cacheStatusHeader]).toBe('HIT');

			await updateCourse(scopedCourseId, 'scoped course, edited');

			expect((await readRows()).headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
