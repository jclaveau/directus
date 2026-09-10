import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
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

// A parent embeds its to-many `children`, so the read depends on every child WHERE
// `child.parent = parent.id` and pins `o2m_child:parent=<parentId>`, never bare.
const ROOT = 'o2m_root';
const PARENT = 'o2m_parent';
const CHILD = 'o2m_child';
const GRANDCHILD = 'o2m_grandchild';
const CONFLICT_PARENT = 'o2m_conflict_parent';
const CONFLICT_CHILD = 'o2m_conflict_child';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read pins an embedded to-many child by its parent fk, never bare (#411)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-child-pin-${vendor}`;

		let instance: ChildProcess;
		let rootId: number;
		let mainlessRootId: number;
		let conflictParentId: number;
		let conflictChildId: number;
		let ownedParentId: number;
		let siblingParentId: number;
		let ownedChildId: number;
		let siblingChildId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: PARENT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: CHILD,
						meta: { scoped_cache_fields: ['parent'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
					{
						collection: CONFLICT_PARENT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: CONFLICT_CHILD,
						// Both fks declared, so each alias clears the "the write side
						// emits this shallow tag" gate on its own and the refusal below
						// is about the disagreement, not about the gate.
						meta: { scoped_cache_fields: ['parent', 'alt_parent'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
					{
						collection: GRANDCHILD,
						meta: { scoped_cache_fields: ['child'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			// `main` is an M2O from the root down to the parent the o2m hangs off, so a
			// read of the root reaches `children` through an M2O prefix.
			await CreateFieldM2O(vendor, {
				collection: ROOT,
				field: 'main',
				otherCollection: PARENT,
			});

			// Creates the `children` alias on the parent AND the `parent` fk on the child.
			await CreateFieldO2M(vendor, {
				collection: PARENT,
				field: 'children',
				otherCollection: CHILD,
				otherField: 'parent',
			});

			// Two aliases onto ONE child collection, over different fks — on their own
			// pair of collections, because `fields: '*,children.*'` splices every alias
			// of the collection it reads and a second one here would join every test
			// above. One read reaching both leaves the pin two disagreeing answers.
			await CreateFieldO2M(vendor, {
				collection: CONFLICT_PARENT,
				field: 'children',
				otherCollection: CONFLICT_CHILD,
				otherField: 'parent',
			});

			await CreateFieldO2M(vendor, {
				collection: CONFLICT_PARENT,
				field: 'alt_children',
				otherCollection: CONFLICT_CHILD,
				otherField: 'alt_parent',
			});

			// A second to-many hop: `grandchildren` sits under `children`, so its prefix
			// is O2M and the pin must decline it to the bare tag.
			await CreateFieldO2M(vendor, {
				collection: CHILD,
				field: 'grandchildren',
				otherCollection: GRANDCHILD,
				otherField: 'child',
			});

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [{ name: 'parent-owned' }, { name: 'parent-sibling' }],
			});

			ownedParentId = parents[0].id;
			siblingParentId = parents[1].id;

			const children = await CreateItem(vendor, {
				collection: CHILD,
				item: [
					{ body: 'owned child', parent: ownedParentId },
					{ body: 'sibling child', parent: siblingParentId },
				],
			});

			ownedChildId = children[0].id;
			siblingChildId = children[1].id;

			await CreateItem(vendor, {
				collection: GRANDCHILD,
				item: [{ body: 'a grandchild', child: ownedChildId }],
			});

			const roots = await CreateItem(vendor, {
				collection: ROOT,
				item: [
					{ name: 'root', main: ownedParentId },
					// No `main` at all: a read descending that prefix finds null where a
					// relation was expected and surfaces no parent row.
					{ name: 'root-without-main', main: null },
				],
			});

			rootId = roots[0].id;
			mainlessRootId = roots[1].id;

			const conflictParents = await CreateItem(vendor, {
				collection: CONFLICT_PARENT,
				item: [{ name: 'conflict-parent' }],
			});

			conflictParentId = conflictParents[0].id;

			const conflictChildren = await CreateItem(vendor, {
				collection: CONFLICT_CHILD,
				item: [{ body: 'reached by both aliases', parent: conflictParentId }],
			});

			conflictChildId = conflictChildren[0].id;

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

			await DeleteCollection(vendor, { collection: CONFLICT_CHILD });
			await DeleteCollection(vendor, { collection: CONFLICT_PARENT });
			await DeleteCollection(vendor, { collection: GRANDCHILD });
			await DeleteCollection(vendor, { collection: CHILD });
			await DeleteCollection(vendor, { collection: ROOT });
			await DeleteCollection(vendor, { collection: PARENT });
		});

		// `fields: '*,children.*'` embeds the to-many, so the read nests the child set.
		function readParent() {
			return request(getUrl(vendor, env))
				.get(`/items/${PARENT}`)
				.query({
					'filter[id][_eq]': String(ownedParentId),
					fields: '*,children.*',
				})
				.set('Authorization', auth);
		}

		function updateChild(id: number, body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${CHILD}/${id}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('pins the embedded child by its parent fk, never bare', async () => {
			const tags = (await readParent()).headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${CHILD}:parent=${ownedParentId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${CHILD}(,|$)`));
		});

		it('pins the embedded child reached through an M2O prefix', async () => {
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({
					'filter[id][_eq]': String(rootId),
					fields: '*,main.children.*',
				})
				.set('Authorization', auth)).headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${CHILD}:parent=${ownedParentId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${CHILD}(,|$)`));

			// The M2O ancestor on the prefix slices too — both pins coexist.
			expect(tags).toMatch(new RegExp(`(^|, )${PARENT}:id=${ownedParentId}(,|$)`));
		});

		it('pins one slice per parent row across a multi-parent read', async () => {
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${PARENT}`)
				.query({ fields: '*,children.*' })
				.set('Authorization', auth)).headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${CHILD}:parent=${ownedParentId}(,|$)`),
			);

			expect(tags).toMatch(
				new RegExp(`(^|, )${CHILD}:parent=${siblingParentId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${CHILD}(,|$)`));
		});

		it('slices an O2M nested under another to-many by its parent fk', async () => {
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${PARENT}`)
				.query({
					'filter[id][_eq]': String(ownedParentId),
					fields: '*,children.grandchildren.*',
				})
				.set('Authorization', auth)).headers[cacheTagsHeader];

			// The prefix descends the `children` array to reach the child pks the
			// grandchild is keyed by, so a deep pivot slices instead of falling bare.
			expect(tags).toMatch(
				new RegExp(`(^|, )${GRANDCHILD}:child=${ownedChildId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${GRANDCHILD}(,|$)`));

			expect(tags).toMatch(
				new RegExp(`(^|, )${CHILD}:parent=${ownedParentId}(,|$)`),
			);
		});

		it('leaves the child bare when a filter reaches into it', async () => {
			// Filtering parents by a non-key child field makes the read depend on child
			// rows beyond the nested ones, so the parent-fk pin would serve stale — bare.
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${PARENT}`)
				.query({
					'filter[children][body][_eq]': 'owned child',
					fields: '*,children.*',
				})
				.set('Authorization', auth)).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${CHILD}(,|$)`));

			expect(tags).not.toMatch(new RegExp(`(^|, )${CHILD}:parent=`));
		});

		it('a write to a sibling parent\'s child keeps the read cached', async () => {
			await clearCache();

			expect((await readParent()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readParent()).headers[cacheStatusHeader]).toBe('HIT');

			await updateChild(siblingChildId, 'sibling child touched');

			expect((await readParent()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a write to this parent\'s own child evicts the read', async () => {
			await clearCache();

			expect((await readParent()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readParent()).headers[cacheStatusHeader]).toBe('HIT');

			await updateChild(ownedChildId, 'owned child touched');

			expect((await readParent()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			leaves the child bare when the prefix surfaces no parent row
		`, async () => {
			// The root carries no `main`, so descending that prefix finds null where
			// a relation was expected and yields no parent to key on. Pinning the
			// child to nothing would drop its tag, so it stays bare and any write to
			// the collection still evicts.
			await clearCache();

			const readMainless = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${ROOT}`)
					.query({
						'filter[id][_eq]': String(mainlessRootId),
						fields: 'id,main.children.id',
					})
					.set('Authorization', auth);
			};

			const warm = await readMainless();
			expect(warm.status).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toEqual([{ id: mainlessRootId, main: null }]);

			expect(warm.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${CHILD}(,|$)`));

			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${CHILD}:parent=`));

			// Bare means a child of ANY parent evicts it, including the sibling's.
			expect((await readMainless()).headers[cacheStatusHeader]).toBe('HIT');

			await updateChild(siblingChildId, 'sibling touched for mainless root');

			expect((await readMainless()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			leaves the child bare when two aliases disagree on its fk
		`, async () => {
			// `children` keys the child on `parent` and `alt_children` keys it on
			// `alt_parent`. One read reaching both leaves one collection with two
			// answers, and a pin that picked either would leave the rows the other
			// names covered by nothing.
			await clearCache();

			const readBothAliases = () => {
				return request(getUrl(vendor, env))
					.get(`/items/${CONFLICT_PARENT}`)
					.query({
						'filter[id][_eq]': String(conflictParentId),
						fields: 'id,children.id,alt_children.id',
					})
					.set('Authorization', auth);
			};

			const warm = await readBothAliases();
			expect(warm.status).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			expect(warm.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${CONFLICT_CHILD}(,|$)`));

			expect(warm.headers[cacheTagsHeader])
				.not.toMatch(new RegExp(`(^|, )${CONFLICT_CHILD}:(alt_)?parent=`));

			expect((await readBothAliases()).headers[cacheStatusHeader]).toBe('HIT');

			// Bare: this child is under only ONE of the two aliases, and a write to it
			// evicts all the same.
			await request(getUrl(vendor, env))
				.patch(`/items/${CONFLICT_CHILD}/${conflictChildId}`)
				.send({ body: 'touched under one alias' })
				.set('Authorization', auth);

			expect((await readBothAliases()).headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
