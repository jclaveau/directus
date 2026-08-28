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

		it('tags the M2O it filtered on not at all, bare or keyed', async () => {
			// The widest outcome available: the filter is answered by this row's
			// own foreign key column, so no write to the owner collection can
			// change what comes back and no tag of any shape is needed.
			await clearCache();

			expect((await readItemsOfFilteredOwner()).headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNER}(:|,|$)`));
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

			const warm = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[categories][_eq]': String(junctionRowId),
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			expect(warm.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${JUNCTION}:id=${junctionRowId}(,|$)`),
			);

			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${JUNCTION}(,|$)`));
		});

		it(oneLine`
			bare-tags a to-many alias filtered by an operator that names no row
		`, async () => {
			// `_gt` and its siblings join the collection but name no row, so the
			// bare tag is the only honest answer. Before the filter was
			// normalized these carried NO tag at all — the field map never named
			// the collection — and no write to it could drop the entry.
			await clearCache();

			const readUnbounded = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owned_sub_items][_gt]': '0',
						fields: 'id,label,owner',
					})
					.set('Authorization', auth);
			};

			const warm = await readUnbounded();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			expect(warm.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNED_SUB_ITEM}/${untouchedSubItemId}`)
				.send({ note: 'unbounded-operator-write' })
				.set('Authorization', auth);

			expect((await readUnbounded()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			tags the M2O it filtered by key not at all, and survives writing it
		`, async () => {
			// `owned_item.owner = X` is answered by the row's own column. Behind
			// an enforced constraint the owner cannot be deleted without writing
			// this row too, so no owner write can change what comes back.
			await clearCache();

			const warm = await readItemsOfFilteredOwner();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNER}(:|,|$)`));

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNER}/${filteredOwnerId}`)
				.send({ name: 'independent-write' })
				.set('Authorization', auth);

			// Non-vacuity: the write landed, and the entry still stands.
			const written = await request(getUrl(vendor, env))
				.get(`/items/${OWNER}/${filteredOwnerId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('independent-write');

			expect((await readItemsOfFilteredOwner()).headers[cacheStatusHeader])
				.toBe('HIT');
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

		it(oneLine`
			bare-tags a to-many a filter counts, whatever total it matched
		`, async () => {
			// `count(owned_sub_items)` reads EVERY sub-item of every candidate row
			// to reach its total, so no key names what the read depends on. The
			// total it is compared against is a cardinality, not a row key: an
			// insert nobody named changes the count and moves the row out.
			await clearCache();

			const countedItem = await request(getUrl(vendor, env))
				.post(`/items/${OWNED_ITEM}`)
				.send({ label: 'counted', owner: filteredOwnerId })
				.set('Authorization', auth);

			const countedItemId = countedItem.body.data.id;

			await request(getUrl(vendor, env))
				.post(`/items/${OWNED_SUB_ITEM}`)
				.send({ note: 'counted-first', owned_item: countedItemId })
				.set('Authorization', auth);

			// The label narrows the result to this row alone, so the totals the
			// other tests left behind cannot decide what comes back.
			const readCountedItems = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[count(owned_sub_items)][_eq]': '1',
						'filter[label][_eq]': 'counted',
						fields: 'id,label',
					})
					.set('Authorization', auth);
			};

			const warm = await readCountedItems();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			expect(warm.body.data).toEqual([
				{ id: countedItemId, label: 'counted' },
			]);

			expect(warm.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));

			// The total is not a key, so the sub-item whose id happens to equal
			// it is pinned by nothing.
			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=1(,|$)`));

			await request(getUrl(vendor, env))
				.post(`/items/${OWNED_SUB_ITEM}`)
				.send({ note: 'counted-second', owned_item: countedItemId })
				.set('Authorization', auth);

			const refetchedCount = await readCountedItems();

			expect(refetchedCount.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetchedCount.body.data).toEqual([]);
		});

		it('is dropped by DELETING the to-many row its filter named', async () => {
			// Every other purge here is driven by a PATCH or a POST. A delete is
			// the write the keyed pin has to survive being right about: the row
			// it named stops existing, and the slice the write side emits for it
			// is the only thing that can drop the entry.
			await clearCache();

			const doomedSubItem = await request(getUrl(vendor, env))
				.post(`/items/${OWNED_SUB_ITEM}`)
				.send({ note: 'doomed', owned_item: ownedItemId })
				.set('Authorization', auth);

			const doomedSubItemId = doomedSubItem.body.data.id;

			const readDoomed = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owned_sub_items][id][_eq]': String(doomedSubItemId),
						fields: 'id,label',
					})
					.set('Authorization', auth);
			};

			const warm = await readDoomed();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			expect(warm.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=${doomedSubItemId}(,|$)`),
			);

			await request(getUrl(vendor, env))
				.delete(`/items/${OWNED_SUB_ITEM}/${doomedSubItemId}`)
				.set('Authorization', auth);

			const refetched = await readDoomed();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data).toEqual([]);
		});

		it(oneLine`
			is dropped by DELETING the M2O it tagged not at all
		`, async () => {
			// The load-bearing case for tagging an M2O filter NOTHING. The claim
			// is that the far row cannot disappear without writing the near one:
			// `on_delete` is SET NULL here, so deleting the owner rewrites the
			// item's foreign key and the item's own collection covers it. If that
			// were wrong this read would still be served with a row that no
			// longer matches.
			await clearCache();

			const doomedOwner = await request(getUrl(vendor, env))
				.post(`/items/${OWNER}`)
				.send({ name: 'doomed-owner' })
				.set('Authorization', auth);

			const doomedOwnerId = doomedOwner.body.data.id;

			const orphanedItem = await request(getUrl(vendor, env))
				.post(`/items/${OWNED_ITEM}`)
				.send({ label: 'orphaned', owner: doomedOwnerId })
				.set('Authorization', auth);

			const orphanedItemId = orphanedItem.body.data.id;

			const readOfDoomedOwner = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owner][id][_eq]': String(doomedOwnerId),
						fields: 'id,label',
					})
					.set('Authorization', auth);
			};

			const warm = await readOfDoomedOwner();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			expect(warm.body.data).toEqual([
				{ id: orphanedItemId, label: 'orphaned' },
			]);

			// The whole point: the owner carries no tag of any shape here.
			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNER}(:|,|$)`));

			await request(getUrl(vendor, env))
				.delete(`/items/${OWNER}/${doomedOwnerId}`)
				.set('Authorization', auth);

			// Non-vacuity: the delete landed and SET NULL rewrote the item,
			// rather than the database refusing it.
			const orphaned = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}/${orphanedItemId}`)
				.query({ fields: 'id,owner' })
				.set('Authorization', auth);

			expect(orphaned.body.data).toEqual({ id: orphanedItemId, owner: null });

			const refetched = await readOfDoomedOwner();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data).toEqual([]);
		});
	});
});
