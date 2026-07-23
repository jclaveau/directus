import config, { getUrl, paths } from '@common/config';
import {
	CreateCollection,
	CreateField,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
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
// slice, not the whole collection. Runs on a scoped-purge redis instance (the only
// mode where this shows) and reads `x-cache-status` HIT/MISS per owner slice:
//
//   - warm owner-A and owner-B slices (a filtered read pins each to its slice tag),
//   - take-over-create on owner A (the `cache-takeover-dedup` extension returns the
//     existing A-row PK for a duplicate `dedup_key`),
//   - assert A = MISS (its slice was purged), B = HIT (its slice survived).
//
// Pre-#293 the take-over coarse-purged the whole collection, so B would MISS too —
// that B = HIT is the discriminator this test exists to pin.

const collection = 'test_items_takeover_scoped';
const ownerA = 'owner-a';
const ownerB = 'owner-b';
const cacheStatusHeader = 'x-cache-status';

async function seedSchemaAndRows(vendor: Vendor) {
	// Created via the default instance BEFORE the scoped instance spawns, so that
	// instance sees the collection (and its `scoped_cache_fields` meta) on boot.
	await CreateCollection(vendor, {
		collection,
		meta: { scoped_cache_fields: ['owner'] },
	});

	await CreateField(vendor, { collection, field: 'owner', type: 'string' });
	await CreateField(vendor, { collection, field: 'dedup_key', type: 'integer' });

	// One row per owner slice, distinct `dedup_key` so a seed never trips a take-over.
	await CreateItem(vendor, { collection, item: { owner: ownerA, dedup_key: 1 } });
	await CreateItem(vendor, { collection, item: { owner: ownerB, dedup_key: 2 } });
}

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
		env[vendor]['CACHE_NAMESPACE'] = `directus-takeover-scope-${vendor}`;

		let instance: ChildProcess;

		beforeAll(async () => {
			await seedSchemaAndRows(vendor);

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
			await DeleteCollection(vendor, { collection });
		});

		it(oneLine`
			purges only the taken-over owner slice, leaving the other warm
		`, async () => {
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both slices — a filtered read pins to its owner slice tag, not bare.
			await request(url)
				.get(`/items/${collection}`)
				.query({ 'filter[owner][_eq]': ownerA })
				.set('Authorization', auth);

			await request(url)
				.get(`/items/${collection}`)
				.query({ 'filter[owner][_eq]': ownerB })
				.set('Authorization', auth);

			// Take-over on owner A: `dedup_key` 1 already exists → the hook returns its
			// PK, nothing is inserted, and #293 scopes the purge to owner A's slice.
			await request(url)
				.post(`/items/${collection}`)
				.send({ owner: ownerA, dedup_key: 1 })
				.set('Authorization', auth);

			const sliceA = await request(url)
				.get(`/items/${collection}`)
				.query({ 'filter[owner][_eq]': ownerA })
				.set('Authorization', auth);

			const sliceB = await request(url)
				.get(`/items/${collection}`)
				.query({ 'filter[owner][_eq]': ownerB })
				.set('Authorization', auth);

			expect(sliceA.statusCode).toBe(200);
			expect(sliceB.statusCode).toBe(200);

			// The taken-over slice is dropped; the other survives (pre-#293 both MISS).
			expect(sliceA.headers[cacheStatusHeader]).toBe('MISS');
			expect(sliceB.headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
