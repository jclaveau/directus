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

// The REST path refuses to cache a read a write invalidated while it was in flight,
// by comparing the purge counters captured before the query against the ones at fill
// time. GraphQLService aggregates its reads' TAGS into one entry and used to drop
// their counters, so `respond` had nothing to compare and every `/graphql` entry was
// filled with no such check — this asserts the aggregate carries them.

const COLLECTION = 'gql_inflight_purge';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a write committing while a GraphQL read is in flight leaves that read uncacheable,
	the same as the REST path
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-gql-inflight-${vendor}`;

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: COLLECTION,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, {
				collection: COLLECTION,
				item: [{ slot: 'a', label: 'v1' }],
			});

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

			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		function graphqlReadSlotA() {
			return request(getUrl(vendor, env))
				.post('/graphql')
				.send({
					query: `{ ${COLLECTION}(filter: { slot: { _eq: "a" } }) { id label } }`,
				})
				.set('Authorization', auth);
		}

		it(oneLine`
			refuses to cache the GraphQL read the in-flight write already invalidated,
			so the next read reflects that write
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Carries the pre-write rows by construction: the hook runs after the
			// fetch, so this body is allowed to be `v1` — it just must not be stored.
			const warm = await graphqlReadSlotA();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data[COLLECTION][0].label).toBe('v1');

			const after = await graphqlReadSlotA();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data[COLLECTION][0].label).toBe('v2');
		});

		it(oneLine`
			caches a GraphQL read no write raced, so the counters it now carries have
			not made every /graphql response uncacheable
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// The hook fires once per process and already has, so nothing writes
			// during either of these — the ordinary cacheable path.
			const first = await graphqlReadSlotA();
			const second = await graphqlReadSlotA();

			expect(first.headers[cacheStatusHeader]).toBe('MISS');
			expect(second.headers[cacheStatusHeader]).toBe('HIT');
			expect(second.body.data[COLLECTION][0].label).toBe('v2');
		});
	});
});
