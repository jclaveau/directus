import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
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

// Out-of-band counterpart to cache-poisoning-write (#304). An endpoint raw-writes
// two related collections for ONE owner (bypassing ItemsService, no auto purge),
// then purges each via context.scopedCache.purgeForMutatedRows. The mutated owner's
// slices refresh across both collections (no stale HIT, no full flush); a second
// owner's slices survive. The cache-raw-purge extension does the writes and purges.

const DOCUMENT = 'rawpurge_document';
const LINE = 'rawpurge_document_line';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	purgeForMutatedRows after raw writes to two related collections refreshes the
	mutated owner and spares the other (#304)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-rawpurge-${vendor}`;

		let instance: ChildProcess;

		beforeAll(async () => {
			// Two related collections, each scoped by owner: a document and its lines.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: DOCUMENT,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'revision', type: 'integer', meta: {} },
						],
					},
					{
						collection: LINE,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'revision', type: 'integer', meta: {} },
						],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: LINE,
				field: 'document',
				otherCollection: DOCUMENT,
			});

			// owner A is the mutated subject (1 document, 2 lines); owner B is the control
			// witness whose slices must survive the purge (1 document, 1 line).
			const [docsA, docsB] = await Promise.all([
				CreateItem(vendor, {
					collection: DOCUMENT,
					item: [{ owner: 'A', revision: 0 }],
				}),
				CreateItem(vendor, {
					collection: DOCUMENT,
					item: [{ owner: 'B', revision: 0 }],
				}),
			]);

			await Promise.all([
				CreateItem(vendor, {
					collection: LINE,
					item: [
						{ owner: 'A', revision: 0, document: docsA[0].id },
						{ owner: 'A', revision: 0, document: docsA[0].id },
					],
				}),
				CreateItem(vendor, {
					collection: LINE,
					item: [{ owner: 'B', revision: 0, document: docsB[0].id }],
				}),
			]);

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
				DeleteCollection(vendor, { collection: LINE }),
				DeleteCollection(vendor, { collection: DOCUMENT }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[owner][_eq]': owner })
				.set('Authorization', auth);
		}

		it(oneLine`
			refreshes the mutated owner across both collections and leaves the other
			owner's cache intact
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm all four slices (owner A + control owner B, both collections).
			const [warmDocA, warmLineA, warmDocB, warmLineB] = await Promise.all([
				readSlice(DOCUMENT, 'A'),
				readSlice(LINE, 'A'),
				readSlice(DOCUMENT, 'B'),
				readSlice(LINE, 'B'),
			]);

			expect(warmDocA.body.data[0].revision).toBe(0);
			expect(warmLineA.body.data).toHaveLength(2);
			expect(warmLineA.body.data.every((row) => row.revision === 0)).toBe(true);
			expect(warmDocB.body.data[0].revision).toBe(0);
			expect(warmLineB.body.data[0].revision).toBe(0);

			// Raw-write both of owner A's collections then purge each, via the endpoint.
			const mutate = await request(url)
				.post('/cache-raw-purge/')
				.send({ owner: 'A' })
				.set('Authorization', auth);

			expect(mutate.body).toEqual({ documents: 1, lines: 2 });

			// Owner A: fresh MISS reflecting the raw write on BOTH collections — the purge
			// fired without a whole-cache flush, so no stale HIT.
			const [freshDocA, freshLineA] = await Promise.all([
				readSlice(DOCUMENT, 'A'),
				readSlice(LINE, 'A'),
			]);

			expect(freshDocA.headers[cacheStatusHeader]).toBe('MISS');
			expect(freshDocA.body.data[0].revision).toBe(1);
			expect(freshLineA.headers[cacheStatusHeader]).toBe('MISS');
			expect(freshLineA.body.data.every((row) => row.revision === 1)).toBe(true);

			// Owner B (control): still a HIT with the original value on BOTH collections —
			// the purge was surgical, not a namespace-wide flush.
			const [hitDocB, hitLineB] = await Promise.all([
				readSlice(DOCUMENT, 'B'),
				readSlice(LINE, 'B'),
			]);

			expect(hitDocB.headers[cacheStatusHeader]).toBe('HIT');
			expect(hitDocB.body.data[0].revision).toBe(0);
			expect(hitLineB.headers[cacheStatusHeader]).toBe('HIT');
			expect(hitLineB.body.data[0].revision).toBe(0);

			// Non-vacuity: B's HIT isn't masking a changed row — clear + reread stays 0.
			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const clearedDocB = await readSlice(DOCUMENT, 'B');
			expect(clearedDocB.body.data[0].revision).toBe(0);
		});
	});
});
