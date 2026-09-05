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
				item: [
					{ slot: 'race', label: 'v1' },
					{ slot: 'calm', label: 'c1' },
				],
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

		function graphqlReadSlot(slot: string) {
			return request(getUrl(vendor, env))
				.post('/graphql')
				.send({
					query: `{ ${COLLECTION}(
						filter: { slot: { _eq: "${slot}" } }
					) { id label } }`,
				})
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			caches an unraced GraphQL read, so the counters it now carries have not made
			every /graphql response uncacheable — and so the miss below means something
		`, async () => {
			await clearCache();

			// A slice the hook is not watching, so this holds whatever the test order
			// is: nothing writes during either read.
			const first = await graphqlReadSlot('calm');
			const second = await graphqlReadSlot('calm');

			expect(first.headers[cacheStatusHeader]).toBe('MISS');
			expect(second.headers[cacheStatusHeader]).toBe('HIT');
			expect(second.body.data[COLLECTION][0].label).toBe('c1');
		});

		it(oneLine`
			refuses to cache the GraphQL read the in-flight write already invalidated,
			so the next read reflects that write
		`, async () => {
			await clearCache();

			// Not asserted on: the read path may emit its filter more than once for
			// one request, so which side of the hook's write this body landed on is
			// not the subject. What must not happen is it being STORED.
			const warm = await graphqlReadSlot('race');
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			const after = await graphqlReadSlot('race');

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data[COLLECTION][0].label).toBe('v2');
		});
	});
});
