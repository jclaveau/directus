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

// The UNAUTOPURGEABLE-scope safety net (#292). A read hook that scopes TO a value
// slice on a field the target collection isn't scoped on declares a tag no write can
// auto-purge — so caching the response would poison it. The framework instead leaves
// the response UNCACHED (surfacing an `unautopurgeable_scope` anomaly), UNLESS the
// hook marks it `manuallyPurged`, promising to reproduce the tag via its purgeBy.
//   - CANCEL: unautopurgeable scopeTo, no flag → the read is never cached (two
//     reads, no write between, both MISS).
//   - MANUAL: same tag with manuallyPurged → cached (second read HIT); and a
//     matching purgeBy on the dep's update invalidates it (post-write MISS).
// The cache-unautopurgeable-scope extension hosts the hooks.

const CANCEL_READ = 'p_unauto_read';
const CANCEL_DEP = 'p_unauto_dep';
const MANUAL_READ = 'p_manual_read';
const MANUAL_DEP = 'p_manual_dep';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	an unautopurgeable scopeTo cancels caching unless the hook declares manuallyPurged
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-unauto-${vendor}`;

		let instance: ChildProcess;
		let manualDep: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns. All scoped
			// by space; the read hooks scopeTo a `ghost` slice of a dep — a field neither
			// dep is scoped on, so the tag is unautopurgeable.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: CANCEL_DEP,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'val', type: 'string' },
						],
					},
					{
						collection: CANCEL_READ,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'title', type: 'string' },
						],
					},
					{
						collection: MANUAL_DEP,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'val', type: 'string' },
						],
					},
					{
						collection: MANUAL_READ,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'title', type: 'string' },
						],
					},
				],
			});

			const [, , manualDeps] = await Promise.all([
				CreateItem(vendor, {
					collection: CANCEL_DEP,
					item: [{ space: 'd', val: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: CANCEL_READ,
					item: [{ space: 'z', title: 't' }],
				}),
				CreateItem(vendor, {
					collection: MANUAL_DEP,
					item: [{ space: 'd', val: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: MANUAL_READ,
					item: [{ space: 'z', title: 't' }],
				}),
			]);

			manualDep = manualDeps[0].id;

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
				DeleteCollection(vendor, { collection: CANCEL_READ }),
				DeleteCollection(vendor, { collection: CANCEL_DEP }),
				DeleteCollection(vendor, { collection: MANUAL_READ }),
				DeleteCollection(vendor, { collection: MANUAL_DEP }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, space: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[space][_eq]': space })
				.set('Authorization', auth);
		}

		function graphqlRead(collection: string, space: string) {
			return request(getUrl(vendor, env))
				.post('/graphql')
				.send({
					query: `{ ${collection}(filter: { space: { _eq: "${space}" } }) { id } }`,
				})
				.set('Authorization', auth);
		}

		it(oneLine`
			an unautopurgeable scopeTo with no manuallyPurged leaves the read uncached —
			two reads with no write between both MISS
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const first = await readSlice(CANCEL_READ, 'z');
			const second = await readSlice(CANCEL_READ, 'z');

			// Never stored → the second identical read is still a MISS (a normal cacheable
			// read would be a HIT here), so no stale entry can ever be served.
			expect(first.headers[cacheStatusHeader]).toBe('MISS');
			expect(second.headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			the cancel covers the GraphQL path too — a graphql read of the same collection
			carries the flag through GraphQLService and stays uncached
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const first = await graphqlRead(CANCEL_READ, 'z');
			const second = await graphqlRead(CANCEL_READ, 'z');

			// GraphQLService must aggregate the unautopurgeable flag across its reads,
			// else the /graphql entry would cache (HIT on the second) and serve stale.
			expect(first.headers[cacheStatusHeader]).toBe('MISS');
			expect(second.headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			manuallyPurged caches the read, and the dep's matching purgeBy invalidates it —
			the valid custom-tag round-trip
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const first = await readSlice(MANUAL_READ, 'z');
			const cached = await readSlice(MANUAL_READ, 'z');

			// manuallyPurged opts out of the cancel → the read IS cached (second a HIT).
			expect(first.headers[cacheStatusHeader]).toBe('MISS');
			expect(cached.headers[cacheStatusHeader]).toBe('HIT');

			// Update the dependency: its update hook purgeBy's the same custom slice.
			await request(url)
				.patch(`/items/${MANUAL_DEP}/${manualDep}`)
				.send({ val: 'changed' })
				.set('Authorization', auth);

			// The author's own purgeBy reproduced the tag → the read is invalidated.
			const purged = await readSlice(MANUAL_READ, 'z');
			expect(purged.headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
