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
				item: [{ name: 'root', main: ownedParentId }],
			});

			rootId = roots[0].id;

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

		it('leaves an O2M nested under another to-many bare', async () => {
			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${PARENT}`)
				.query({
					'filter[id][_eq]': String(ownedParentId),
					fields: '*,children.grandchildren.*',
				})
				.set('Authorization', auth)).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${GRANDCHILD}(,|$)`));

			expect(tags).not.toMatch(new RegExp(`(^|, )${GRANDCHILD}:`));

			// The nearer child still slices — the decline is the deeper hop, not blanket.
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
	});
});
