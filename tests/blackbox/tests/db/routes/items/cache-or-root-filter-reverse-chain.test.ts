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

// A root read whose `_or` names one student by key and another by `user` nests
// both students' courses. The key pin bounds only the first branch's rows, so a
// course slice reversed off it (`course:student=<key>`) never names the second
// student's courses. The pin ceiling is 1 so the o2m pinner declines the two
// parents and the merge has to fall back to the slice or the bare tag.
const STUDENT = 'orchain_student';
const COURSE = 'orchain_course';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a reversed slice off the root key under an _or the key does not cover stays bare
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] = '1';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-or-root-reverse-chain-${vendor}`;

		let instance: ChildProcess;
		let keyedStudentId: number;
		let otherCourseId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: STUDENT,
						meta: { scoped_cache_fields: ['user'] },
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'user', type: 'string', meta: {} },
						],
					},
					{
						collection: COURSE,
						meta: { scoped_cache_fields: ['student'] },
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldO2M(vendor, {
				collection: STUDENT,
				field: 'courses',
				otherCollection: COURSE,
				otherField: 'student',
			});

			const students = await CreateItem(vendor, {
				collection: STUDENT,
				item: [
					{ name: 'keyed', user: 'keyed-user' },
					{ name: 'other', user: 'other-user' },
				],
			});

			keyedStudentId = students[0].id;

			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [
					{ title: 'keyed course', student: keyedStudentId },
					{ title: 'other course', student: students[1].id },
				],
			});

			otherCourseId = courses[1].id;

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

			await DeleteCollection(vendor, { collection: COURSE });
			await DeleteCollection(vendor, { collection: STUDENT });
		});

		function readStudents() {
			return request(getUrl(vendor, env))
				.get(`/items/${STUDENT}`)
				.query({
					fields: 'name,courses.title',
					sort: 'id',
					filter: JSON.stringify({
						_or: [
							{ id: { _eq: keyedStudentId } },
							{ user: { _eq: 'other-user' } },
						],
					}),
				})
				.set('Authorization', auth);
		}

		function updateCourse(title: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${COURSE}/${otherCourseId}`)
				.send({ title })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			does not slice the courses off a key that covers one branch only
		`, async () => {
			const tags = (await readStudents()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${COURSE}(,|$)`));

			expect(tags).not.toMatch(
				new RegExp(`(^|, )${COURSE}:student=${keyedStudentId}(,|$)`),
			);
		});

		it("a write to the other branch's course evicts the read", async () => {
			await clearCache();

			expect((await readStudents()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readStudents()).headers[cacheStatusHeader]).toBe('HIT');

			await updateCourse('other course, edited');

			const after = await readStudents();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data[1].courses[0].title).toBe('other course, edited');
		});
	});
});
