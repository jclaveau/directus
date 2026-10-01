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

// A to-many node's own query — its `deep` filter, sort and limit, and the
// permission cases of what it nests — decides which children come back off rows
// the response never carried, so a collection it reaches is depended on beyond
// the rows the response nested (`scopedCacheCollectionsBeyondNestedRows`) and
// tags bare, or by the one slice its chain back to the root bounds. Walking only
// the root's query left such a collection with the pins of the nested rows
// alone, and a write to any other row of it served stale.
const STUDENT = 'o2mnode_student';
const COURSE = 'o2mnode_course';
const TEACHER = 'o2mnode_teacher';
const PART = 'o2mnode_part';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a to-many node's query bares the collections it reaches beyond the nested rows
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-node-query-beyond-${vendor}`;

		let instance: ChildProcess;
		let studentId: number;
		let hiddenTeacherId: number;
		let hiddenPartId: number;
		const userToken = `o2m-node-${vendor}-0000000000000000000000`;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: STUDENT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: TEACHER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: COURSE,
						meta: { scoped_cache_fields: ['student'] },
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
				collection: STUDENT,
				field: 'courses',
				otherCollection: COURSE,
				otherField: 'student',
			});

			await CreateFieldM2O(vendor, {
				collection: COURSE,
				field: 'teacher',
				otherCollection: TEACHER,
			});

			await CreateFieldO2M(vendor, {
				collection: COURSE,
				field: 'parts',
				otherCollection: PART,
				otherField: 'course',
			});

			const userResponse = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', auth)
				.send({
					first_name: 'o2m node user',
					token: userToken,
					policies: {
						create: [{
							policy: {
								name: 'o2m node policy',
								app_access: true,
								permissions: {
									create: [
										...[STUDENT, COURSE].map((collection) => {
											return {
												policy: '+',
												permissions: { id: { _nnull: true } },
												validation: null,
												fields: ['*'],
												presets: null,
												collection,
												action: 'read',
											};
										}),
										// A per-row case on the teacher: a course whose
										// teacher fails it nests a null slot instead.
										{
											policy: '+',
											permissions: { name: { _eq: 'alpha' } },
											validation: null,
											fields: ['*'],
											presets: null,
											collection: TEACHER,
											action: 'read',
										},
									],
									update: [],
									delete: [],
								},
							},
						}],
						update: [],
						delete: [],
					},
				});

			if (!userResponse.ok) {
				throw new Error(
					`Could not create user: ${JSON.stringify(userResponse.body)}`,
				);
			}

			const students = await CreateItem(vendor, {
				collection: STUDENT,
				item: [{ name: 'student' }],
			});

			studentId = students[0].id;

			const teachers = await CreateItem(vendor, {
				collection: TEACHER,
				item: [{ name: 'alpha' }, { name: 'beta' }],
			});

			hiddenTeacherId = teachers[1].id;

			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [
					{ title: 'shown', student: studentId, teacher: teachers[0].id },
					{ title: 'hidden', student: studentId, teacher: hiddenTeacherId },
				],
			});

			const parts = await CreateItem(vendor, {
				collection: PART,
				item: [
					{ note: 'x', course: courses[0].id },
					{ note: 'y', course: courses[1].id },
				],
			});

			hiddenPartId = parts[1].id;

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
			await DeleteCollection(vendor, { collection: TEACHER });
			await DeleteCollection(vendor, { collection: STUDENT });
		});

		function readStudent(
			fields: string,
			deep: Record<string, unknown>,
			authorization = auth,
		) {
			return request(getUrl(vendor, env))
				.get(`/items/${STUDENT}`)
				.query({
					fields,
					'filter[id][_eq]': studentId,
					deep: JSON.stringify({ courses: { _sort: 'id', ...deep } }),
				})
				.set('Authorization', authorization);
		}

		function titlesOf(response: request.Response): string[] {
			return response.body.data[0].courses.map((course: { title: string }) => {
				return course.title;
			});
		}

		async function expectCached(
			read: () => request.Test,
		): Promise<request.Response> {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const missed = await read();

			expect(missed.headers[cacheStatusHeader]).toBe('MISS');
			expect((await read()).headers[cacheStatusHeader]).toBe('HIT');

			return missed;
		}

		// The child itself stays pinned by its parent key: only what the node's
		// query reaches BEYOND the child goes bare.
		function expectChildPinned(tags: string): void {
			expect(tags).toMatch(
				new RegExp(`(^|, )${COURSE}:student=${studentId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${COURSE}(,|$)`));
		}

		function expectBare(tags: string, collection: string): void {
			expect(tags).toMatch(new RegExp(`(^|, )${collection}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${collection}:`));
		}

		it(oneLine`
			a deep filter through the child's m2o bares that collection, so a hidden
			course's teacher renamed into the filter surfaces the course
		`, async () => {
			const read = () => {
				return readStudent(
					'id,courses.title,courses.teacher.name',
					{ _filter: { teacher: { name: { _eq: 'alpha' } } } },
				);
			};

			const missed = await expectCached(read);

			expect(titlesOf(missed)).toEqual(['shown']);
			expectChildPinned(missed.headers[cacheTagsHeader]);
			expectBare(missed.headers[cacheTagsHeader], TEACHER);

			await request(getUrl(vendor, env))
				.patch(`/items/${TEACHER}/${hiddenTeacherId}`)
				.send({ name: 'alpha' })
				.set('Authorization', auth);

			const after = await read();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(titlesOf(after)).toEqual(['shown', 'hidden']);

			await request(getUrl(vendor, env))
				.patch(`/items/${TEACHER}/${hiddenTeacherId}`)
				.send({ name: 'beta' })
				.set('Authorization', auth);
		});

		it(oneLine`
			a deep filter through the child's o2m slices that collection by the chain
			back to the root, so a hidden course's part rewritten into the filter
			surfaces the course
		`, async () => {
			const read = () => {
				return readStudent(
					'id,courses.title',
					{ _filter: { parts: { note: { _eq: 'x' } } } },
				);
			};

			const missed = await expectCached(read);

			expect(titlesOf(missed)).toEqual(['shown']);
			expectChildPinned(missed.headers[cacheTagsHeader]);

			// Not bare: the part's composed `course.student` path walks back to the
			// root key, so that one slice names every part the filter can reach — the
			// hidden course's included, which `part:course=<shown>` alone never did.
			expect(missed.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${PART}:course\\.student=${studentId}(,|$)`),
			);

			await request(getUrl(vendor, env))
				.patch(`/items/${PART}/${hiddenPartId}`)
				.send({ note: 'x' })
				.set('Authorization', auth);

			const after = await read();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(titlesOf(after)).toEqual(['shown', 'hidden']);

			await request(getUrl(vendor, env))
				.patch(`/items/${PART}/${hiddenPartId}`)
				.send({ note: 'y' })
				.set('Authorization', auth);
		});

		it(oneLine`
			a deep sort through the child's m2o under a limit bares that collection, so
			a teacher renamed ahead of the sort surfaces the course it drops in
		`, async () => {
			const read = () => {
				return readStudent(
					'id,courses.title,courses.teacher.name',
					{ _sort: 'teacher.name', _limit: 1 },
				);
			};

			const missed = await expectCached(read);

			expect(titlesOf(missed)).toEqual(['shown']);
			expectChildPinned(missed.headers[cacheTagsHeader]);
			expectBare(missed.headers[cacheTagsHeader], TEACHER);

			await request(getUrl(vendor, env))
				.patch(`/items/${TEACHER}/${hiddenTeacherId}`)
				.send({ name: 'aaa' })
				.set('Authorization', auth);

			const after = await read();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(titlesOf(after)).toEqual(['hidden']);

			await request(getUrl(vendor, env))
				.patch(`/items/${TEACHER}/${hiddenTeacherId}`)
				.send({ name: 'beta' })
				.set('Authorization', auth);
		});

		it(oneLine`
			a permission case on the m2o the child nests bares that collection, so a
			teacher renamed into the case fills the null slot
		`, async () => {
			const read = () => {
				return readStudent('id,courses.title,courses.teacher.name', {}, asUser);
			};

			const missed = await expectCached(read);

			const teacherNamesOf = (response: request.Response) => {
				return response.body.data[0].courses.map(
					(course: { teacher: { name: string } | null }) => {
						return course.teacher?.name ?? null;
					},
				);
			};

			expect(teacherNamesOf(missed)).toEqual(['alpha', null]);
			expectChildPinned(missed.headers[cacheTagsHeader]);
			expectBare(missed.headers[cacheTagsHeader], TEACHER);

			await request(getUrl(vendor, env))
				.patch(`/items/${TEACHER}/${hiddenTeacherId}`)
				.send({ name: 'alpha' })
				.set('Authorization', auth);

			const after = await read();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(teacherNamesOf(after)).toEqual(['alpha', 'alpha']);

			await request(getUrl(vendor, env))
				.patch(`/items/${TEACHER}/${hiddenTeacherId}`)
				.send({ name: 'beta' })
				.set('Authorization', auth);
		});
	});
});
