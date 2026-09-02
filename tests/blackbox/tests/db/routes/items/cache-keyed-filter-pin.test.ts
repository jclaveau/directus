import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2A,
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
// A second collection, so the shapes below can carry two paths to one collection
// and an A2O hop without changing what `fields=*` splices into the reads above.
const PAGE = 'keyed_filter_page';
const BLOCK_JUNCTION = `${PAGE}_blocks_junction`;
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
		// Low enough that a handful of keys crosses it. Every other read here names
		// one key and nests at most three rows, so none of them reach it.
		env[vendor]['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] = '5';

		let instance: ChildProcess;
		let filteredOwnerId: number;
		let untouchedOwnerId: number;
		let ownedItemId: number;
		let filteredSubItemId: number;
		let junctionRowId: number;
		let untouchedSubItemId: number;
		let categoryId: number;
		let pageId: number;
		let reviewerId: number;
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
					{
						collection: PAGE,
						fields: [{ field: 'title', type: 'string', meta: {} }],
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

			// Two M2O paths from one collection to OWNER: one read names a key
			// through `owner` and reads a column through `reviewer`, which is two
			// joined rows of the same collection rather than one.
			await CreateFieldM2O(vendor, {
				collection: PAGE,
				field: 'owner',
				otherCollection: OWNER,
			});

			await CreateFieldM2O(vendor, {
				collection: PAGE,
				field: 'reviewer',
				otherCollection: OWNER,
			});

			await CreateFieldM2A(vendor, {
				collection: PAGE,
				field: 'blocks',
				relatedCollections: [CATEGORY],
				junctionCollection: BLOCK_JUNCTION,
			});

			const categories = await CreateItem(vendor, {
				collection: CATEGORY,
				item: [{ name: 'c1' }],
			});

			categoryId = categories[0].id;

			const reviewers = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'reviewer-before' }],
			});

			reviewerId = reviewers[0].id;

			const pages = await CreateItem(vendor, {
				collection: PAGE,
				item: [{
					title: 'p1',
					owner: filteredOwnerId,
					reviewer: reviewerId,
				}],
			});

			pageId = pages[0].id;

			await CreateItem(vendor, {
				collection: BLOCK_JUNCTION,
				item: [{
					[`${BLOCK_JUNCTION}_id`]: pageId,
					item: String(categoryId),
					collection: CATEGORY,
				}],
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

			await DeleteCollection(vendor, { collection: BLOCK_JUNCTION });
			await DeleteCollection(vendor, { collection: PAGE });
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

			// The same holds when the key is named by the NESTED node's own filter
			// rather than the root's: `deep` withholds sub-items, and which ones it
			// withholds is decided by rows the response never carried.
			await clearCache();

			const deepRead = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'deep[owned_sub_items][_filter][id][_eq]': String(filteredSubItemId),
					fields: 'id,owned_sub_items.id',
				})
				.set('Authorization', auth);

			expect(deepRead.headers[cacheStatusHeader]).toBe('MISS');

			expect(deepRead.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));
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

			// Counting in `fields` rather than in the filter reads the same rows,
			// so the collection is tagged there too — and wholesale, since a total
			// names none of them.
			await clearCache();

			const counted = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({ fields: 'id,count(owned_sub_items)' })
				.set('Authorization', auth);

			expect(counted.headers[cacheStatusHeader]).toBe('MISS');

			expect(counted.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));
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

		it(oneLine`
			unions the keys a disjunction names, giving up on an unkeyed branch
		`, async () => {
			// A row arriving through a branch that named no key was reached through
			// rows the filter never named, so one such branch takes the whole
			// disjunction down. With every branch keyed, a row may arrive by either,
			// so the pin is the union.
			await clearCache();

			const unioned = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[_or][0][owned_sub_items][id][_eq]': String(filteredSubItemId),
					'filter[_or][1][owned_sub_items][id][_eq]': String(untouchedSubItemId),
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(unioned.headers[cacheStatusHeader]).toBe('MISS');

			for (const key of [filteredSubItemId, untouchedSubItemId]) {
				expect(unioned.headers[cacheTagsHeader]).toMatch(
					new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=${key}(,|$)`),
				);
			}

			expect(unioned.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));

			await clearCache();

			const givenUp = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[_or][0][owned_sub_items][id][_eq]': String(filteredSubItemId),
					'filter[_or][1][owned_sub_items][note][_eq]': 'untouched-before',
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(givenUp.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));
		});

		// Two branches of the analysis are deliberately absent here, because no
		// HTTP read can reach them — `validate-query` rejects both before the
		// service runs, so they are unit-tested instead:
		//
		// - `_not`, whose object value falls to `validateFilterPrimitive` and is
		//   refused as "has to be a string, number, or boolean". The walk's
		//   `unkeyEverythingUnder` arm is then reachable only through a permission
		//   case, which bypasses query validation.
		// - an empty `_in`, refused by `validateList` as "has to be an array of
		//   values". The REST spelling `_in=` is NOT that shape: `parse-filter`
		//   sends it through `toArray`, which yields `['']` — one key, not none.

		it(oneLine`
			tags an M2O it keyed once something else reads the row
		`, async () => {
			// The two ways out of tagging an M2O filter nothing. A sibling reading
			// another of its columns has to read the far row after all — one alias
			// is one joined row, so the key still says which. A sort reads rows no
			// key named, so the collection goes back to bare.
			await clearCache();

			const sibling = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owner][id][_eq]': String(filteredOwnerId),
					'filter[owner][name][_eq]': 'independent-write',
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(sibling.headers[cacheStatusHeader]).toBe('MISS');

			expect(sibling.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${OWNER}:id=${filteredOwnerId}(,|$)`),
			);

			await clearCache();

			const sorted = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owner][id][_eq]': String(filteredOwnerId),
					sort: 'owner.name',
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(sorted.headers[cacheStatusHeader]).toBe('MISS');

			expect(sorted.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNER}(,|$)`));


			// The `group` arm of the same set. Grouping ACROSS a relation
			// (`groupBy=owner.name`) answers 500 on this fork for reasons that have
			// nothing to do with these pins, so the scalar spelling is what runs
			// here — it still reaches the branch, which is a query-shape question,
			// not a question about which column was named.
			await clearCache();

			const grouped = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owner][id][_eq]': String(filteredOwnerId),
					groupBy: 'label',
					'aggregate[count]': 'id',
				})
				.set('Authorization', auth);

			// Status and tags together: the cache status header is set on the way
			// through, so on its own it says nothing about the read succeeding.
			expect(grouped.status).toBe(200);
			expect(grouped.headers[cacheStatusHeader]).toBe('MISS');
		});

		it('pins every key an `_in` lists, each of them once', async () => {
			await clearCache();

			const readListed = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owned_sub_items][id][_in]':
							`${filteredSubItemId},${untouchedSubItemId},${untouchedSubItemId}`,
						fields: 'id,label',
					})
					.set('Authorization', auth);
			};

			const warm = await readListed();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			const listedTags = warm.headers[cacheTagsHeader].split(', ');

			for (const key of [filteredSubItemId, untouchedSubItemId]) {
				// Named twice in the list, carried once: the tag is deduped on the
				// token the write side emits for that row.
				expect(listedTags.filter((tag: string) => {
					return tag === `${OWNED_SUB_ITEM}:id=${key}`;
				})).toHaveLength(1);
			}

			// The SECOND key of the list, which an `_eq` pin would never have named.
			await request(getUrl(vendor, env))
				.patch(`/items/${OWNED_SUB_ITEM}/${untouchedSubItemId}`)
				.send({ note: 'in-list-write' })
				.set('Authorization', auth);

			expect((await readListed()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it('drops the pin whole past the ceiling, never trimmed', async () => {
			// A partial key set would leave the rows it omits covered by nothing, so
			// past `CACHE_SCOPED_MAX_PINS_PER_COLLECTION` the collection falls back
			// to the bare tag that any write to it drops.
			await clearCache();

			const overCeiling = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owned_sub_items][id][_in]': '1,2,3,4,5,6,7',
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(overCeiling.headers[cacheStatusHeader]).toBe('MISS');

			expect(overCeiling.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}(,|$)`));

			expect(overCeiling.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=`));

			// Under it, the same shape still pins.
			await clearCache();

			const underCeiling = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owned_sub_items][id][_in]': '1,2,3',
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(underCeiling.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=`));
		});

		it(oneLine`
			keys through a quantifier, which names one row of the same hop
		`, async () => {
			// `_some` and `_none` push the condition into a subquery over the row the
			// caller already crossed to, so the key names it just as narrowly — and
			// for `_none`, a row that has to NOT be there is depended on all the same.
			await clearCache();

			const some = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owned_sub_items][_some][id][_eq]': String(filteredSubItemId),
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(some.headers[cacheStatusHeader]).toBe('MISS');
			expect(some.body.data).toHaveLength(1);

			expect(some.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=${filteredSubItemId}(,|$)`),
			);

			await clearCache();

			const none = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_ITEM}`)
				.query({
					'filter[owned_sub_items][_none][id][_eq]': String(filteredSubItemId),
					fields: 'id,label',
				})
				.set('Authorization', auth);

			expect(none.headers[cacheStatusHeader]).toBe('MISS');

			expect(none.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${OWNED_SUB_ITEM}:id=${filteredSubItemId}(,|$)`),
			);
		});

		it(oneLine`
			tags a collection it hopped THROUGH, and not the leaf it keyed
		`, async () => {
			// Two hops from the sub-item: reaching the owner reads the `owner` column
			// of every item that could be joined, so no item row is named and the
			// middle collection stays bare. The leaf is answered by that column, so
			// it needs no tag at all.
			await clearCache();

			const throughItem = await request(getUrl(vendor, env))
				.get(`/items/${OWNED_SUB_ITEM}`)
				.query({
					'filter[owned_item][owner][id][_eq]': String(filteredOwnerId),
					fields: 'id,note',
				})
				.set('Authorization', auth);

			expect(throughItem.headers[cacheStatusHeader]).toBe('MISS');
			expect(throughItem.body.data.length).toBeGreaterThan(0);

			expect(throughItem.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNED_ITEM}(,|$)`));

			expect(throughItem.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNER}(:|,|$)`));
		});

		it('gives up on a collection two paths reach, one of them unkeyed', async () => {
			// `owner` and `reviewer` join two independent rows of one collection. The
			// keyed path says nothing about the row the unkeyed one reads, so the
			// collection goes back to the bare tag rather than to their union.
			await clearCache();

			const twoPaths = await request(getUrl(vendor, env))
				.get(`/items/${PAGE}`)
				.query({
					'filter[owner][id][_eq]': String(filteredOwnerId),
					'filter[reviewer][name][_eq]': 'reviewer-before',
					fields: 'id,title',
				})
				.set('Authorization', auth);

			expect(twoPaths.headers[cacheStatusHeader]).toBe('MISS');
			expect(twoPaths.body.data).toEqual([{ id: pageId, title: 'p1' }]);

			expect(twoPaths.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${OWNER}(,|$)`));

			expect(twoPaths.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${OWNER}:id=`));
		});

		it('keys the collection an A2O scope names, and nests it bare', async () => {
			// An A2O carries the table to join in the key itself, which is how the
			// walk knows which collection the far key belongs to. Unlike the M2O
			// case there is no constraint behind it — a polymorphic column cannot
			// carry one — so the far row IS depended on, and the key pins it.
			await clearCache();

			const scoped = await request(getUrl(vendor, env))
				.get(`/items/${PAGE}`)
				.query({
					[`filter[blocks][item:${CATEGORY}][id][_eq]`]: String(categoryId),
					fields: 'id,title',
				})
				.set('Authorization', auth);

			expect(scoped.headers[cacheStatusHeader]).toBe('MISS');
			expect(scoped.body.data).toEqual([{ id: pageId, title: 'p1' }]);

			expect(scoped.headers[cacheTagsHeader]).toMatch(
				new RegExp(`(^|, )${CATEGORY}:id=${categoryId}(,|$)`),
			);

			// Nesting the A2O instead reads every block the page carries, which no
			// parent-key pin can name across that hop.
			await clearCache();

			const nested = await request(getUrl(vendor, env))
				.get(`/items/${PAGE}`)
				.query({ fields: `id,blocks.item:${CATEGORY}.id` })
				.set('Authorization', auth);

			expect(nested.headers[cacheStatusHeader]).toBe('MISS');

			expect(nested.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${CATEGORY}(,|$)`));
		});
	});
});
