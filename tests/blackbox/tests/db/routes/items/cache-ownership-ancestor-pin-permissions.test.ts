import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateFieldM2O, CreateItem } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Read as a non-admin whose policy filters each collection by `user_created`, so
// every ancestor carries a whenCase and is "beyond" — the case the override covers.
const ROOT = 'perm_anc_root';
const GRANDOWNER = 'perm_anc_grandowner';
const OWNER = 'perm_anc_owner';
const NOTE = 'perm_anc_note';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a permission-gated ownership ancestor is still pinned by key, not bare (#410)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-perm-ancestor-pin-${vendor}`;

		let instance: ChildProcess;
		let ownerId: number;
		let ownedGrandownerId: number;
		const userToken = `perm-anc-${vendor}-000000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;

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

			const userResponse = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', admin)
				.send({
					first_name: 'perm anc user',
					token: userToken,
					policies: {
						create: [{
							policy: {
								name: 'perm anc policy',
								app_access: true,
								permissions: {
									// A non-null per-row filter gives each collection a whenCase,
									// marking its nested rows "beyond" — the override's case.
									create: [ROOT, GRANDOWNER, OWNER, NOTE].map((collection) => {
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

			const roots = await CreateItem(vendor, {
				collection: ROOT,
				item: [{ name: 'root' }],
			});

			const grandowners = await CreateItem(vendor, {
				collection: GRANDOWNER,
				item: [{ name: 'grandowner', root: roots[0].id }],
			});

			ownedGrandownerId = grandowners[0].id;

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
		});

		function readNotesAsUser() {
			return request(getUrl(vendor, env))
				.get(`/items/${NOTE}`)
				.query({ 'filter[owner][id][_eq]': String(ownerId), fields: '*' })
				.set('Authorization', asUser);
		}

		it('key-slices the permission-gated two-hop ancestor, never bare', async () => {
			const tags = (await readNotesAsUser()).headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${GRANDOWNER}:id=${ownedGrandownerId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${GRANDOWNER}(,|$)`));
		});

		it('key-slices the permission-gated direct-fk ancestor too', async () => {
			const tags = (await readNotesAsUser()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${OWNER}:id=${ownerId}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${OWNER}(,|$)`));
		});

		it(oneLine`
			does not leak the injected nesting into the permission-gated response
		`, async () => {
			const note = (await readNotesAsUser()).body.data[0];

			expect(note.owner).toBe(ownerId);
			expect(note).not.toHaveProperty('grandowner');
		});
	});
});
