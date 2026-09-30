import config, { getUrl, paths, type Env } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const collectionName = 'test_cache_settings';
const cacheStatusHeader = 'x-cache-status';

// `directus_settings.cache_settings` tunes the response cache on every node,
// over what the environment says. Both nodes boot with `CACHE_ENABLED` off, so
// a cache status is the setting's doing, and every assertion is made on the
// node that did NOT write.
describe('Cache settings', () => {
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };
	const envs = {} as Record<Vendor, { writer: Env; peer: Env }>;

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: collectionName,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			await CreateItem(vendor, {
				collection: collectionName,
				item: { name: 'first' },
			});

			const nsPrefix = `directus-cache-settings-${vendor}`;

			const writer = cloneDeep(config.envs);
			writer[vendor]['CACHE_ENABLED'] = 'false';
			writer[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			writer[vendor]['CACHE_STORE'] = 'redis';
			writer[vendor]['REDIS_HOST'] = 'localhost';
			writer[vendor]['REDIS_PORT'] = '6108';
			writer[vendor]['CACHE_NAMESPACE'] = nsPrefix;
			writer[vendor]['BUS_NAMESPACE'] = `${nsPrefix}:bus`;

			const peer = cloneDeep(writer);

			const writerPort = await getPort();
			const peerPort = await getPort();
			writer[vendor].PORT = String(writerPort);
			peer[vendor].PORT = String(peerPort);

			directusInstances[vendor] = [
				spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: writer[vendor] }),
				spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: peer[vendor] }),
			];

			envs[vendor] = { writer, peer };

			promises.push(
				awaitDirectusConnection(writerPort),
				awaitDirectusConnection(peerPort),
			);
		}

		await Promise.all(promises);
	}, 180_000);

	afterAll(async () => {
		for (const vendor of vendors) {
			for (const instance of directusInstances[vendor]!) {
				instance.kill();
			}

			await DeleteCollection(vendor, { collection: collectionName });
		}
	});

	afterEach(async () => {
		// The layer lives in the settings singleton every later suite boots on.
		for (const vendor of vendors) {
			await request(getUrl(vendor, envs[vendor]!.writer))
				.patch('/settings')
				.send({ cache_settings: null })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(200);
		}
	});

	function writeCacheSettings(vendor: Vendor, cacheSettings: object) {
		return request(getUrl(vendor, envs[vendor]!.writer))
			.patch('/settings')
			.send({ cache_settings: cacheSettings })
			.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
			.expect(200);
	}

	async function readCacheStatus(vendor: Vendor): Promise<string | undefined> {
		const response = await request(getUrl(vendor, envs[vendor]!.peer))
			.get(`/items/${collectionName}`)
			.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
			.expect(200);

		return response.headers[cacheStatusHeader];
	}

	// Polled because the announcement is asynchronous: the peer's first status
	// once it serves, or the last one it gave when the window runs out.
	async function awaitServing(
		vendor: Vendor,
		serving: boolean,
	): Promise<string | undefined> {
		let cacheStatus: string | undefined;

		for (let attempt = 0; attempt < 50; attempt++) {
			cacheStatus = await readCacheStatus(vendor);

			if ((cacheStatus !== undefined) === serving) {
				return cacheStatus;
			}

			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		return cacheStatus;
	}

	describe.each(vendors)('%s', (vendor) => {
		it('caches nothing with CACHE_ENABLED off and the layer unset', async () => {
			expect(await readCacheStatus(vendor)).toBe(undefined);
			expect(await readCacheStatus(vendor)).toBe(undefined);
		});

		it('caches on the peer once the writer switches it on', async () => {
			await writeCacheSettings(vendor, { enabled: true });

			expect(await awaitServing(vendor, true)).toBe('MISS');
			expect(await readCacheStatus(vendor)).toBe('HIT');
		});

		it('stops caching on the peer once the writer switches it off', async () => {
			await writeCacheSettings(vendor, { enabled: true });
			expect(await awaitServing(vendor, true)).toBe('MISS');

			await writeCacheSettings(vendor, { enabled: false });

			expect(await awaitServing(vendor, false)).toBe(undefined);
			expect(await readCacheStatus(vendor)).toBe(undefined);
		});

		// While the cache was off, a node that never held one purged nothing, so
		// switching it back on has to start from empty rather than serve what the
		// earlier period filled.
		it('drops what an earlier period filled when switched back on', async () => {
			await writeCacheSettings(vendor, { enabled: true });
			expect(await awaitServing(vendor, true)).toBe('MISS');
			expect(await readCacheStatus(vendor)).toBe('HIT');

			await writeCacheSettings(vendor, { enabled: false });
			expect(await awaitServing(vendor, false)).toBe(undefined);

			await writeCacheSettings(vendor, { enabled: true });

			expect(await awaitServing(vendor, true)).toBe('MISS');
		});

		it('fills nothing past the size cap the writer sets', async () => {
			await writeCacheSettings(vendor, { enabled: true, value_max_size: '1b' });

			expect(await awaitServing(vendor, true)).toBe('MISS');
			expect(await readCacheStatus(vendor)).toBe('MISS');
		});

		it('refuses an enabled the peers would read as unset', async () => {
			await request(getUrl(vendor, envs[vendor]!.writer))
				.patch('/settings')
				.send({ cache_settings: { enabled: 'yes' } })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.expect(400);
		});
	});
});
