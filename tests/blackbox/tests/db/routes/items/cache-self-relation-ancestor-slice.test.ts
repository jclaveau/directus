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

// RED until fixed. `readTags` bares the root when it appears at more than one
// field-map path, then reaches it again with an empty `rootScopedCacheTags`, falls
// through to `pushAncestorSliceOrBare` and takes the slice of an ancestor the
// filter keyed — undoing the guard it just applied. The ancestor has to be KEYED
// rather than answered by the near row's own fk column, so the filter reaches ORG
// through the composed `owner.org` path: `filter[owner][id]` would mark OWNER
// `independent` and pin nothing. The read is bounded to org A while its nested
// `parent` belongs to org B, so a write to that parent purges `owner.org=B` and
// this entry serves a row it no longer holds.

const ORG = 'sr_anc_org';
const OWNER = 'sr_anc_owner';
const NODE = 'sr_anc_node';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a self-referential root takes an ancestor slice despite the self-reference guard,
	so a write to a nested parent in another slice serves stale (#428)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-sr-anc-${vendor}`;

		let instance: ChildProcess;
		let readOrgId: number;
		let parentNodeId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ORG,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: NODE,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: OWNER,
				field: 'org',
				otherCollection: ORG,
			});

			await CreateFieldM2O(vendor, {
				collection: NODE,
				field: 'owner',
				otherCollection: OWNER,
			});

			// The subject: the root reached again through its own field, so
			// `rootPaths.size > 1` and the filter bounds only half the response.
			await CreateFieldM2O(vendor, {
				collection: NODE,
				field: 'parent',
				otherCollection: NODE,
			});

			// Each m2o exists before its collection scopes by it, and the two
			// hops compose into the `owner.org` path the read is pinned on.
			await request(getUrl(vendor, env))
				.patch(`/collections/${OWNER}`)
				.send({ meta: { scoped_cache_fields: ['org'] } })
				.set('Authorization', auth);

			await request(getUrl(vendor, env))
				.patch(`/collections/${NODE}`)
				.send({ meta: { scoped_cache_fields: ['owner'] } })
				.set('Authorization', auth);

			const orgs = await CreateItem(vendor, {
				collection: ORG,
				item: [{ name: 'org-of-read' }, { name: 'org-of-parent' }],
			});

			readOrgId = orgs[0].id;

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [
					{ name: 'owner-of-read', org: readOrgId },
					{ name: 'owner-of-parent', org: orgs[1].id },
				],
			});

			// The parent sits in ANOTHER org slice than the read is bounded to.
			const parents = await CreateItem(vendor, {
				collection: NODE,
				item: [{ label: 'parent-v1', owner: owners[1].id }],
			});

			parentNodeId = parents[0].id;

			await CreateItem(vendor, {
				collection: NODE,
				item: [{
					label: 'child',
					owner: owners[0].id,
					parent: parentNodeId,
				}],
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

			await DeleteCollection(vendor, { collection: NODE });
			await DeleteCollection(vendor, { collection: OWNER });
			await DeleteCollection(vendor, { collection: ORG });
		});

		function readNodes() {
			return request(getUrl(vendor, env))
				.get(`/items/${NODE}`)
				.query({
					'filter[owner][org][id][_eq]': String(readOrgId),
					fields: '*,parent.*',
				})
				.set('Authorization', auth);
		}

		function renameParent(label: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${NODE}/${parentNodeId}`)
				.send({ label })
				.set('Authorization', auth);
		}

		it(oneLine`
			keeps the self-referential root bare, then evicts the read on a
			write to a nested parent from another org slice
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warm = await readNodes();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data[0].parent.label).toBe('parent-v1');

			// PRIMARY (RED until fixed): the root carries its bare tag, never the
			// `owner.org=<read org>` slice its nested parent sits outside of.
			expect(warm.headers[cacheTagsHeader]).toEqual(
				`${NODE}, ${OWNER}:org=${readOrgId}`,
			);

			expect((await readNodes()).headers[cacheStatusHeader]).toBe('HIT');

			await renameParent('parent-v2');

			const after = await readNodes();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data[0].parent.label).toBe('parent-v2');
		});
	});
});
