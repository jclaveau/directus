import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
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

// BUG (stale HIT): a nested collection keyed ONLY by a permission CASE (no query
// filter) wrongly carries its keyed slice instead of a bare/ancestor tag, so a
// write to a SIBLING nested row is not purged and the read serves stale. Root
// cause: `collectionsFetchedAsRows` (item-scoped-cache-service.ts) is built from
// `fieldMap.read` (filter/sort paths) while carried nested rows live in
// `fieldMap.other`; permission cases reach `keyedFilterPins` but never
// `collectionsFetchedAsRows`, so the case-only nested collection satisfies the
// "reached ONLY through a keyed filter" exception and pins the unsound slice.
// This test MUST be RED until the readTags fix lands.

const PARENT = 'case_keyed_nested_parent';
const CHILD = 'case_keyed_nested_child';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a nested collection keyed only by a permission case is tagged bare,
	not by the case's pk slice, so a sibling write serves fresh
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-case-keyed-nested-${vendor}`;

		let instance: ChildProcess;
		let childAId: number;
		let childBId: number;
		const freshLabel = 'sibling child fresh label';
		const userToken = `case-nested-${vendor}-00000000000000000000`;
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
						// No `scoped_cache_fields`, so the O2M child-pin declines and
						// the only slice on offer is the one the case keys by pk.
						collection: CHILD,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			// Creates the `children` alias on the parent AND the `parent` fk on the
			// child, so a read of `parent?fields=children.*` nests the child set.
			await CreateFieldO2M(vendor, {
				collection: PARENT,
				field: 'children',
				otherCollection: CHILD,
				otherField: 'parent',
			});

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [{ name: 'bound parent' }],
			});

			const children = await CreateItem(vendor, {
				collection: CHILD,
				item: [
					{ label: 'child A label', parent: parents[0].id },
					{ label: 'child B label', parent: parents[0].id },
				],
			});

			childAId = children[0].id;
			childBId = children[1].id;

			const userResponse = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', admin)
				.send({
					first_name: 'case nested user',
					token: userToken,
					policies: {
						create: [{
							policy: {
								name: 'case nested policy',
								app_access: true,
								permissions: {
									create: [
										{
											policy: '+',
											// The parent is visible iff it owns child A.
											// The case crosses the `children` o2m onto
											// child's pk — no query filter is sent — so
											// the keying pins `child:id=<childAId>`, while
											// the read still nests BOTH child A and B.
											permissions: {
												children: { id: { _eq: childAId } },
											},
											validation: null,
											fields: ['*'],
											presets: null,
											collection: PARENT,
											action: 'read',
										},
										{
											policy: '+',
											permissions: { id: { _nnull: true } },
											validation: null,
											fields: ['*'],
											presets: null,
											collection: CHILD,
											action: 'read',
										},
									],
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

			await DeleteCollection(vendor, { collection: CHILD });
			await DeleteCollection(vendor, { collection: PARENT });
		});

		// Both tests read the same nested shape as the gated user.
		function readAsUser() {
			return request(getUrl(vendor, env))
				.get(`/items/${PARENT}`)
				.query({ fields: 'id,children.id,children.label' })
				.set('Authorization', asUser);
		}

		it(oneLine`
			serves a sibling nested child's fresh label after a write,
			not the cached slice's stale one
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', admin);

			const warm = await readAsUser();
			expect(warm.status).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			// Non-vacuity: the parent really nested both children, so a write to
			// child B genuinely changes what this read returns.
			expect(warm.body.data[0].children).toHaveLength(2);

			await request(getUrl(vendor, env))
				.patch(`/items/${CHILD}/${childBId}`)
				.send({ label: freshLabel })
				.set('Authorization', admin);

			const reread = await readAsUser();

			const childBRow = reread.body.data[0].children.find(
				(row: { id: number; label: string }) => row.id === childBId,
			);

			// RED on buggy code: the read stayed cached under `child:id=<childAId>`,
			// which the child B write never purged, so the stale old label is served.
			expect(childBRow.label).toBe(freshLabel);
		});

		it(oneLine`
			tags the nested case-keyed child bare, not by the case's pk slice
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', admin);

			const tags = (await readAsUser()).headers[cacheTagsHeader];

			// Fixed: a bare `child` tag every child write drops. Buggy: only
			// `child:id=<childAId>`, the case's slice, which a sibling write misses.
			expect(tags).toMatch(new RegExp(`(^|, )${CHILD}(,|$)`));

			expect(tags).not.toMatch(new RegExp(`(^|, )${CHILD}:id=`));
		});
	});
});
