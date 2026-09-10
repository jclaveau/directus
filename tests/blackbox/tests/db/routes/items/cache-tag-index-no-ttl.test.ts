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

// With a TTL set, a tag set and its slice-index entry are written through the
// expiry script, which is what every other cache spec exercises. With `CACHE_TTL`
// unset the entries never expire either, so both are written as a plain `SADD`
// and left unbounded to match — a different pair of Redis calls, on the path that
// makes a purge able to find an entry at all.
//
// Asserted by effect rather than by reading TTLs back: a tag set that was never
// written, or written under a key nothing reads, shows up as an entry no write
// can drop, which is the whole failure this indexing exists to prevent. Both
// purge shapes are driven, because they take that pair of calls separately — the
// slice purge through the tag set, the collection-wide one through the index.

const OWNER = 'no_ttl_owner';
const SLICED = 'no_ttl_sliced';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	an entry cached with no TTL is still indexed by its tags, so both a slice purge
	and a collection-wide one still reach it
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-no-ttl-${vendor}`;

		// The subject. Empty reads as unset (the default is `5m`), which is what
		// leaves the tag sets unbounded.
		env[vendor]['CACHE_TTL'] = '';

		let instance: ChildProcess;
		let doomedOwner: number;
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
				],
			});

			// Deleting the parent leaves the child slices unresolvable, which is what
			// falls back to the collection-wide purge.
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

			await CreateItem(vendor, {
				collection: SLICED,
				item: [
					{ label: 'a1', owner: 'a', parent: doomedOwner },
					{ label: 'b1', owner: 'b', parent: doomedOwner },
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

			await DeleteCollection(vendor, { collection: SLICED });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		function readSlice(owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${SLICED}`)
				.query({ 'filter[owner][_eq]': owner })
				.set('Authorization', auth);
		}

		async function fill(owner: string) {
			expect((await readSlice(owner)).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readSlice(owner)).headers[cacheStatusHeader]).toBe('HIT');
		}

		it(oneLine`
			drops only the written slice, so the tag set the entry was filed under was
			really written and really keyed
		`, async () => {
			await clearCache();

			await fill('a');
			await fill('b');

			await request(getUrl(vendor, env))
				.post(`/items/${SLICED}`)
				.send({ label: 'a2', owner: 'a', parent: doomedOwner })
				.set('Authorization', auth);

			expect((await readSlice('a')).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readSlice('b')).headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		it(oneLine`
			drops every slice of the collection on a collection-wide purge, so the
			slice index the purge reads was written too
		`, async () => {
			await clearCache();

			await fill('a');
			await fill('b');

			// Cascades into the children, whose own slices the delete cannot name —
			// the fallback that reads the index instead of a tag set.
			await request(getUrl(vendor, env))
				.delete(`/items/${OWNER}/${doomedOwner}`)
				.set('Authorization', auth);

			expect((await readSlice('a')).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readSlice('b')).headers[cacheStatusHeader]).toBe('MISS');
		}, 60_000);
	});
});
