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
import knex from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for the take-over cache-scoping contract (#292): when a create
// hook takes over a row (returns an existing PK), the scoped purge is COARSE by
// default — a take-over can be an upsert that MOVES the row between slices, and the
// create path can't recover the old slice, so a narrow guess would leak it. A hook
// that knows its footprint opts into a precise purge via `scopedCache.addTag`.
//
// Both fixtures are enrollments (a student in a course), cache-partitioned per
// student, on a scoped-purge redis instance (the only mode where the difference
// shows), read via `x-cache-status` HIT/MISS per student slice:
//
//   - `test_items_enrollment` + a DECLARED read-only dedup hook → narrow: only the
//     re-enrolled student's slice is purged, the other stays warm.
//   - `test_items_enrollment_transfer` + an UNDECLARED move hook (re-assigns the row
//     to a new student) → coarse: the moved-FROM slice is purged, can't go stale.

const enrollment = 'test_items_enrollment';
const transfer = 'test_items_enrollment_transfer';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	create take-over cache scope: coarse by default, narrow when the hook declares
	(#292)
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
			// the collections (+ their `scoped_cache_fields` meta) on boot. Scope=student.
			await CreateCollections(vendor, {
				collections: [enrollment, transfer].map((collection) => {
					return {
						collection,
						meta: { scoped_cache_fields: ['student'] },
						fields: [
							{ field: 'student', type: 'string' },
							{ field: 'course', type: 'string' },
						],
					};
				}),
			});

			// A real M2M pivot carries UNIQUE(left, right); the dedup hook returns the
			// existing row on a duplicate rather than hit that constraint. Add it via
			// knex (the Directus fields API has no composite-unique) so a hook-less dup
			// would raise a DB error the hook is proven to prevent.
			const db = knex(config.knexConfig[vendor]!);

			try {
				await Promise.all(
					[enrollment, transfer].map((collection) => {
						return db.schema.alterTable(collection, (table) => {
							table.unique(['student', 'course']);
						});
					}),
				);
			}
			finally {
				await db.destroy();
			}

			// Independent seeds (distinct collections) → one round-trip.
			await Promise.all([
				CreateItem(vendor, {
					collection: enrollment,
					item: [
						{ student: 'ada', course: 'algebra' },
						{ student: 'bob', course: 'biology' },
					],
				}),
				CreateItem(vendor, {
					collection: transfer,
					item: [{ student: 'ada', course: 'algebra' }],
				}),
			]);

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

			await Promise.all([
				DeleteCollection(vendor, { collection: enrollment }),
				DeleteCollection(vendor, { collection: transfer }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readStudent(collection: string, student: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[student][_eq]': student })
				.set('Authorization', auth);
		}

		it(oneLine`
			a DECLARED read-only dedup take-over narrows to the re-enrolled student,
			leaving the other warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both student slices (independent reads).
			await Promise.all([
				readStudent(enrollment, 'ada'),
				readStudent(enrollment, 'bob'),
			]);

			// Re-enroll ada in the course she takes: the dedup hook finds (ada, algebra),
			// declares ada's slice, returns its PK → a narrow, precise purge of ada only.
			await request(url)
				.post(`/items/${enrollment}`)
				.send({ student: 'ada', course: 'algebra' })
				.set('Authorization', auth);

			const [ada, bob] = await Promise.all([
				readStudent(enrollment, 'ada'),
				readStudent(enrollment, 'bob'),
			]);

			expect(ada.headers[cacheStatusHeader]).toBe('MISS');
			expect(bob.headers[cacheStatusHeader]).toBe('HIT');

			// Non-vacuity: the HIT/MISS is over real, unchanged data — the dedup was a
			// no-op, so each student still has her one enrollment.
			expect(ada.body.data).toHaveLength(1);
			expect(bob.body.data).toHaveLength(1);
		});

		it(oneLine`
			an UNDECLARED move take-over purges coarse — the moved-FROM student's slice is
			dropped, so it cannot serve a stale row
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm ada's slice — it holds her algebra enrollment.
			const adaBefore = await readStudent(transfer, 'ada');
			expect(adaBefore.body.data).toHaveLength(1);

			// Enrol bob in algebra: the move hook re-assigns the (ada, algebra) row to bob
			// and returns its PK. It declares nothing → the take-over purges coarse.
			await request(url)
				.post(`/items/${transfer}`)
				.send({ student: 'bob', course: 'algebra' })
				.set('Authorization', auth);

			const [ada, bob] = await Promise.all([
				readStudent(transfer, 'ada'),
				readStudent(transfer, 'bob'),
			]);

			// Coarse purge dropped ada's slice: a re-read MISSes and returns nothing — the
			// row moved to bob. A narrow (new-slice-only) purge would leave ada stale.
			expect(ada.headers[cacheStatusHeader]).toBe('MISS');
			expect(ada.body.data).toHaveLength(0);
			expect(bob.body.data).toHaveLength(1);
		});

		it(oneLine`
			deduplicates the (student, course) pivot pair — a duplicate reuses the existing
			row, a distinct pair creates a new one
		`, async () => {
			const url = getUrl(vendor, env);
			const existingId = (await readStudent(enrollment, 'ada')).body.data[0].id;

			// Duplicate (ada, algebra): the hook finds the pair and returns its PK, so the
			// response is the existing row and no second row is inserted — a plain insert
			// would violate UNIQUE(student, course) and 500, so 200 proves the hook ran.
			const duplicate = await request(url)
				.post(`/items/${enrollment}`)
				.send({ student: 'ada', course: 'algebra' })
				.set('Authorization', auth);

			expect(duplicate.statusCode).toBe(200);
			expect(duplicate.body.data.id).toBe(existingId);
			expect((await readStudent(enrollment, 'ada')).body.data).toHaveLength(1);

			// Control: a distinct pair (cal, physics) has no match, so it's a real insert
			// with a fresh PK.
			const distinct = await request(url)
				.post(`/items/${enrollment}`)
				.send({ student: 'cal', course: 'physics' })
				.set('Authorization', auth);

			expect(distinct.body.data.id).not.toBe(existingId);
			expect((await readStudent(enrollment, 'cal')).body.data).toHaveLength(1);
		});
	});
});
