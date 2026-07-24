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

// READ-side POISONING limit (#292), asserting the STALE HIT. A read hook enriches
// its response from another collection with NO scopeTo — the framework can't see the
// dependency, so a write to it leaves the enriched read stale. An author-contract
// limit, NOT a framework bug. The test is non-vacuous: it proves the write DID land
// (a direct read of the dependency shows the new value) so the HIT is truly stale.
//   - The sibling "declared but UNAUTOPURGEABLE scopeTo" case is HANDLED (uncached,
//     not poisoned) — it lives in cache-unautopurgeable-scope.test.ts.
// The cache-poisoning-read extension hosts the hook.

const ARTICLE = 'p_read_article';
const AUTHOR = 'p_read_author';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	read hook enrichment with no scopeTo poisons the cache (#292)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-poison-read-${vendor}`;

		let instance: ChildProcess;
		let authorA: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns. Both scoped
			// by space; the read hook enriches an article from author[space=a].
			await CreateCollections(vendor, {
				collections: [
					{
						collection: AUTHOR,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'name', type: 'string' },
						],
					},
					{
						collection: ARTICLE,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'title', type: 'string' },
						],
					},
				],
			});

			const [authors] = await Promise.all([
				CreateItem(vendor, {
					collection: AUTHOR,
					item: [{ space: 'a', name: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: ARTICLE,
					item: [{ space: 'x', title: 't' }],
				}),
			]);

			authorA = authors[0].id;

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
				DeleteCollection(vendor, { collection: ARTICLE }),
				DeleteCollection(vendor, { collection: AUTHOR }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, space: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[space][_eq]': space })
				.set('Authorization', auth);
		}

		it(oneLine`
			a read hook enriches from another collection with NO scopeTo — an author write
			can't purge the enriched article, which stays a stale HIT
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm the enriched article read: author_name is pulled from author[space=a].
			const warm = await readSlice(ARTICLE, 'x');
			expect(warm.body.data[0].author_name).toBe('orig');

			// Change the author the read depends on.
			await request(url)
				.patch(`/items/${AUTHOR}/${authorA}`)
				.send({ name: 'changed' })
				.set('Authorization', auth);

			// The write landed and purged the author's OWN cache (non-vacuity).
			const dep = await readSlice(AUTHOR, 'a');
			expect(dep.body.data[0].name).toBe('changed');

			// But the article read was never tagged for the author → HIT with stale data.
			const stale = await readSlice(ARTICLE, 'x');
			expect(stale.headers[cacheStatusHeader]).toBe('HIT');
			expect(stale.body.data[0].author_name).toBe('orig');
		});
	});
});
