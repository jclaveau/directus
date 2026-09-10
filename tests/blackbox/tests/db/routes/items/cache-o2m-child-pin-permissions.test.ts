import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateFieldO2M, CreateItem } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Read as a non-admin whose policy filters both collections per-row, so the nested
// child carries a whenCase — which never marks an O2M "beyond", so the pin holds.
const PARENT = 'perm_o2m_parent';
const CHILD = 'perm_o2m_child';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a permission-gated embedded child is still pinned by its parent fk (#411)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-perm-o2m-child-pin-${vendor}`;

		let instance: ChildProcess;
		let ownedParentId: number;
		const userToken = `perm-o2m-${vendor}-000000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: PARENT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: CHILD,
						meta: { scoped_cache_fields: ['parent'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldO2M(vendor, {
				collection: PARENT,
				field: 'children',
				otherCollection: CHILD,
				otherField: 'parent',
			});

			const userResponse = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', admin)
				.send({
					first_name: 'perm o2m user',
					token: userToken,
					policies: {
						create: [{
							policy: {
								name: 'perm o2m policy',
								app_access: true,
								permissions: {
									// A non-null per-row filter gives each collection a whenCase.
									create: [PARENT, CHILD].map((collection) => {
										return {
											policy: '+',
											permissions: { id: { _nnull: true } },
											validation: null,
											fields: ['*'],
											presets: null,
											collection,
											action: 'read',
										};
									}),
									update: [],
									delete: [],
								},
							},
						}],
						update: [],
						delete: [],
					},
				});

			if (!userResponse.ok) {
				throw new Error(
					`Could not create user: ${JSON.stringify(userResponse.body)}`,
				);
			}

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [{ name: 'parent-owned' }],
			});

			ownedParentId = parents[0].id;

			await CreateItem(vendor, {
				collection: CHILD,
				item: [{ body: 'owned child', parent: ownedParentId }],
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
		});

		it('key-slices the permission-gated embedded child, never bare', async () => {
			const response = await request(getUrl(vendor, env))
				.get(`/items/${PARENT}`)
				.query({
					'filter[id][_eq]': String(ownedParentId),
					fields: '*,children.*',
				})
				.set('Authorization', asUser);

			const tags = response.headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${CHILD}:parent=${ownedParentId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${CHILD}(,|$)`));
		});
	});
});
