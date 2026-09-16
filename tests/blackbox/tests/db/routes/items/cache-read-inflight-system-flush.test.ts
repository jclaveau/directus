import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	CreateRole,
	CreateUser,
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

// RED until fixed. `/utils/cache/clear` bumps the wholesale purge counter before it
// clears, so a read crossing it declines to store itself. The flushes the system
// services run on their own — a permission, policy, role, access or user change, a
// field or collection edit, a manual sort, the GraphQL `utils_cache_clear` — call
// `cache.clear()` directly and move no counter, so a read crossing one of them
// compares equal and caches rows the change already superseded. The
// cache-read-inflight-system-flush extension makes each window deterministic by
// making the write from an `items.read` filter, which fires with the rows in hand.

const COLLECTION = 'read_inflight_system_flush';
const cacheStatusHeader = 'x-cache-status';

// Every write the extension knows, keyed by the slot whose read races it.
const SLOTS = [
	'permission',
	'policy',
	'role',
	'access',
	'user',
	'field',
	'collection',
	'sort',
	'graphql',
] as const;

describe(oneLine`
	a system-service flush that lands while a read is in flight leaves that read
	cacheable, so the next caller is served rows the change already replaced (#438)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-inflight-system-${vendor}`;

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		let policyId: string;
		let roleId: string;
		let userId: string;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: COLLECTION,
						meta: { scoped_cache_fields: ['slot'], sort_field: 'sort' },
						fields: [
							{ field: 'slot', type: 'string', meta: {} },
							{ field: 'target', type: 'string', meta: {} },
							{ field: 'sort', type: 'integer', meta: {} },
						],
					},
				],
			});

			// What each write needs, made BEFORE any read is in flight so the only
			// flush a raced read crosses is the one its own slot makes.
			const policy = await request(getUrl(vendor))
				.post('/policies')
				.set('Authorization', auth)
				.send({ name: `inflight-system-flush-${vendor}` });

			policyId = policy.body.data.id;

			const role = await CreateRole(vendor, {
				name: `inflight-system-flush-${vendor}`,
			});

			roleId = role.id;

			userId = (
				await CreateUser(vendor, {
					token: `inflight-system-flush-${vendor}`,
					email: `inflight-system-flush-${vendor}@tests.com`,
					role: roleId,
				})
			).id;

			await CreateItem(vendor, {
				collection: COLLECTION,
				item: [
					{ slot: 'permission', target: policyId, sort: 1 },
					{ slot: 'policy', target: policyId, sort: 2 },
					{ slot: 'role', target: roleId, sort: 3 },
					{ slot: 'access', target: `${roleId}/${policyId}`, sort: 4 },
					{ slot: 'user', target: userId, sort: 5 },
					{ slot: 'field', target: null, sort: 6 },
					{ slot: 'collection', target: null, sort: 7 },
					{ slot: 'sort', target: null, sort: 8 },
					{ slot: 'sort', target: null, sort: 9 },
					{ slot: 'graphql', target: null, sort: 10 },
				],
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

			await DeleteCollection(vendor, { collection: COLLECTION });

			for (const path of [
				`/users/${userId}`,
				`/roles/${roleId}`,
				`/policies/${policyId}`,
			]) {
				await request(getUrl(vendor))
					.delete(path)
					.set('Authorization', auth);
			}
		});

		function readSlot(slot: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${COLLECTION}`)
				.query({ 'filter[slot][_eq]': slot, fields: ['id', 'slot'] })
				.set('Authorization', auth);
		}

		it.each(SLOTS)(
			'refuses to cache a read the in-flight %s flush crossed',
			async (slot) => {
				await request(getUrl(vendor, env))
					.post('/utils/cache/clear')
					.set('Authorization', auth);

				// The write the hook makes runs while this read holds its rows and
				// before `respond` files its tags; the flush it ends in finds nothing
				// to drop, so only a moved counter can say the read was crossed.
				const warm = await readSlot(slot);
				expect(warm.status).toBe(200);
				expect(warm.headers[cacheStatusHeader]).toBe('MISS');

				const after = await readSlot(slot);

				// RED until fixed: the fill landed after the flush and survived it.
				expect(after.headers[cacheStatusHeader]).toBe('MISS');

				// The hook is one-shot per slot, so nothing crosses this one and it
				// caches normally — which is what separates the refusal above from a
				// collection that simply never caches.
				expect((await readSlot(slot)).headers[cacheStatusHeader]).toBe('HIT');
			},
			60_000,
		);
	});
});
