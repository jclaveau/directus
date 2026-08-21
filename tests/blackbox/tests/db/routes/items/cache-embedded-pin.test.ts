import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateFieldM2O, CreateFieldO2M, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A read that EMBEDS rows of another collection must be purged when that collection is
// written (#380). The root is pinned to its slice and the collections one hop away get a
// bare tag, but a collection reached through a nested relation gets no tag at all — so
// its writes cannot reach the entry and the next read is a stale HIT.
// Sibling cases: cache-poisoning-read covers a hook enriching with NO scopeTo (an author
// contract limit, not this), and #361 covers bare-vs-sliced (a cost, not a staleness).

const OWNER = 'pin_owner';
const OWNED_ITEM = 'pin_owned_item';
const OWNED_SUB_ITEM = 'pin_owned_sub_item';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read does not pin a collection it embeds through a nested relation (#380)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-embedded-pin-${vendor}`;

		let instance: ChildProcess;
		let subItemId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						meta: { scoped_cache_fields: ['space'] },
						fields: [{ field: 'space', type: 'string', meta: {} }],
					},
					{
						collection: OWNED_ITEM,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNED_SUB_ITEM,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			// Each level is reachable from the one above, so a single read can embed the
			// sub-items two relations deep — the shape that loses its tag.
			await CreateFieldM2O(vendor, {
				collection: OWNED_ITEM,
				field: 'owner',
				otherCollection: OWNER,
			});

			await CreateFieldO2M(vendor, {
				collection: OWNER,
				field: 'owned_items',
				otherCollection: OWNED_ITEM,
				otherField: 'owner',
			});

			await CreateFieldM2O(vendor, {
				collection: OWNED_SUB_ITEM,
				field: 'owned_item',
				otherCollection: OWNED_ITEM,
			});

			await CreateFieldO2M(vendor, {
				collection: OWNED_ITEM,
				field: 'owned_sub_items',
				otherCollection: OWNED_SUB_ITEM,
				otherField: 'owned_item',
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ space: 'x' }],
			});

			const ownedItems = await CreateItem(vendor, {
				collection: OWNED_ITEM,
				item: [{ owner: owners[0].id }],
			});

			const subItems = await CreateItem(vendor, {
				collection: OWNED_SUB_ITEM,
				item: [{ label: 'before', owned_item: ownedItems[0].id }],
			});

			subItemId = subItems[0].id;

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

			await DeleteCollection(vendor, { collection: OWNED_SUB_ITEM });
			await DeleteCollection(vendor, { collection: OWNED_ITEM });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		function readOwnerWithSubItems() {
			return request(getUrl(vendor, env))
				.get(`/items/${OWNER}`)
				.query({
					'filter[space][_eq]': 'x',
					fields: '*,owned_items.*,owned_items.owned_sub_items.*',
				})
				.set('Authorization', auth);
		}

		it(oneLine`
			writing an embedded sub-item refreshes the read that carried it
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url).post('/utils/cache/clear').set('Authorization', auth);

			const warm = await readOwnerWithSubItems();
			expect(warm.body.data[0].owned_items[0].owned_sub_items[0].label).toBe('before');

			await request(url)
				.patch(`/items/${OWNED_SUB_ITEM}/${subItemId}`)
				.send({ label: 'after' })
				.set('Authorization', auth);

			// Non-vacuity: the write landed, so a stale body below is the cache and not
			// a write that never happened.
			const written = await request(url)
				.get(`/items/${OWNED_SUB_ITEM}/${subItemId}`)
				.set('Authorization', auth);

			expect(written.body.data.label).toBe('after');

			const refetched = await readOwnerWithSubItems();

			expect(refetched.body.data[0].owned_items[0].owned_sub_items[0].label).toBe('after');
		});

		it(oneLine`
			the read pins every collection it embedded, at least by a bare tag
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url).post('/utils/cache/clear').set('Authorization', auth);

			const read = await readOwnerWithSubItems();
			const tags = read.headers[cacheTagsHeader];

			// The bare tag is what a write to that collection purges, so its absence is
			// exactly why the entry above survives.
			expect(tags).toMatch(new RegExp(`(^|, )${OWNED_ITEM}(:|,|$)`));
			expect(tags).toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(:|,|$)`));
		});
	});
});
