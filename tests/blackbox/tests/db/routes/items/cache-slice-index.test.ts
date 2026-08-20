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

// A collection-wide purge reads the slice keys a collection owns off an index each
// slice files itself into, rather than scanning the keyspace for them. That index is
// load-bearing: a slice missing from it survives a purge that should have taken
// it, and serves stale until TTL. The unit tests assert the calls, never the state
// those calls leave behind, so they cannot show it stays in step across writes,
// deletes and re-reads.
//
// This drives the states that could desync it, then asserts the invariant by its
// effect: after a collection-wide purge, NO slice of the collection is served.
// That needs no Redis client, and it is the property the index exists for.

const OWNER = 'test_slice_index_owner';
const SLICED = 'test_slice_index_sliced';
const SIBLING = 'test_slice_index_sibling';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-cache-tags';

// Enough owners that a single mis-pruned key is visible as one failure among many,
// rather than the whole set going one way.
const sliceOwners = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

describe('a collection-wide purge takes every slice the collection owns', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-slice-index-${vendor}`;

		let instance: ChildProcess;
		let doomedOwner: number;
		const rowsByOwner: Record<string, number> = {};

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						collection: SLICED,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'label', type: 'string', meta: {} },
							{ field: 'owner', type: 'string', meta: {} },
						],
					},
					{
						collection: SIBLING,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			// The trigger: deleting the parent leaves the slices this collection owns
			// unresolvable, which is what falls back to the collection-wide purge.
			await CreateFieldM2O(vendor, {
				collection: SLICED,
				field: 'parent',
				otherCollection: OWNER,
				relationSchema: { on_delete: 'CASCADE' },
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ label: 'doomed' }],
			});

			doomedOwner = owners[0].id;

			const rows = await CreateItem(vendor, {
				collection: SLICED,
				item: sliceOwners.map((owner) => {
					return { label: `row-${owner}`, owner, parent: doomedOwner };
				}),
			});

			sliceOwners.forEach((owner, index) => {
				rowsByOwner[owner] = rows[index].id;
			});

			await CreateItem(vendor, {
				collection: SIBLING,
				item: [{ label: 'untouched' }],
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
			instance.kill();

			await DeleteCollection(vendor, { collection: SLICED });

			await Promise.all([
				DeleteCollection(vendor, { collection: OWNER }),
				DeleteCollection(vendor, { collection: SIBLING }),
			]);
		});

		function readSlice(owner: string, fields = 'id,label,owner') {
			return request(getUrl(vendor, env))
				.get(`/items/${SLICED}?fields=${fields}&filter[owner][_eq]=${owner}`)
				.set('Authorization', auth);
		}

		function readSibling() {
			return request(getUrl(vendor, env))
				.get(`/items/${SIBLING}`)
				.set('Authorization', auth);
		}

		it(oneLine`
			no slice survives the purge, whatever the writes before it did to the index
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm every slice, plus a second entry on one of them (two reads of the
			// same owner differing only in projection share one tag key) and one slice
			// that matches no row at all — pinned off the filter, not the rows.
			await Promise.all([
				...sliceOwners.map((owner) => readSlice(owner)),
				readSlice('a', 'id,owner'),
				readSlice('nobody'),
				readSibling(),
			]);

			// A write drops that slice from the index; reading it again has to file it
			// back, and must not disturb the ones it did not touch.
			await request(url)
				.patch(`/items/${SLICED}/${rowsByOwner['c']}`)
				.send({ label: 'renamed' })
				.set('Authorization', auth);

			// A delete prunes the index by the same path a purge does.
			await request(url)
				.delete(`/items/${SLICED}/${rowsByOwner['e']}`)
				.set('Authorization', auth);

			await Promise.all([
				readSlice('c'),
				readSlice('e'),
			]);

			const warmed = await Promise.all([
				...sliceOwners.map((owner) => readSlice(owner)),
				readSlice('a', 'id,owner'),
				readSlice('nobody'),
				readSibling(),
			]);

			// Non-vacuity: every one of them has to be warm going in, or "purged" below
			// would just be describing a cache that was never populated.
			for (const response of warmed) {
				expect(response.headers[cacheStatusHeader]).toBe('HIT');
			}

			// And warm under a SLICE tag, not the bare collection tag — the bare tag is
			// purged directly and would pass this test without any index at all.
			sliceOwners.forEach((owner, index) => {
				expect(warmed[index]!.headers[cacheTagsHeader])
				.toBe(`${SLICED}:owner=${owner}`);
			});

			await request(url)
				.delete(`/items/${OWNER}/${doomedOwner}`)
				.set('Authorization', auth);

			const purged = await Promise.all([
				...sliceOwners.map((owner) => readSlice(owner)),
				readSlice('a', 'id,owner'),
				readSlice('nobody'),
			]);

			// The invariant: a slice the index forgot would still be served here.
			for (const response of purged) {
				expect(response.headers[cacheStatusHeader]).toBe('MISS');
			}

			// The control: a collection the delete does not reach keeps its entry, so a
			// whole-namespace flush cannot be what made the assertions above pass.
			const sibling = await readSibling();

			expect(sibling.headers[cacheStatusHeader]).toBe('HIT');
			expect(sibling.body.data).toHaveLength(1);
		});
	});
});
