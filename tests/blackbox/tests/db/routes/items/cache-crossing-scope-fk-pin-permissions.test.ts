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

// The scope-fk crossing must key the near collection when the crossing comes from a
// permission CASE, not only an explicit query filter: this read sends no filter, and
// the policy's `profile.account = $CURRENT_USER` reaches the keying via
// `joinFilterWithCases`. The real planner cursus shape — a per-user policy on an
// owner column that is itself an M2O onto directus_users.

const ACCOUNT = 'directus_users';
const PROFILE = 'crossing_fk_perm_profile';
const MEMBERSHIP = 'crossing_fk_perm_membership';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a permission-case scope-fk crossing keys the near collection
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-crossing-perm-${vendor}`;

		let instance: ChildProcess;
		let userId: string;
		const userToken = `crossing-perm-${vendor}-00000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: PROFILE,
						meta: { scoped_cache_fields: ['account'] },
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						collection: MEMBERSHIP,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: PROFILE,
				field: 'account',
				otherCollection: ACCOUNT,
			});

			await CreateFieldM2O(vendor, {
				collection: MEMBERSHIP,
				field: 'profile',
				otherCollection: PROFILE,
			});

			const userResponse = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', admin)
				.send({
					first_name: 'crossing perm user',
					token: userToken,
					policies: {
						create: [{
							policy: {
								name: 'crossing perm policy',
								app_access: true,
								permissions: {
									create: [
										{
											policy: '+',
											// The per-user case that crosses the M2O onto the
											// scope-field fk — no explicit query filter is sent.
											permissions: {
												profile: { account: { _eq: '$CURRENT_USER' } },
											},
											validation: null,
											fields: ['*'],
											presets: null,
											collection: MEMBERSHIP,
											action: 'read',
										},
										{
											policy: '+',
											permissions: { id: { _nnull: true } },
											validation: null,
											fields: ['*'],
											presets: null,
											collection: PROFILE,
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

			userId = userResponse.body.data.id;

			const profiles = await CreateItem(vendor, {
				collection: PROFILE,
				item: [{ label: 'p', account: userId }],
			});

			await CreateItem(vendor, {
				collection: MEMBERSHIP,
				item: [{ name: 'm', profile: profiles[0].id }],
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

			await DeleteCollection(vendor, { collection: MEMBERSHIP });
			await DeleteCollection(vendor, { collection: PROFILE });
		});

		it(oneLine`
			pins the near collection by the scope-fk the policy case named
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', admin);

			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${MEMBERSHIP}`)
				.query({ fields: 'id,name' })
				.set('Authorization', asUser))
				.headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${PROFILE}:account=${userId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));
		});
	});
});
