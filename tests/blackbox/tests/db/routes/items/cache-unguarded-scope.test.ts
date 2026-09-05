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

// The host captures a read's purge counters BEFORE its query, for the collections
// it can name from the AST and the filter. A read hook's `scopeTo` names one it
// cannot: it runs after those rows are already fetched, so a purge of that
// collection landing mid-read passes the post-fill comparison unnoticed and the
// response is stored already stale, under an index the purge just swept.
//
// A hook keeps such a response cacheable by handing over the counters its own
// dependent read captured, which is the right value by construction. The two
// collections below are the same dependency declared each way.

const UNGUARDED_READ = 'unguarded_read';
const UNGUARDED_DEP = 'unguarded_dep';
const GUARDED_READ = 'guarded_read';
const GUARDED_DEP = 'guarded_dep';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a read scoped to a collection whose purge counter it never captured is not
	cached; handing the counters over is what keeps it cacheable
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-unguarded-${vendor}`;

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					UNGUARDED_READ,
					UNGUARDED_DEP,
					GUARDED_READ,
					GUARDED_DEP,
				].map((collection) => {
					return {
						collection,
						fields: [
							{ field: 'label', type: 'string', meta: {} },
							{ field: 'slot', type: 'string', meta: {} },
						],
					};
				}),
			});

			await Promise.all([
				UNGUARDED_READ,
				UNGUARDED_DEP,
				GUARDED_READ,
				GUARDED_DEP,
			].map((collection) => {
				return CreateItem(vendor, {
					collection,
					item: [{ label: 'v1', slot: 'race' }],
				});
			}));

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance?.kill();

			await Promise.all([
				UNGUARDED_READ,
				UNGUARDED_DEP,
				GUARDED_READ,
				GUARDED_DEP,
			].map((collection) => DeleteCollection(vendor, { collection })));
		});

		function read(collection: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				// The hook writes only for this slice, so the write cannot depend on
				// which test runs first, nor on how many times the read path emits
				// its filter for one request.
				.query({ 'filter[slot][_eq]': 'race' })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			leaves the response uncached when the hook declares a foreign collection
			without its counters, so the enrichment the in-flight write superseded is
			never served again
		`, async () => {
			await clearCache();

			// Not asserted on: the read path may emit its filter more than once for one
			// request, so which side of the hook's write this enrichment landed on is
			// not the subject. What must not happen is it being STORED.
			const warm = await read(UNGUARDED_READ);
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			const after = await read(UNGUARDED_READ);

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data[0].dep_label).toBe('v2');
		});

		it(oneLine`
			caches a response whose hook handed the dependent read's counters over, and
			a write to that dependency still invalidates it
		`, async () => {
			await clearCache();

			const first = await read(GUARDED_READ);
			const second = await read(GUARDED_READ);

			// The control for the refusal above: declaring a foreign collection is
			// still a cacheable thing to do, given the counters that make it checkable.
			expect(first.headers[cacheStatusHeader]).toBe('MISS');
			expect(second.headers[cacheStatusHeader]).toBe('HIT');
			expect(second.body.data[0].dep_label).toBe('v1');

			const dep = await read(GUARDED_DEP);

			await request(getUrl(vendor, env))
				.patch(`/items/${GUARDED_DEP}/${dep.body.data[0].id}`)
				.send({ label: 'v2' })
				.set('Authorization', auth);

			const afterDepWrite = await read(GUARDED_READ);

			expect(afterDepWrite.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterDepWrite.body.data[0].dep_label).toBe('v2');
		});
	});
});
