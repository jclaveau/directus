import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldO2M,
	CreateItem,
	DeleteCollection,
	DeleteField,
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

// A system controller hands `respond` the service's result and nothing else, so
// before #505 the response was tagged with the route's own collection only. The
// relations the read nested — here an O2M alias on the user — were invisible to
// every purge, and a write to one of them left the entry stale for its whole TTL.
// `/users/me` is the route the dev audit caught it on; every system route reading
// through a service has the same shape.

const STUDENT = 'users_me_nested_student';
const ALIAS = 'users_me_nested_students';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a system route's response is tagged with the relations it nested (#505)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-users-me-nested-${vendor}`;

		let instance: ChildProcess;
		let adminId: string;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: STUDENT,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			// The `students` alias on the user AND the `user` fk on the student.
			await CreateFieldO2M(vendor, {
				collection: 'directus_users',
				field: ALIAS,
				otherCollection: STUDENT,
				otherField: 'user',
				primaryKeyType: 'uuid',
			});

			adminId = (
				await request(getUrl(vendor))
					.get('/users/me')
					.query({ fields: 'id' })
					.set('Authorization', auth)
			).body.data.id;

			await CreateItem(vendor, {
				collection: STUDENT,
				item: [{ label: 'before', user: adminId }],
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

			await DeleteField(vendor, { collection: 'directus_users', field: ALIAS });
			await DeleteCollection(vendor, { collection: STUDENT });
		});

		function readMe() {
			return request(getUrl(vendor, env))
				.get('/users/me')
				.query({ fields: `id,${ALIAS}.label` })
				.set('Authorization', auth);
		}

		it('names the nested collection in its tags', async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const read = await readMe();

			expect(read.headers[cacheStatusHeader]).toBe('MISS');

			expect(read.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${STUDENT}(:|,|$)`),
			);
		});

		it('is dropped by a write to the collection it nested', async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warm = await readMe();
			expect(warm.body.data[ALIAS]).toEqual([{ label: 'before' }]);

			// Non-vacuity: the entry is served from the cache before the write.
			const hit = await readMe();
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			await request(url)
				.post(`/items/${STUDENT}`)
				.send({ label: 'after', user: adminId })
				.set('Authorization', auth);

			const refetched = await readMe();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');

			expect(refetched.body.data[ALIAS]).toEqual([
				{ label: 'before' },
				{ label: 'after' },
			]);
		});
	});
});
