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

// `?export=` leaves the same read path as a normal request but answers with a
// transformed attachment instead of the JSON body. The entry the cache would
// store is that body, so filling one here would let a later plain read be served
// a CSV — or the export be served the JSON. The response is left uncached for
// that reason, and the export branch runs after the fill decision rather than
// instead of it.
//
// The plain read is the control: without it, an instance where caching never
// worked at all would pass every assertion below.

const EXPORTED = 'export_not_cached';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	an export response is transformed and never cached, while the same collection's
	plain read still is
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-export-${vendor}`;

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: EXPORTED,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'label', type: 'string', meta: {} },
						{ field: 'owner', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, {
				collection: EXPORTED,
				item: [{ label: 'only', owner: 'a' }],
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

			await DeleteCollection(vendor, { collection: EXPORTED });
		});

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		function exportAs(format: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${EXPORTED}`)
				.query({ export: format, 'filter[owner][_eq]': 'a' })
				.set('Authorization', auth);
		}

		function readPlain() {
			return request(getUrl(vendor, env))
				.get(`/items/${EXPORTED}`)
				.query({ 'filter[owner][_eq]': 'a' })
				.set('Authorization', auth);
		}

		it(oneLine`
			caches the plain read of the same query, so the refusals below are about the
			export and not about this instance
		`, async () => {
			await clearCache();

			expect((await readPlain()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readPlain()).headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		it.each([
			['csv', /text\/csv/],
			['json', /application\/json/],
			['xml', /text\/xml/],
		])(oneLine`
			answers %s as a named attachment and never serves it from the cache
		`, async (format, contentType) => {
			await clearCache();

			const first = await exportAs(format);

			expect(first.statusCode).toBe(200);
			expect(first.headers['content-type']).toMatch(contentType);

			expect(first.headers['content-disposition'])
				.toMatch(new RegExp(`attachment;.*${EXPORTED}.*\\.${format}`));

			const second = await exportAs(format);

			// A stored export would answer HIT here, and would also be what the plain
			// read above is served next time — the two share everything the cache key
			// is built from except this parameter.
			expect(second.headers[cacheStatusHeader]).not.toBe('HIT');
			expect(second.headers['content-type']).toMatch(contentType);
		}, 60_000);
	});
});
