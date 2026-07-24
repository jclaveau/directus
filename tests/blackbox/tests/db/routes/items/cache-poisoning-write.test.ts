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

// WRITE-side POISONING limits (#292), asserting the STALE HIT. A mutation hook's
// side-effect write to another collection self-purges it ONLY through ItemsService
// with its purge on (cache-nested-write.test.ts). Two ways to defeat that, each
// needing a `purgeBy` the hook omits:
//   - P2: raw knex write (bypasses the purge pipeline).
//   - P3: ItemsService write with autoPurgeCache:false (suppresses the purge).
// Both are author-contract limits, NOT framework bugs. Each test proves the write
// DID land (clearing the cache then re-reading shows the new value) so the HIT is
// stale. The cache-poisoning-write extension hosts the two hooks.

const P2_SOURCE = 'p_raw_source';
const P2_TARGET = 'p_raw_target';
const P3_SOURCE = 'p_nopurge_source';
const P3_TARGET = 'p_nopurge_target';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a hook's write to another collection that bypasses or suppresses the purge poisons
	that collection's cache (#292)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-poison-write-${vendor}`;

		let instance: ChildProcess;
		let rawSource: number;
		let nopurgeSource: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns. Each target
			// is scoped by space; the hook writes target[space=x] as a side effect.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: P2_SOURCE,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'note', type: 'string' },
						],
					},
					{
						collection: P2_TARGET,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'tally', type: 'integer' },
						],
					},
					{
						collection: P3_SOURCE,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'note', type: 'string' },
						],
					},
					{
						collection: P3_TARGET,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'tally', type: 'integer' },
						],
					},
				],
			});

			const [rawSources, , nopurgeSources] = await Promise.all([
				CreateItem(vendor, {
					collection: P2_SOURCE,
					item: [{ space: 's', note: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: P2_TARGET,
					item: [{ space: 'x', tally: 0 }],
				}),
				CreateItem(vendor, {
					collection: P3_SOURCE,
					item: [{ space: 's', note: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: P3_TARGET,
					item: [{ space: 'x', tally: 0 }],
				}),
			]);

			rawSource = rawSources[0].id;
			nopurgeSource = nopurgeSources[0].id;

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
				DeleteCollection(vendor, { collection: P2_SOURCE }),
				DeleteCollection(vendor, { collection: P2_TARGET }),
				DeleteCollection(vendor, { collection: P3_SOURCE }),
				DeleteCollection(vendor, { collection: P3_TARGET }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, space: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[space][_eq]': space })
				.set('Authorization', auth);
		}

		async function assertPoisonedThenLanded(
			source: number,
			sourceCollection: string,
			target: string,
		) {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm the target slice the hook will write.
			const warm = await readSlice(target, 'x');
			expect(warm.body.data[0].tally).toBe(0);

			// Update the source: the hook writes target[x] without purging it.
			await request(url)
				.patch(`/items/${sourceCollection}/${source}`)
				.send({ note: 'touched' })
				.set('Authorization', auth);

			// The target read is a stale HIT — the write happened but no purge ran.
			const stale = await readSlice(target, 'x');
			expect(stale.headers[cacheStatusHeader]).toBe('HIT');
			expect(stale.body.data[0].tally).toBe(0);

			// Non-vacuity: clear the cache and the write is visible (tally 1) — so the HIT
			// above was genuinely stale, not a no-op write.
			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const fresh = await readSlice(target, 'x');
			expect(fresh.headers[cacheStatusHeader]).toBe('MISS');
			expect(fresh.body.data[0].tally).toBe(1);
		}

		it(oneLine`
			P2: a hook's raw knex write to another collection bypasses the purge — the
			target read stays a stale HIT
		`, async () => {
			await assertPoisonedThenLanded(rawSource, P2_SOURCE, P2_TARGET);
		});

		it(oneLine`
			P3: a hook's ItemsService write with autoPurgeCache:false suppresses the purge
			— the target read stays a stale HIT
		`, async () => {
			await assertPoisonedThenLanded(nopurgeSource, P3_SOURCE, P3_TARGET);
		});
	});
});
