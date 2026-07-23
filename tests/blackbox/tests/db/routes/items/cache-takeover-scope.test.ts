import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
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

// End-to-end witness for #293: a create hook that takes over a row (returns an
// existing PK — the M2M-dedup pattern) purges only the taken-over row's OWN scope
// slice, not the whole collection. The fixture is an enrollment (a student in a
// course), cache-partitioned per student. Runs on a scoped-purge redis instance (the
// only mode where this shows) and reads `x-cache-status` HIT/MISS per student slice:
//
//   - warm ada's slice and bob's slice (a filtered read pins each to its slice tag),
//   - re-enroll ada in a course she already takes — the `cache-takeover-dedup` hook
//     finds the existing (student, course) row and returns its PK (a take-over),
//   - assert ada = MISS (her slice was purged), bob = HIT (his slice survived).
//
// Pre-#293 the take-over coarse-purged the whole collection, so bob would MISS too —
// that bob = HIT is the discriminator this test exists to pin.

const enrollment = 'test_items_enrollment';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	create take-over narrows the scoped purge to the taken-over slice (#293)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-enrollment-${vendor}`;

		let instance: ChildProcess;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// the collection (+ its `scoped_cache_fields` meta) on boot. Fields fold into
			// one batch POST so the collection + its student scope field land together.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: enrollment,
						meta: { scoped_cache_fields: ['student'] },
						fields: [
							{ field: 'student', type: 'string' },
							{ field: 'course', type: 'string' },
						],
					},
				],
			});

			// One enrollment per student, so a filtered read pins to a single student
			// slice. Array body → one batched createMany POST.
			await CreateItem(vendor, {
				collection: enrollment,
				item: [
					{ student: 'ada', course: 'algebra' },
					{ student: 'bob', course: 'biology' },
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
			await DeleteCollection(vendor, { collection: enrollment });
		});

		it(oneLine`
			purges only the taken-over student's slice, leaving the other warm
		`, async () => {
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both slices — a filtered read pins to its student slice tag, not bare.
			await request(url)
				.get(`/items/${enrollment}`)
				.query({ 'filter[student][_eq]': 'ada' })
				.set('Authorization', auth);

			await request(url)
				.get(`/items/${enrollment}`)
				.query({ 'filter[student][_eq]': 'bob' })
				.set('Authorization', auth);

			// Re-enroll ada in a course she already takes: the (ada, algebra) row exists →
			// the hook returns its PK, nothing inserted, and #293 scopes the purge to ada.
			await request(url)
				.post(`/items/${enrollment}`)
				.send({ student: 'ada', course: 'algebra' })
				.set('Authorization', auth);

			const adaSlice = await request(url)
				.get(`/items/${enrollment}`)
				.query({ 'filter[student][_eq]': 'ada' })
				.set('Authorization', auth);

			const bobSlice = await request(url)
				.get(`/items/${enrollment}`)
				.query({ 'filter[student][_eq]': 'bob' })
				.set('Authorization', auth);

			expect(adaSlice.statusCode).toBe(200);
			expect(bobSlice.statusCode).toBe(200);

			// The taken-over slice is dropped; the other survives (pre-#293 both MISS).
			expect(adaSlice.headers[cacheStatusHeader]).toBe('MISS');
			expect(bobSlice.headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
