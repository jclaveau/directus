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

// Chain course -> enrollment -> student. A `fields: ['*']` read nests the two
// ancestors internally to pin them by key; a filter on `enrollment.status` reaches
// enrollment rows that pin never named, so the key pin cannot stand for it.
const STUDENT = 'hop_student';
const ENROLLMENT = 'hop_enrollment';
const COURSE = 'hop_course';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an injected ownership ancestor a filter hops through stays bare
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-injected-ancestor-hop-${vendor}`;

		let instance: ChildProcess;
		let activeEnrollmentId: number;
		let inactiveEnrollmentId: number;
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

			const enrollments = await CreateItem(vendor, {
				collection: ENROLLMENT,
				item: [
					{ status: 'active', student: students[0].id },
					{ status: 'inactive', student: students[0].id },
				],
			});

			activeEnrollmentId = enrollments[0].id;
			inactiveEnrollmentId = enrollments[1].id;

			await CreateItem(vendor, {
				collection: COURSE,
				item: [
					{ title: 'active course', enrollment: activeEnrollmentId },
					{ title: 'inactive course', enrollment: inactiveEnrollmentId },
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

			await DeleteCollection(vendor, { collection: COURSE });
			await DeleteCollection(vendor, { collection: ENROLLMENT });
			await DeleteCollection(vendor, { collection: STUDENT });
		});

		function readActiveCourses() {
			return request(getUrl(vendor, env))
				.get(`/items/${COURSE}`)
				.query({ 'filter[enrollment][status][_eq]': 'active', fields: '*' })
				.set('Authorization', auth);
		}

		function activate(enrollmentId: number) {
			return request(getUrl(vendor, env))
				.patch(`/items/${ENROLLMENT}/${enrollmentId}`)
				.send({ status: 'active' })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			tags the hopped-through ancestor bare, not by the key it nested
		`, async () => {
			const tags = (await readActiveCourses()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${ENROLLMENT}(,|$)`));

			expect(tags).not.toMatch(
				new RegExp(`(^|, )${ENROLLMENT}:id=${activeEnrollmentId}(,|$)`),
			);
		});

		it(oneLine`
			an enrollment the filter starts matching evicts the read
		`, async () => {
			await clearCache();

			expect((await readActiveCourses()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readActiveCourses()).headers[cacheStatusHeader]).toBe('HIT');

			await activate(inactiveEnrollmentId);

			const after = await readActiveCourses();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');

			expect(after.body.data.map((course: { title: string }) => course.title).sort())
				.toEqual(['active course', 'inactive course']);
		});
	});
});
