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

// A filter crossing an M2O to the far pk is answered by the near row's own fk
// column. With `_eq` that column is bounded to one value and, as a scoped field,
// pins `enrollment:course=X`. With `_neq` (or `_gt`, `_nnull`, `_nin`) it is
// bounded to nothing: a write moving the column emits slices this read never
// held, so the near collection has to be tagged bare — never keyed on no key.
const COURSE = 'nk_course';
const ENROLLMENT = 'nk_enrollment';
const STUDENT = 'nk_student';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read whose filter bounds a scoped fk to no key depends on the near collection
	wholesale
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-m2o-through-fk-no-key-${vendor}`;

		let instance: ChildProcess;
		let mathId: number;
		let artId: number;
		let movedEnrollmentId: number;
		let movedStudentId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: COURSE,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: ENROLLMENT,
						meta: { scoped_cache_fields: ['course'] },
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						collection: STUDENT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: ENROLLMENT,
				field: 'course',
				otherCollection: COURSE,
			});

			// An M2O from the student, not a to-many: a to-many alias never keys the
			// rows it nests, so only this shape can pin the enrollment by its fk at all.
			await CreateFieldM2O(vendor, {
				collection: STUDENT,
				field: 'enrollment',
				otherCollection: ENROLLMENT,
			});

			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [{ name: 'math' }, { name: 'art' }],
			});

			mathId = courses[0].id;
			artId = courses[1].id;

			const enrollments = await CreateItem(vendor, {
				collection: ENROLLMENT,
				item: [
					{ label: 'ann-math', course: mathId },
					{ label: 'bob-art', course: artId },
					{ label: 'cid-math', course: mathId },
				],
			});

			movedEnrollmentId = enrollments[2].id;

			const students = await CreateItem(vendor, {
				collection: STUDENT,
				item: [
					{ name: 'ann', enrollment: enrollments[0].id },
					{ name: 'bob', enrollment: enrollments[1].id },
					{ name: 'cid', enrollment: enrollments[2].id },
				],
			});

			movedStudentId = students[2].id;

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

			await DeleteCollection(vendor, { collection: STUDENT });
			await DeleteCollection(vendor, { collection: ENROLLMENT });
			await DeleteCollection(vendor, { collection: COURSE });
		});

		// Students enrolled outside math — bob, until cid's enrollment moves.
		function readStudentsNotInMath() {
			return request(getUrl(vendor, env))
				.get(`/items/${STUDENT}`)
				.query({
					'filter[enrollment][course][id][_neq]': mathId,
					fields: 'id,enrollment.id',
					sort: 'id',
				})
				.set('Authorization', auth);
		}

		function readStudentsInMath() {
			return request(getUrl(vendor, env))
				.get(`/items/${STUDENT}`)
				.query({
					'filter[enrollment][course][id][_eq]': mathId,
					fields: 'id,enrollment.id',
					sort: 'id',
				})
				.set('Authorization', auth);
		}

		function moveEnrollment(courseId: number) {
			return request(getUrl(vendor, env))
				.patch(`/items/${ENROLLMENT}/${movedEnrollmentId}`)
				.send({ course: courseId })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('tags the near collection bare rather than keyed on no key', async () => {
			const tags = (await readStudentsNotInMath()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${ENROLLMENT}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${ENROLLMENT}:course=`));
		});

		it(oneLine`
			the _eq read of the same fk still pins its slice, never bare
		`, async () => {
			const tags = (await readStudentsInMath()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${ENROLLMENT}:course=${mathId}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${ENROLLMENT}(,|$)`));
		});

		it(oneLine`
			a move of an enrollment INTO the filtered set is served fresh, not from the
			entry that pinned only the rows it carried
		`, async () => {
			await clearCache();

			const filled = await readStudentsNotInMath();
			expect(filled.headers[cacheStatusHeader]).toBe('MISS');
			expect(filled.body.data.map((row: { id: number }) => row.id))
				.not.toContain(movedStudentId);

			expect((await readStudentsNotInMath()).headers[cacheStatusHeader]).toBe('HIT');

			// Emits `nk_enrollment`, `nk_enrollment:id=<moved>`, `:course=<math>` and
			// `:course=<art>` — of which only the bare tag can name an entry that
			// nested no cid row.
			expect((await moveEnrollment(artId)).status).toBe(200);

			const after = await readStudentsNotInMath();
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data.map((row: { id: number }) => row.id))
				.toContain(movedStudentId);

			await moveEnrollment(mathId);
		});
	});
});
