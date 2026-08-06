import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for the READ-side scope channel (#292): an `items.read` hook
// declares a foreign dependency via `context.scopedCache.scopeTo`, so a cached read
// participates in another collection's slice invalidation.
//
// `report` is a separate collection from `metric`; a metric write would not touch a
// cached report on its own. A read hook runs a custom readByQuery over the metric
// slice the report summarises (owner = acme) and passes THAT read's own returned
// `scopedCacheTags` to `scopeTo`, folding metric[owner=acme] into the report read's
// cache tags. Read via `x-cache-status` on a scoped-purge redis instance:
//
//   - a create in the depended-on slice (metric owner=acme) invalidates the cached
//     report → MISS.
//   - a create in a sibling slice (metric owner=globex) does not → the report stays
//     HIT, since it declared only the acme slice.

const REPORT = 'test_items_report';
const METRIC = 'test_items_metric';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	read-hook scopeTo: a custom readByQuery folds a foreign slice into the read's cache
	tags, so that slice's write invalidates the read (#292)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-read-scope-${vendor}`;

		let instance: ChildProcess;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// the collections (+ metric's `scoped_cache_fields`) on boot. metric is
			// partitioned per owner; report carries no scope of its own — it depends on
			// metric's slice only through the read hook's `scopeTo`.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: METRIC,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'amount', type: 'string', meta: {} },
						],
					},
					{
						collection: REPORT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			// Independent seeds → one round-trip.
			await Promise.all([
				CreateItem(vendor, {
					collection: METRIC,
					item: [
						{ owner: 'acme', amount: '10' },
						{ owner: 'globex', amount: '20' },
					],
				}),
				CreateItem(vendor, { collection: REPORT, item: [{ name: 'summary' }] }),
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
				DeleteCollection(vendor, { collection: METRIC }),
				DeleteCollection(vendor, { collection: REPORT }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readReport() {
			return request(getUrl(vendor, env))
				.get(`/items/${REPORT}`)
				.set('Authorization', auth);
		}

		function createMetric(owner: string) {
			return request(getUrl(vendor, env))
				.post(`/items/${METRIC}`)
				.send({ owner, amount: '99' })
				.set('Authorization', auth);
		}

		it(oneLine`
			a create in the depended-on metric slice invalidates the cached report — the
			read hook scoped it to metric[owner=acme]
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Fill (the read hook scopes the entry to metric[owner=acme]) then confirm the
			// entry is cached, over real data.
			const miss = await readReport();
			const hit = await readReport();

			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');
			expect(hit.body.data).toHaveLength(1);

			// Write into the depended-on slice → purges metric[owner=acme] → the report
			// entry it was folded into is dropped too.
			await createMetric('acme');

			expect((await readReport()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			a create in a sibling metric slice does not invalidate the report — it declared
			only the acme slice
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const miss = await readReport();
			const hit = await readReport();

			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			// Write a slice the report does NOT depend on → purges metric[owner=globex]
			// only → the report entry (tagged acme) survives.
			await createMetric('globex');

			expect((await readReport()).headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
