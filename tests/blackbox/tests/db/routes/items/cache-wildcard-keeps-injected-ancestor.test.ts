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

// Chain course -> enrollment -> student, every hop an ownership ancestor the read
// nests internally to pin. A depth wildcard nests the same hops for the caller, and
// the strip that removes the injection has to read `*.*` as nesting `enrollment`
// rather than delete a relation the caller asked for.
const STUDENT = 'wild_student';
const ENROLLMENT = 'wild_enrollment';
const COURSE = 'wild_course';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a depth wildcard keeps the ownership ancestors it nests in the response
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-wildcard-injected-ancestor-${vendor}`;

		let instance: ChildProcess;
		let studentId: number;
		let enrollmentId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: STUDENT,
						meta: { scoped_cache_fields: ['user'] },
						fields: [{ field: 'user', type: 'string', meta: {} }],
					},
					{
						collection: ENROLLMENT,
						meta: { scoped_cache_fields: ['student'] },
						fields: [{ field: 'status', type: 'string', meta: {} }],
					},
					{
						collection: COURSE,
						meta: { scoped_cache_fields: ['enrollment'] },
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: ENROLLMENT,
				field: 'student',
				otherCollection: STUDENT,
			});

			await CreateFieldM2O(vendor, {
				collection: COURSE,
				field: 'enrollment',
				otherCollection: ENROLLMENT,
			});

			const students = await CreateItem(vendor, {
				collection: STUDENT,
				item: [{ user: 'u1' }],
			});

			studentId = students[0].id;

			const enrollments = await CreateItem(vendor, {
				collection: ENROLLMENT,
				item: [{ status: 'active', student: studentId }],
			});

			enrollmentId = enrollments[0].id;

			await CreateItem(vendor, {
				collection: COURSE,
				item: [{ title: 'course', enrollment: enrollmentId }],
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

			await DeleteCollection(vendor, { collection: COURSE });
			await DeleteCollection(vendor, { collection: ENROLLMENT });
			await DeleteCollection(vendor, { collection: STUDENT });
		});

		function readCourses(fields: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${COURSE}`)
				.query({ fields })
				.set('Authorization', auth);
		}

		it('`*.*` returns the enrollment row with its student as a key', async () => {
			const response = await readCourses('*.*');

			expect(response.body.data[0].enrollment).toEqual({
				id: enrollmentId,
				status: 'active',
				student: studentId,
			});
		});

		it('`*.*.*` returns the student row nested under the enrollment', async () => {
			const response = await readCourses('*.*.*');

			expect(response.body.data[0].enrollment.student).toEqual({
				id: studentId,
				user: 'u1',
			});
		});

		it('still pins the ancestor the wildcard nested, by key', async () => {
			const tags = (await readCourses('*.*')).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${STUDENT}:id=${studentId}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${STUDENT}(,|$)`));
		});
	});
});
