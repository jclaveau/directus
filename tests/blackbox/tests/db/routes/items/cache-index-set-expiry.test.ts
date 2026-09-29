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
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The two scripts every scoped fill and purge sends, read back from the Redis they
// ran against: every other spec asserts them by effect, which a fresh index set
// left unbounded, a set cut short by a shorter-lived entry, or a purge counter
// recreated at 1 all pass. Two instances share one namespace, one caching for a
// minute and one for an hour, so a set can be filed by entries of both lifetimes.

const NOTE = 'index_expiry_note';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	an index set lives as long as the longest-lived entry filed in it, and a purge
	counter starts at the server clock
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const namespace = `directus-index-expiry-${vendor}`;

		const slotIndexKey
			= `${namespace}:scoped-cache-index:fingerprint:${NOTE}:slot=a`;

		const noteEpochKey = `${namespace}:scoped-cache-epoch:${NOTE}`;

		const shortEnv = cloneDeep(config.envs);
		const longEnv = cloneDeep(config.envs);

		for (const [instanceEnv, cacheTtl] of [
			[shortEnv, '1m'],
			[longEnv, '1h'],
		] as const) {
			instanceEnv[vendor]['CACHE_ENABLED'] = 'true';
			instanceEnv[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			instanceEnv[vendor]['CACHE_AUTO_PURGE'] = 'true';
			instanceEnv[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
			instanceEnv[vendor]['CACHE_STORE'] = 'redis';
			instanceEnv[vendor]['REDIS_HOST'] = 'localhost';
			instanceEnv[vendor]['REDIS_PORT'] = '6108';
			instanceEnv[vendor]['CACHE_NAMESPACE'] = namespace;
			instanceEnv[vendor]['CACHE_TTL'] = cacheTtl;
		}

		const redisClient = new Redis({ host: 'localhost', port: 6108 });
		const adminAuth = `Bearer ${USER.ADMIN.TOKEN}`;
		let shortInstance: ChildProcess;
		let longInstance: ChildProcess;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: NOTE,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, {
				collection: NOTE,
				item: [{ slot: 'a', label: 'v1' }],
			});

			shortEnv[vendor].PORT = String(await getPort());
			longEnv[vendor].PORT = String(await getPort());

			shortInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: shortEnv[vendor],
			});

			longInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: longEnv[vendor],
			});

			await awaitDirectusConnection(Number(shortEnv[vendor].PORT));
			await awaitDirectusConnection(Number(longEnv[vendor].PORT));
		}, 60_000);

		beforeEach(async () => {
			await request(getUrl(vendor, shortEnv))
				.post('/utils/cache/clear')
				.set('Authorization', adminAuth);

			await redisClient.del(slotIndexKey, noteEpochKey);
		});

		afterAll(async () => {
			shortInstance?.kill();
			longInstance?.kill();

			await redisClient.del(slotIndexKey, noteEpochKey);
			await redisClient.quit();

			await DeleteCollection(vendor, { collection: NOTE });
		});

		it(oneLine`
			gives a freshly created set twice the TTL of the entry filing it
		`, async () => {
			const filled = await request(getUrl(vendor, shortEnv))
				.get(`/items/${NOTE}`)
				.query({ 'filter[slot][_eq]': 'a', fields: 'id' })
				.set('Authorization', adminAuth);

			expect(filled.headers[cacheStatusHeader]).toBe('MISS');
			expect(await redisClient.ttl(slotIndexKey)).toBeGreaterThan(100);
			expect(await redisClient.ttl(slotIndexKey)).toBeLessThanOrEqual(120);
		});

		it(oneLine`
			lengthens the set when a longer-lived entry is filed in it
		`, async () => {
			await request(getUrl(vendor, shortEnv))
				.get(`/items/${NOTE}`)
				.query({ 'filter[slot][_eq]': 'a', fields: 'id' })
				.set('Authorization', adminAuth);

			const filled = await request(getUrl(vendor, longEnv))
				.get(`/items/${NOTE}`)
				.query({ 'filter[slot][_eq]': 'a', fields: 'label' })
				.set('Authorization', adminAuth);

			expect(filled.headers[cacheStatusHeader]).toBe('MISS');
			expect(await redisClient.ttl(slotIndexKey)).toBeGreaterThan(7000);
		});

		it(oneLine`
			never shortens the set when a shorter-lived entry is filed in it, which
			would leave the longer-lived one reachable to no purge
		`, async () => {
			await request(getUrl(vendor, longEnv))
				.get(`/items/${NOTE}`)
				.query({ 'filter[slot][_eq]': 'a', fields: 'id' })
				.set('Authorization', adminAuth);

			const filled = await request(getUrl(vendor, shortEnv))
				.get(`/items/${NOTE}`)
				.query({ 'filter[slot][_eq]': 'a', fields: 'label' })
				.set('Authorization', adminAuth);

			expect(filled.headers[cacheStatusHeader]).toBe('MISS');
			expect(await redisClient.ttl(slotIndexKey)).toBeGreaterThan(7000);
		});

		it(oneLine`
			recreates a missing purge counter at the server clock in microseconds,
			never at a value a read may already have taken
		`, async () => {
			const created = await request(getUrl(vendor, shortEnv))
				.post(`/items/${NOTE}`)
				.send({ slot: 'a', label: 'v2' })
				.set('Authorization', adminAuth);

			expect(created.statusCode).toBe(200);
			expect(await redisClient.get(noteEpochKey)).toMatch(/^\d{16}$/);
			expect(await redisClient.ttl(noteEpochKey)).toBeGreaterThan(86_000);
		});
	});
});
