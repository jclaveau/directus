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

// Any per-row policy filter empties `allowedFields`, so every field of the read
// carries a whenCase — including one naming the single case the returned rows
// already matched, which withholds nothing.
const PARENT = 'when_case_parent';
const CHILD = 'when_case_child';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an m2o read under every one of its parent's cases is pinned by key, not bare (#466)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-when-case-pin-${vendor}`;

		let instance: ChildProcess;
		let parentId: number;
		const coveringToken = `when-case-all-${vendor}-00000000000000000000`;
		const partialToken = `when-case-some-${vendor}-0000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;

		// A non-null filter is what drives `hasItemPermissions` true, which is what
		// leaves nothing in `allowedFields`.
		const readEverything = (collection: string) => {
			return {
				policy: '+',
				permissions: { id: { _nnull: true } },
				validation: null,
				fields: ['*'],
				presets: null,
				collection,
				action: 'read',
			};
		};

		const createUser = async (
			name: string,
			token: string,
			permissions: unknown[],
		) => {
			const response = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', admin)
				.send({
					first_name: name,
					token,
					policies: {
						create: [{
							policy: {
								name: `${name} policy`,
								app_access: true,
								permissions: { create: permissions, update: [], delete: [] },
							},
						}],
						update: [],
						delete: [],
					},
				});

			if (!response.ok) {
				throw new Error(
					`Could not create user: ${JSON.stringify(response.body)}`,
				);
			}
		};

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: PARENT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: CHILD,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: CHILD,
				field: 'parent',
				otherCollection: PARENT,
			});

			await createUser('when case covering', coveringToken, [
				readEverything(PARENT),
				readEverything(CHILD),
			]);

			// A second rule on the child, with its own filter and a narrower field
			// set, leaves `parent` readable under the first case only.
			await createUser('when case partial', partialToken, [
				readEverything(PARENT),
				readEverything(CHILD),
				{
					policy: '+',
					permissions: { label: { _eq: 'never matched' } },
					validation: null,
					fields: ['label'],
					presets: null,
					collection: CHILD,
					action: 'read',
				},
			]);

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [{ name: 'a parent' }],
			});

			parentId = parents[0].id;

			await CreateItem(vendor, {
				collection: CHILD,
				item: [{ label: 'a child', parent: parentId }],
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

		// No filter names the parent, so the M2O row pin is the only thing that can
		// slice it and the case gate the only thing that can stop that pin.
		const readChildrenAs = (token: string) => {
			return request(getUrl(vendor, env))
				.get(`/items/${CHILD}`)
				.query({ fields: '*,parent.*' })
				.set('Authorization', `Bearer ${token}`);
		};

		it('key-slices the parent when the node reads under every case', async () => {
			const response = await readChildrenAs(coveringToken);
			const tags = response.headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${PARENT}:id=${parentId}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${PARENT}(,|$)`));
		});

		it('keeps the parent bare when a case withholds it', async () => {
			const response = await readChildrenAs(partialToken);
			const tags = response.headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${PARENT}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${PARENT}:id=`));
		});

		it('nests the parent for both readers alike', async () => {
			const covering = await readChildrenAs(coveringToken);
			const partial = await readChildrenAs(partialToken);

			expect(covering.body.data[0].parent.id).toBe(parentId);
			expect(partial.body.data[0].parent.id).toBe(parentId);
		});
	});
});
