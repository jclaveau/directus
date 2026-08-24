import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `CACHE_SCOPED_TAG_INDEX` chooses how a numeric scope slice is filed:
//
//   key-per-value  one Redis key per value, read with SMEMBERS (the default)
//   sorted-set     one key per (collection, field), value = score, read with
//                  ZRANGEBYSCORE — the whole numeric axis in one key
//
// Nothing about which entries a write drops is supposed to change, so every case
// runs under both settings. A slice the sorted-set path failed to file shows as a
// stale HIT after a write; one filed under the wrong score shows as a MISS on the
// untouched sibling; a key read with the wrong Redis type 500s.
//
// One spawned instance covers both: the setting is flipped on it through
// env-inject rather than baked in at spawn, because `scoped-cache.ts` reads it per
// call off the object `useEnv()` returned — the same object env-inject mutates.
// The shared instance cannot host this, running with `CACHE_ENABLED: 'false'`.

const NUMERIC = 'test_tag_index_numeric';
const TEXTUAL = 'test_tag_index_textual';
const cacheStatusHeader = 'x-cache-status';

const INDEX_MODES = ['key-per-value', 'sorted-set'] as const;

describe('scoped cache tag index', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-tag-index-${vendor}`;

		let instance: ChildProcess;
		let url: string;

		beforeAll(async () => {
			// Seeded on the default instance before the scoped one spawns, so it reads
			// both collections and their `scoped_cache_fields` at boot.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: NUMERIC,
						meta: { scoped_cache_fields: ['owner_id'] },
						fields: [
							{ field: 'owner_id', type: 'integer', meta: {} },
							{ field: 'amount', type: 'string', meta: {} },
						],
					},
					{
						// A string axis has no score to sit at, so it stays one key per
						// value whatever the setting says — the fallback has to hold.
						collection: TEXTUAL,
						meta: { scoped_cache_fields: ['tenant'] },
						fields: [
							{ field: 'tenant', type: 'string', meta: {} },
							{ field: 'amount', type: 'string', meta: {} },
						],
					},
				],
			});

			await Promise.all([
				CreateItem(vendor, {
					collection: NUMERIC,
					item: [
						{ owner_id: 7, amount: '5' },
						{ owner_id: 8, amount: '7' },
					],
				}),
				CreateItem(vendor, {
					collection: TEXTUAL,
					item: [
						{ tenant: 'acme', amount: '5' },
						{ tenant: 'globex', amount: '7' },
					],
				}),
			]);

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
			url = getUrl(vendor, env);
		}, 60_000);

		afterAll(async () => {
			instance.kill();

			await Promise.all([
				DeleteCollection(vendor, { collection: NUMERIC }),
				DeleteCollection(vendor, { collection: TEXTUAL }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, field: string, value: string) {
			return request(url)
				.get(`/items/${collection}`)
				.query({ [`filter[${field}][_eq]`]: value })
				.set('Authorization', auth);
		}

		async function warm(collection: string, field: string, values: string[]) {
			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all(values.map((value) => {
				return readSlice(collection, field, value);
			}));
		}

		describe.each(INDEX_MODES)('CACHE_SCOPED_TAG_INDEX=%s', (indexMode) => {
			beforeAll(async () => {
				// `setDirectusEnv` targets the shared instance; this one is ours, so the
				// env-inject route is called on it directly.
				const injected = await request(url)
					.post('/env-inject/set')
					.send({ key: 'CACHE_SCOPED_TAG_INDEX', value: indexMode })
					.set('Authorization', auth);

				expect(injected.statusCode).toBe(200);
				expect(injected.body.data.value).toBe(indexMode);
			});

			it('drops only the written numeric slice', async () => {
				await warm(NUMERIC, 'owner_id', ['7', '8']);

				const [row] = (await readSlice(NUMERIC, 'owner_id', '7')).body.data;

				await request(url)
					.patch(`/items/${NUMERIC}/${row.id}`)
					.send({ amount: '55' })
					.set('Authorization', auth);

				const [written, sibling] = await Promise.all([
					readSlice(NUMERIC, 'owner_id', '7'),
					readSlice(NUMERIC, 'owner_id', '8'),
				]);

				// Stale here would mean the write never found what the read filed.
				expect(written.headers[cacheStatusHeader]).toBe('MISS');

				// A MISS here would mean it found too much — every value of the field
				// sharing one key is exactly the risk the sorted set introduces.
				expect(sibling.headers[cacheStatusHeader]).toBe('HIT');

				expect(written.body.data[0].amount).toBe('55');
			});

			it('drops only the written textual slice, never scored', async () => {
				await warm(TEXTUAL, 'tenant', ['acme', 'globex']);

				const [row] = (await readSlice(TEXTUAL, 'tenant', 'acme')).body.data;

				await request(url)
					.patch(`/items/${TEXTUAL}/${row.id}`)
					.send({ amount: '55' })
					.set('Authorization', auth);

				const [written, sibling] = await Promise.all([
					readSlice(TEXTUAL, 'tenant', 'acme'),
					readSlice(TEXTUAL, 'tenant', 'globex'),
				]);

				expect(written.headers[cacheStatusHeader]).toBe('MISS');
				expect(sibling.headers[cacheStatusHeader]).toBe('HIT');
			});

			it('leaves warm slices alone when a write lands on a new value', async () => {
				await warm(NUMERIC, 'owner_id', ['7', '8']);

				// The inserted row resolves its own slice — `owner_id=9` — which no
				// cached read pinned, so there is nothing of it to drop. Under the
				// sorted set that value is a score nobody queries; the risk covered
				// here is that touching the shared key disturbs its neighbours.
				await request(url)
					.post(`/items/${NUMERIC}`)
					.send({ owner_id: 9, amount: '1' })
					.set('Authorization', auth);

				const [seven, eight] = await Promise.all([
					readSlice(NUMERIC, 'owner_id', '7'),
					readSlice(NUMERIC, 'owner_id', '8'),
				]);

				expect(seven.headers[cacheStatusHeader]).toBe('HIT');
				expect(eight.headers[cacheStatusHeader]).toBe('HIT');
			});

			it('drops every slice when the purge goes collection-wide', async () => {
				await warm(NUMERIC, 'owner_id', ['7', '8']);

				// A caller handing over rows it cannot resolve takes the fallback no
				// HTTP write reaches — every slice the collection owns goes. For the
				// sorted set that is the one key holding every score, dropped whole
				// rather than at a single score.
				const purged = await request(url)
					.post('/tag-index-probe/coarse-purge')
					.send({ collection: NUMERIC })
					.set('Authorization', auth);

				expect(purged.statusCode).toBe(200);

				const [seven, eight] = await Promise.all([
					readSlice(NUMERIC, 'owner_id', '7'),
					readSlice(NUMERIC, 'owner_id', '8'),
				]);

				expect(seven.headers[cacheStatusHeader]).toBe('MISS');
				expect(eight.headers[cacheStatusHeader]).toBe('MISS');
			});

			it('drops an unfiltered read, which pins nothing, on any write', async () => {
				await request(url)
					.post('/utils/cache/clear')
					.set('Authorization', auth);

				// No scope filter, so this carries the bare collection tag rather than
				// a slice — the fallback every non-pinned read lands on.
				const unfiltered = () => {
					return request(url)
						.get(`/items/${NUMERIC}`)
						.set('Authorization', auth);
				};

				await Promise.all([unfiltered(), readSlice(NUMERIC, 'owner_id', '8')]);

				const [row] = (await readSlice(NUMERIC, 'owner_id', '7')).body.data;

				await request(url)
					.patch(`/items/${NUMERIC}/${row.id}`)
					.send({ amount: '77' })
					.set('Authorization', auth);

				const [bare, sibling] = await Promise.all([
					unfiltered(),
					readSlice(NUMERIC, 'owner_id', '8'),
				]);

				expect(bare.headers[cacheStatusHeader]).toBe('MISS');
				expect(sibling.headers[cacheStatusHeader]).toBe('HIT');
			});
		});
	});
});
