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

// Chain note -> owner -> grandowner -> root: `owner` is a column on the note row
// so it was always keyable (#361); `grandowner` sits two M2O hops out, on no row.
const ROOT = 'anc_root';
const GRANDOWNER = 'anc_grandowner';
const OWNER = 'anc_owner';
const NOTE = 'anc_note';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read pins an ownership ancestor reached through an un-nested join by key (#410)
`, () => {
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-ownership-ancestor-pin-${vendor}`;

		let instance: ChildProcess;
		let ownerId: number;
		let ownedGrandownerId: number;
		let siblingGrandownerId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: GRANDOWNER,
						meta: { scoped_cache_fields: ['root'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNER,
						meta: { scoped_cache_fields: ['grandowner'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: NOTE,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: GRANDOWNER,
				field: 'root',
				otherCollection: ROOT,
			});

			await CreateFieldM2O(vendor, {
				collection: OWNER,
				field: 'grandowner',
				otherCollection: GRANDOWNER,
			});

			await CreateFieldM2O(vendor, {
				collection: NOTE,
				field: 'owner',
				otherCollection: OWNER,
			});

			const roots = await CreateItem(vendor, {
				collection: ROOT,
				item: [{ name: 'root-owned' }, { name: 'root-sibling' }],
			});

			const grandowners = await CreateItem(vendor, {
				collection: GRANDOWNER,
				item: [
					{ name: 'grandowner-owned', root: roots[0].id },
					{ name: 'grandowner-sibling', root: roots[1].id },
				],
			});

			ownedGrandownerId = grandowners[0].id;
			siblingGrandownerId = grandowners[1].id;

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'owner', grandowner: ownedGrandownerId }],
			});

			ownerId = owners[0].id;

			await CreateItem(vendor, {
				collection: NOTE,
				item: [{ body: 'a note', owner: ownerId }],
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

			await DeleteCollection(vendor, { collection: NOTE });
			await DeleteCollection(vendor, { collection: OWNER });
			await DeleteCollection(vendor, { collection: GRANDOWNER });
			await DeleteCollection(vendor, { collection: ROOT });
		});

		// `fields: ['*']` asks for no relational column, so ancestors are un-nested.
		function readNotes() {
			return request(getUrl(vendor, env))
				.get(`/items/${NOTE}`)
				.query({ 'filter[owner][id][_eq]': String(ownerId), fields: '*' })
				.set('Authorization', auth);
		}

		function updateGrandowner(id: number, name: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${GRANDOWNER}/${id}`)
				.send({ name })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('pins the two-hop ancestor by key, never bare', async () => {
			const tags = (await readNotes()).headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${GRANDOWNER}:id=${ownedGrandownerId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${GRANDOWNER}(,|$)`));
		});

		it('still pins the direct-fk ancestor by key', async () => {
			const tags = (await readNotes()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${OWNER}:id=${ownerId}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${OWNER}(,|$)`));
		});

		it(oneLine`
			does not leak the injected ownership nesting into the response
		`, async () => {
			const note = (await readNotes()).body.data[0];

			expect(note.owner).toBe(ownerId);
			expect(note).not.toHaveProperty('grandowner');
			expect(typeof note.owner).not.toBe('object');
		});

		it('a write to a sibling ancestor slice keeps the read cached', async () => {
			await clearCache();

			expect((await readNotes()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readNotes()).headers[cacheStatusHeader]).toBe('HIT');

			await updateGrandowner(siblingGrandownerId, 'grandowner-sibling-touched');

			expect((await readNotes()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a write to the owned ancestor slice evicts the read', async () => {
			await clearCache();

			expect((await readNotes()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readNotes()).headers[cacheStatusHeader]).toBe('HIT');

			await updateGrandowner(ownedGrandownerId, 'grandowner-owned-touched');

			expect((await readNotes()).headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
