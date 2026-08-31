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

// The crossing keying must fire when the crossing comes from a permission CASE,
// not only an explicit query filter: this read sends no filter, and the policy's
// `profile.account = <id>` reaches the keying via `joinFilterWithCases`. A policy
// writes `$CURRENT_USER`, but the keying resolves it to a concrete id first, so a
// concrete-id case on a custom owner collection exercises the same case path.

const ACCOUNT = 'crossing_fk_perm_account';
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
		let boundAccountId: number;
		const userToken = `crossing-perm-${vendor}-00000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ACCOUNT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
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

			const accounts = await CreateItem(vendor, {
				collection: ACCOUNT,
				item: [{ name: 'bound' }, { name: 'other' }],
			});

			boundAccountId = accounts[0].id;

			const profiles = await CreateItem(vendor, {
				collection: PROFILE,
				item: [{ label: 'p', account: boundAccountId }],
			});

			await CreateItem(vendor, {
				collection: MEMBERSHIP,
				item: [{ name: 'm', profile: profiles[0].id }],
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
											// The case that crosses the M2O onto the scope-field
											// fk — no explicit query filter is sent by the read.
											permissions: {
												profile: { account: { _eq: boundAccountId } },
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
										{
											policy: '+',
											permissions: { id: { _nnull: true } },
											validation: null,
											fields: ['*'],
											presets: null,
											collection: ACCOUNT,
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

			await DeleteCollection(vendor, { collection: MEMBERSHIP });
			await DeleteCollection(vendor, { collection: PROFILE });
			await DeleteCollection(vendor, { collection: ACCOUNT });
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
				new RegExp(`(^|, )${PROFILE}:account=${boundAccountId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));
		});
	});
});
