import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2M,
	CreateFieldM2O,
	CreateFieldO2M,
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

// A collection a read reaches ONLY through its filter is nested nowhere, so the
// parent-key pin of #361 says nothing about it and it used to fall through to a
// bare tag — one write anywhere in it dropping every read that merely joined it.
// When the filter names its rows by primary key, those rows ARE the dependency
// (#401), whichever direction the relation runs.

const OWNER = 'keyed_filter_owner';
const OWNED_ITEM = 'keyed_filter_owned_item';
const OWNED_SUB_ITEM = 'keyed_filter_owned_sub_item';
const CATEGORY = 'keyed_filter_category';
const JUNCTION = `${OWNED_ITEM}_${CATEGORY}_junction`;
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read pins the collections its filter names by key (#401)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-keyed-filter-pin-${vendor}`;

		let instance: ChildProcess;
		let filteredOwnerId: number;
		let untouchedOwnerId: number;
		let ownedItemId: number;
		let filteredSubItemId: number;
		let junctionRowId: number;
		let untouchedSubItemId: number;
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
					{
						collection: OWNED_SUB_ITEM,
						fields: [{ field: 'note', type: 'string', meta: {} }],
					},
					{
						collection: CATEGORY,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: OWNED_ITEM,
				field: 'owner',
				otherCollection: OWNER,
			});

			await CreateFieldO2M(vendor, {
				collection: OWNED_ITEM,
				field: 'owned_sub_items',
				otherCollection: OWNED_SUB_ITEM,
				otherField: 'owned_item',
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'filtered-before' }, { name: 'untouched-before' }],
			});

			filteredOwnerId = owners[0].id;
			untouchedOwnerId = owners[1].id;

			const items = await CreateItem(vendor, {
				collection: OWNED_ITEM,
				item: [{ label: 'a', owner: filteredOwnerId }],
			});

			ownedItemId = items[0].id;

			const subItems = await CreateItem(vendor, {
				collection: OWNED_SUB_ITEM,
				item: [
					{ note: 'filtered-before', owned_item: items[0].id },
					{ note: 'untouched-before', owned_item: items[0].id },
				],
			});

			filteredSubItemId = subItems[0].id;
			untouchedSubItemId = subItems[1].id;

			await CreateFieldM2M(vendor, {
				collection: OWNED_ITEM,
				field: 'categories',
				otherCollection: CATEGORY,
				otherField: 'owned_items',
				junctionCollection: JUNCTION,
			});

			const categories = await CreateItem(vendor, {
				collection: CATEGORY,
				item: [{ name: 'c1' }],
			});

			const junctionRows = await CreateItem(vendor, {
				collection: JUNCTION,
				item: [{
					[`${OWNED_ITEM}_id`]: ownedItemId,
					[`${CATEGORY}_id`]: categories[0].id,
				}],
			});

			junctionRowId = junctionRows[0].id;

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

			await DeleteCollection(vendor, { collection: JUNCTION });
			await DeleteCollection(vendor, { collection: CATEGORY });
			await DeleteCollection(vendor, { collection: OWNED_SUB_ITEM });
			await DeleteCollection(vendor, { collection: OWNED_ITEM });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		// `fields` asks for no owner column, so the owner is reached through the
		// filter and nowhere else — the shape that used to tag it bare.
		function readItemsOfFilteredOwner() {
			return request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owner][id][_eq]': String(filteredOwnerId),
					fields: '*',
				})
				.set('Authorization', auth);
		}

		// The fields are listed rather than wildcarded: `*` splices in every field
		// of the collection, the O2M alias included (`convertWildcards`), which
		// would nest the sub-items instead of only filtering through them.
		function readItemsWithFilteredSubItem() {
			return request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owned_sub_items][id][_eq]': String(filteredSubItemId),
					fields: 'id,label,owner',
				})
				.set('Authorization', auth);
		}

		async function clearCache() {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('pins the M2O it filtered on by key, and drops its bare tag', async () => {
			await clearCache();

			const tags = (await readItemsOfFilteredOwner()).headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${OWNER}:id=${filteredOwnerId}(,|$)`),
			);

			// The bare tag is what a write to ANY row of the collection drops, so
			// its absence is the whole point of the change.
			expect(tags).not.toMatch(new RegExp(`(^|, )${OWNER}(,|$)`));
		});

		it(oneLine`
			carries a slice once when it both nested the row and named its key
		`, async () => {
			// The nested-row pin of #361 and this one name the same slice; the tag
			// index dedups on the key, the header and its count do not.
			await clearCache();

			const read = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owner][id][_eq]': String(filteredOwnerId),
					fields: '*,owner.*',
				})
				.set('Authorization', auth);

			const tags = read.headers[cacheTagsHeader].split(', ');

			expect(tags.filter((tag: string) => {
				return tag === `${OWNER}:id=${filteredOwnerId}`;
			})).toHaveLength(1);
		});

		it('pins a to-many relation it filtered on by key too', async () => {
			await clearCache();

			const tags =
				(await readItemsWithFilteredSubItem()).headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=${filteredSubItemId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));
		});

		it(oneLine`
			pins a to-many written on the alias, the spelling REST preserves
		`, async () => {
			// `parseFilter` normalizes a bare leaf to `_eq` but does NOT expand
			// `{rel: {_eq: X}}` into `{rel: {id: {_eq: X}}}`, so this shorthand
			// arrives at the service as written. `getColumnPath` appends the
			// related key and compiles it to the same join as the longhand.
			await clearCache();

			const read = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owned_sub_items][_eq]': String(filteredSubItemId),
						fields: 'id,label,owner',
					})
					.set('Authorization', auth);
			};

			const warm = await read();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			expect(warm.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=${filteredSubItemId}(,|$)`),
			);

			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNED_SUB_ITEM}/${untouchedSubItemId}`)
				.send({ note: 'shorthand-untouched' })
				.set('Authorization', auth);

			expect((await read()).headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNED_SUB_ITEM}/${filteredSubItemId}`)
				.send({ note: 'shorthand-named' })
				.set('Authorization', auth);

			expect((await read()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			tags no owner at all for an M2O shorthand, which joins nothing
		`, async () => {
			// The mirror of the to-many shorthand: `owned_item.owner` is a column
			// of the row itself, so the read never looks at the owner table and
			// a write there cannot change what it returns.
			await clearCache();

			const read = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owner][_eq]': String(filteredOwnerId),
						fields: 'id,label,owner',
					})
					.set('Authorization', auth);
			};

			const warm = await read();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNER}(:|,|$)`));

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNER}/${filteredOwnerId}`)
				.send({ name: 'm2o-shorthand-write' })
				.set('Authorization', auth);

			// Non-vacuity: the write landed, and the entry still stands.
			const written = await request(getUrl(vendor, env))
				.get(`/items/${OWNER}/${filteredOwnerId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('m2o-shorthand-write');
			expect((await read()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it(oneLine`
			pins the junction an M2M shorthand names, as getColumnPath resolves it
		`, async () => {
			await clearCache();

			const read = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[categories][_eq]': String(junctionRowId),
						fields: 'id,label',
					})
					.set('Authorization', auth);
			};

			const warm = await read();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			expect(warm.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${JUNCTION}:id=${junctionRowId}(,|$)`),
			);

			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${JUNCTION}(,|$)`));
		});

		it('leaves a filter on a non-key column bare', async () => {
			// The control: renaming any owner moves an item into this result, so
			// no key names what the read depends on.
			await clearCache();

			const read = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owner][name][_eq]': 'filtered-before',
					fields: '*',
				})
				.set('Authorization', auth);

			expect(read.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNER}(,|$)`));
		});

		it(oneLine`
			survives a write to a row of the filtered collection it never named
		`, async () => {
			await clearCache();

			const warm = await readItemsOfFilteredOwner();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNER}/${untouchedOwnerId}`)
				.send({ name: 'untouched-after' })
				.set('Authorization', auth);

			// Non-vacuity: the write landed, so the HIT below is the pin holding
			// rather than a write that never happened.
			const written = await request(getUrl(vendor, env))
				.get(`/items/${OWNER}/${untouchedOwnerId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('untouched-after');

			const refetched = await readItemsOfFilteredOwner();

			expect(refetched.headers[cacheStatusHeader]).toBe('HIT');
		});

		it('is dropped by a write to the row its filter did name', async () => {
			await clearCache();

			const warm = await readItemsOfFilteredOwner();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNER}/${filteredOwnerId}`)
				.send({ name: 'filtered-after' })
				.set('Authorization', auth);

			const refetched = await readItemsOfFilteredOwner();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
		});

		it('survives a write to a to-many row its filter never named', async () => {
			await clearCache();

			const warm = await readItemsWithFilteredSubItem();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNED_SUB_ITEM}/${untouchedSubItemId}`)
				.send({ note: 'untouched-after' })
				.set('Authorization', auth);

			const written = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_SUB_ITEM}/${untouchedSubItemId}`)
				.set('Authorization', auth);

			expect(written.body.data.note).toBe('untouched-after');

			const refetched = await readItemsWithFilteredSubItem();

			expect(refetched.headers[cacheStatusHeader]).toBe('HIT');
		});

		it('is dropped by a write to the to-many row its filter named', async () => {
			await clearCache();

			const warm = await readItemsWithFilteredSubItem();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNED_SUB_ITEM}/${filteredSubItemId}`)
				.send({ note: 'filtered-after' })
				.set('Authorization', auth);

			const refetched = await readItemsWithFilteredSubItem();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			keeps a nested to-many bare even when the filter named a key in it
		`, async () => {
			// The filter names sub-item X, but `owned_sub_items.*` nests EVERY
			// sub-item of the matched rows — so an insert nobody named changes
			// the response. The key covers the filter's half of the dependency
			// and says nothing about the nested half, which no parent-key pin
			// can cover across a to-many hop.
			await clearCache();

			const read = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owned_sub_items][id][_eq]': String(filteredSubItemId),
						fields: '*,owned_sub_items.*',
					})
					.set('Authorization', auth);
			};

			const warm = await read();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data[0].owned_sub_items).toHaveLength(2);

			expect(warm.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));

			await request(getUrl(vendor, env))
				.post(`/items/${OWNED_SUB_ITEM}`)
				.send({ note: 'inserted', owned_item: ownedItemId })
				.set('Authorization', auth);

			const refetched = await read();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data[0].owned_sub_items).toHaveLength(3);
		});
	});
});
