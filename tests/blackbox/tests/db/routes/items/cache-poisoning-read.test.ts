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

// READ-side POISONING limits (#292), asserting the STALE HIT. A read hook enriches
// its response from another collection; the framework can't see that dependency.
// Without a reproducible `scopeTo`, a write to the dependency leaves the read stale.
//   - P1: no scopeTo at all.
//   - P4: scopeTo declared, but on a field the dependency isn't scoped on, so the
//     purge side never emits that tag (orphaned) — declaring is not enough.
// Both are author-contract limits, NOT framework bugs; each test proves the write
// DID land (a direct read of the dependency shows the new value) so the HIT is truly
// stale. The cache-poisoning-read extension hosts the two hooks.

const P1_ARTICLE = 'p_read_article';
const P1_AUTHOR = 'p_read_author';
const P4_READ = 'p_read_badread';
const P4_DEP = 'p_read_baddep';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	read hook enrichment poisons the cache without a reproducible scopeTo (#292)
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
		let depD: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns. Each read
			// collection is scoped by space; its dependency holds the enriched value.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: P1_AUTHOR,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'name', type: 'string' },
						],
					},
					{
						collection: P1_ARTICLE,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'title', type: 'string' },
						],
					},
					{
						collection: P4_DEP,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'val', type: 'string' },
						],
					},
					{
						collection: P4_READ,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'title', type: 'string' },
						],
					},
				],
			});

			const [authors, , deps] = await Promise.all([
				CreateItem(vendor, {
					collection: P1_AUTHOR,
					item: [{ space: 'a', name: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: P1_ARTICLE,
					item: [{ space: 'x', title: 't' }],
				}),
				CreateItem(vendor, {
					collection: P4_DEP,
					item: [{ space: 'd', val: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: P4_READ,
					item: [{ space: 'z', title: 't' }],
				}),
			]);

			authorA = authors[0].id;
			depD = deps[0].id;

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
				DeleteCollection(vendor, { collection: P1_ARTICLE }),
				DeleteCollection(vendor, { collection: P1_AUTHOR }),
				DeleteCollection(vendor, { collection: P4_READ }),
				DeleteCollection(vendor, { collection: P4_DEP }),
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
			P1: a read hook enriches from another collection with NO scopeTo — an author
			write can't purge the enriched article, which stays a stale HIT
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm the enriched article read: author_name is pulled from author[space=a].
			const warm = await readSlice(P1_ARTICLE, 'x');
			expect(warm.body.data[0].author_name).toBe('orig');

			// Change the author the read depends on.
			await request(url)
				.patch(`/items/${P1_AUTHOR}/${authorA}`)
				.send({ name: 'changed' })
				.set('Authorization', auth);

			// The write landed and purged the author's OWN cache (non-vacuity).
			const dep = await readSlice(P1_AUTHOR, 'a');
			expect(dep.body.data[0].name).toBe('changed');

			// But the article read was never tagged for the author → HIT with stale data.
			const stale = await readSlice(P1_ARTICLE, 'x');
			expect(stale.headers[cacheStatusHeader]).toBe('HIT');
			expect(stale.body.data[0].author_name).toBe('orig');
		});

		it(oneLine`
			P4: a read hook declares scopeTo on a field the dependency isn't scoped on —
			the tag is orphaned, a dep write can't purge it, the read stays a stale HIT
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warm = await readSlice(P4_READ, 'z');
			expect(warm.body.data[0].dep_val).toBe('orig');

			await request(url)
				.patch(`/items/${P4_DEP}/${depD}`)
				.send({ val: 'changed' })
				.set('Authorization', auth);

			// The dep write landed and purged the dep's own space slice (non-vacuity).
			const dep = await readSlice(P4_DEP, 'd');
			expect(dep.body.data[0].val).toBe('changed');

			// The scopeTo tag (ghost=g) is never emitted by a dep write → stale HIT.
			const stale = await readSlice(P4_READ, 'z');
			expect(stale.headers[cacheStatusHeader]).toBe('HIT');
			expect(stale.body.data[0].dep_val).toBe('orig');
		});
	});
});
