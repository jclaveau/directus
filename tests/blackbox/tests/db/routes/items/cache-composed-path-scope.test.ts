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

// The unit tests drive a knex mock, so they pin the merged query's shape but never
// that a database accepts it or that each terminal returns on its own column.

const ORG = 'composed_org';
const ACCOUNT = 'composed_account';
const ENTRY = 'composed_entry';

const purgedTagsHeader = 'x-scoped-cache-purged-tags';
const statusHeader = 'x-cache-status';

describe(oneLine`
	a collection scoped through two composed hops purges both derived slices
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-composed-path-${vendor}`;
		env[vendor]['CACHE_PURGED_TAGS_HEADER'] = purgedTagsHeader;
		env[vendor]['CACHE_STATUS_HEADER'] = statusHeader;

		let instance: ChildProcess;
		let entryId: number;
		let accountId: number;
		let orgId: number;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ORG,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [{ field: 'owner', type: 'string', meta: {} }],
					},
					{ collection: ACCOUNT, fields: [] },
					{
						collection: ENTRY,
						fields: [{ field: 'revision', type: 'integer', meta: {} }],
					},
				],
			});

			// Each m2o has to exist before its collection can scope by it, and the paths
			// compose from the schema at boot, so both precede the spawn below.
			await CreateFieldM2O(vendor, {
				collection: ACCOUNT,
				field: 'org',
				otherCollection: ORG,
			});

			await CreateFieldM2O(vendor, {
				collection: ENTRY,
				field: 'account',
				otherCollection: ACCOUNT,
			});

			await request(getUrl(vendor, env))
				.patch(`/collections/${ACCOUNT}`)
				.send({ meta: { scoped_cache_fields: ['org'] } })
				.set('Authorization', auth);

			await request(getUrl(vendor, env))
				.patch(`/collections/${ENTRY}`)
				.send({ meta: { scoped_cache_fields: ['account'] } })
				.set('Authorization', auth);

			const orgs = await CreateItem(vendor, {
				collection: ORG,
				item: [{ owner: 'acme' }],
			});

			orgId = orgs[0].id;

			const accounts = await CreateItem(vendor, {
				collection: ACCOUNT,
				item: [{ org: orgId }],
			});

			accountId = accounts[0].id;

			const entries = await CreateItem(vendor, {
				collection: ENTRY,
				item: [{ revision: 0, account: accountId }],
			});

			entryId = entries[0].id;

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

			await DeleteCollection(vendor, { collection: ENTRY });
			await DeleteCollection(vendor, { collection: ACCOUNT });
			await DeleteCollection(vendor, { collection: ORG });
		});

		it(oneLine`
			purges the slice of every composed path, each carrying its own ancestor's
			terminal
		`, async () => {
			const response = await request(getUrl(vendor, env))
				.patch(`/items/${ENTRY}/${entryId}`)
				.send({ revision: 1 })
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);

			// Both composed terminals come off the SAME joined query, so a column read
			// against the wrong path surfaces as a wrong value, not a missing tag.
			expect(response.headers[purgedTagsHeader].split(', ').sort()).toEqual([
				`${ENTRY}:account.org.owner=acme`,
				`${ENTRY}:account.org=${orgId}`,
				`${ENTRY}:account=${accountId}`,
				`${ENTRY}:id=${entryId}`,
			].sort());
		});
	});
});
