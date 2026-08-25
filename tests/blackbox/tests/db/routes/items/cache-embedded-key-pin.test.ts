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

// A read reaching a collection through M2O hops only is pinned by the keys it
// actually embedded, so a write to one of THOSE rows drops it and a write to any
// other row of the same collection leaves it alone (#361). Before that, every
// touched collection carried a bare tag, and the entry lived exactly as long as the
// fastest-writing collection anywhere in its field graph.
//
// The to-many direction is the complement and stays bare —
// cache-embedded-pin.test.ts guards it.

const OWNER = 'keyed_owner';
const OWNED_ITEM = 'keyed_owned_item';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read pins the collections it embedded by their keys (#361)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-embedded-key-pin-${vendor}`;

		let instance: ChildProcess;
		let embeddedOwnerId: number;
		let untouchedOwnerId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNED_ITEM,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: OWNED_ITEM,
				field: 'owner',
				otherCollection: OWNER,
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'embedded-before' }, { name: 'untouched-before' }],
			});

			embeddedOwnerId = owners[0].id;
			untouchedOwnerId = owners[1].id;

			await CreateItem(vendor, {
				collection: OWNED_ITEM,
				item: [{ label: 'a', owner: embeddedOwnerId }],
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

			await DeleteCollection(vendor, { collection: OWNED_ITEM });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		// Bounded to the one owner, so the response embeds that row and no other. The
		// root itself stays bare — its filter binds no scope field of its own.
		function readItemsOfEmbeddedOwner() {
			return request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owner][_eq]': String(embeddedOwnerId),
					fields: '*,owner.*',
				})
				.set('Authorization', auth);
		}

		it(oneLine`
			pins the embedded owner by its key, leaving the collection unbounded
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const read = await readItemsOfEmbeddedOwner();
			const tags = read.headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${OWNER}:id=${embeddedOwnerId}(,|$)`));

			// The bare tag is what a write to ANY row of the collection drops, so its
			// absence is the whole point — a key pin beside it would buy nothing.
			expect(tags).not.toMatch(new RegExp(`(^|, )${OWNER}(,|$)`));
		});

		it(oneLine`
			survives a write to a row of that collection it never embedded
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warm = await readItemsOfEmbeddedOwner();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data[0].owner.name).toBe('embedded-before');

			await request(url)
				.patch(`/items/${OWNER}/${untouchedOwnerId}`)
				.send({ name: 'untouched-after' })
				.set('Authorization', auth);

			// Non-vacuity: the write landed, so a HIT below is the pin holding rather
			// than a write that never happened.
			const written = await request(url)
				.get(`/items/${OWNER}/${untouchedOwnerId}`)
				.set('Authorization', auth);


			expect(written.body.data.name).toBe('untouched-after');

			const refetched = await readItemsOfEmbeddedOwner();

			expect(refetched.headers[cacheStatusHeader]).toBe('HIT');
		});

		it('is dropped by a write to the row it did embed', async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warm = await readItemsOfEmbeddedOwner();
			expect(warm.body.data[0].owner.name).toBe('embedded-before');

			await request(url)
				.patch(`/items/${OWNER}/${embeddedOwnerId}`)
				.send({ name: 'embedded-after' })
				.set('Authorization', auth);

			const refetched = await readItemsOfEmbeddedOwner();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data[0].owner.name).toBe('embedded-after');
		});
	});
});
