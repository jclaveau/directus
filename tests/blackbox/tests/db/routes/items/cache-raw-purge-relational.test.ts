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

// purgeForMutatedRows on a collection scoped THROUGH a relation (#304). `entry` is
// scoped by `account.owner` — a raw row carries only the account fk, not the pinned
// terminal owner, so the helper can't build the right slice tag and falls back to a
// collection-wide purge. Proves the mutated collection refreshes (no stale HIT the
// flat-only derivation would leave) while a different collection stays cached.

const ACCOUNT = 'rawpurge_account';
const ENTRY = 'rawpurge_entry';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	purgeForMutatedRows on a relationally-scoped collection falls back to a
	collection-wide purge — refreshes it, spares others (#304)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-rawpurge-rel-${vendor}`;

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ACCOUNT,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [{ field: 'owner', type: 'string', meta: {} }],
					},
					{
						collection: ENTRY,
						fields: [{ field: 'revision', type: 'integer', meta: {} }],
					},
				],
			});

			// The m2o must exist before `entry` can scope by `account.owner`, so set the
			// relational scope field only after the field is created.
			await CreateFieldM2O(vendor, {
				collection: ENTRY,
				field: 'account',
				otherCollection: ACCOUNT,
			});

			await request(getUrl(vendor, env))
				.patch(`/collections/${ENTRY}`)
				.send({ meta: { scoped_cache_fields: ['account.owner'] } })
				.set('Authorization', auth);

			// owner A: 1 account + 2 entries; owner B (control): 1 account + 1 entry.
			const [accountsA, accountsB] = await Promise.all([
				CreateItem(vendor, { collection: ACCOUNT, item: [{ owner: 'A' }] }),
				CreateItem(vendor, { collection: ACCOUNT, item: [{ owner: 'B' }] }),
			]);

			await Promise.all([
				CreateItem(vendor, {
					collection: ENTRY,
					item: [
						{ revision: 0, account: accountsA[0].id },
						{ revision: 0, account: accountsA[0].id },
					],
				}),
				CreateItem(vendor, {
					collection: ENTRY,
					item: [{ revision: 0, account: accountsB[0].id }],
				}),
			]);

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

			await Promise.all([
				DeleteCollection(vendor, { collection: ENTRY }),
				DeleteCollection(vendor, { collection: ACCOUNT }),
			]);
		});

		function readEntries(owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${ENTRY}`)
				.query({ 'filter[account][owner][_eq]': owner })
				.set('Authorization', auth);
		}

		function readAccount(owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${ACCOUNT}`)
				.query({ 'filter[owner][_eq]': owner })
				.set('Authorization', auth);
		}

		it(oneLine`
			refreshes the relationally-scoped collection and leaves a different
			collection cached
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both owners' entry slices plus a different collection (account) as the
			// spared-collection control.
			const [warmEntryA, warmEntryB, warmAccountA] = await Promise.all([
				readEntries('A'),
				readEntries('B'),
				readAccount('A'),
			]);

			expect(warmEntryA.body.data).toHaveLength(2);
			expect(warmEntryA.body.data.every((row) => row.revision === 0)).toBe(true);
			expect(warmEntryB.body.data[0].revision).toBe(0);
			expect(warmAccountA.body.data[0].owner).toBe('A');

			const mutate = await request(url)
				.post('/cache-raw-purge/relational')
				.send({ owner: 'A' })
				.set('Authorization', auth);

			expect(mutate.body).toEqual({ entries: 2 });

			// Mutated owner: fresh MISS reflecting the raw write. The flat-only derivation
			// would tag by the account fk (not account.owner) and leave this a stale HIT.
			const freshEntryA = await readEntries('A');
			expect(freshEntryA.headers[cacheStatusHeader]).toBe('MISS');
			expect(freshEntryA.body.data.every((row) => row.revision === 1)).toBe(true);

			// Collection-wide fallback also drops owner B's entry slice (expected
			// over-purge — the terminal couldn't be resolved from the rows).
			const freshEntryB = await readEntries('B');
			expect(freshEntryB.headers[cacheStatusHeader]).toBe('MISS');

			// A different collection is spared — the fallback is collection-wide, not a
			// namespace flush.
			const hitAccountA = await readAccount('A');
			expect(hitAccountA.headers[cacheStatusHeader]).toBe('HIT');
			expect(hitAccountA.body.data[0].owner).toBe('A');
		});
	});
});
