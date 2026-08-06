import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for the UPDATE-side purge channel (#292): an `items.update`
// hook declares a foreign slice via `context.scopedCache.purgeBy`, reaching a cache
// the framework's own purge never touches.
//
// Updating an `order` should invalidate the owner's cached `summary` (a separate
// collection that aggregates orders). The framework purges the updated order's own
// slice, but nothing reaches the summary. The update hook resolves the updated
// order's owner (from meta.keys) and passes a summary[owner] lookup's returned
// `scopedCacheTags` to `purgeBy`. Since we observe the SUMMARY read, the only thing
// that can drop it is the hook — a clean attribution. Read via `x-cache-status`:
//
//   - updating an owner's order invalidates that owner's summary → MISS.
//   - a sibling owner's summary is untouched → HIT (the owner is resolved per
//     updated row, so it's a precise purge, not a coarse whole-collection one).

const ORDER = 'test_items_order';
const SUMMARY = 'test_items_summary';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	update-hook purgeBy: an update reaches another collection's cached slice, precisely
	for the updated row's owner (#292)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-update-scope-${vendor}`;

		let instance: ChildProcess;
		let acmeOrder: number;
		let globexOrder: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// both collections (+ their `scoped_cache_fields`) on boot. Both partitioned
			// per owner; the update hook bridges order → summary.
			await CreateCollections(vendor, {
				collections: [ORDER, SUMMARY].map((collection) => {
					return {
						collection,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'amount', type: 'string', meta: {} },
						],
					};
				}),
			});

			// Independent seeds → one round-trip. Capture the order PKs to update later.
			const [orders] = await Promise.all([
				CreateItem(vendor, {
					collection: ORDER,
					item: [
						{ owner: 'acme', amount: '5' },
						{ owner: 'globex', amount: '7' },
					],
				}),
				CreateItem(vendor, {
					collection: SUMMARY,
					item: [
						{ owner: 'acme', amount: '100' },
						{ owner: 'globex', amount: '200' },
					],
				}),
			]);

			[acmeOrder, globexOrder] = orders.map(
				(order: { id: number }) => order.id,
			);

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
				DeleteCollection(vendor, { collection: ORDER }),
				DeleteCollection(vendor, { collection: SUMMARY }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSummary(owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${SUMMARY}`)
				.query({ 'filter[owner][_eq]': owner })
				.set('Authorization', auth);
		}

		function updateOrder(id: number, amount: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${ORDER}/${id}`)
				.send({ amount })
				.set('Authorization', auth);
		}

		it(oneLine`
			updating an order invalidates the owner's cached summary via the hook's
			purgeBy, leaving a sibling owner's summary warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both summary slices (independent reads).
			await Promise.all([readSummary('acme'), readSummary('globex')]);

			// Update acme's order: the hook resolves owner=acme and purges summary[acme].
			await updateOrder(acmeOrder, '55');

			const [acme, globex] = await Promise.all([
				readSummary('acme'),
				readSummary('globex'),
			]);

			expect(acme.headers[cacheStatusHeader]).toBe('MISS');
			expect(globex.headers[cacheStatusHeader]).toBe('HIT');

			// Non-vacuity: the summary itself is untouched (an order was updated, not the
			// summary) — only its cache entry was dropped.
			expect(acme.body.data).toHaveLength(1);
		});

		it(oneLine`
			updating a different owner's order purges only that owner's summary — the
			resolution is per-row, not a coarse collection purge
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([readSummary('acme'), readSummary('globex')]);

			// Update globex's order → the hook purges summary[globex] only.
			await updateOrder(globexOrder, '77');

			const [acme, globex] = await Promise.all([
				readSummary('acme'),
				readSummary('globex'),
			]);

			expect(acme.headers[cacheStatusHeader]).toBe('HIT');
			expect(globex.headers[cacheStatusHeader]).toBe('MISS');
			expect(globex.body.data).toHaveLength(1);
		});

		it(oneLine`
			a batch update (array body → updateBatch) still delivers each row's purgeBy:
			both owners' summaries MISS, so the declaration survives the batch path's
			child-suppressed, deferred purge
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([readSummary('acme'), readSummary('globex')]);

			// Array body → updateBatch: each row forks an autoPurgeCache-off child, so a
			// purgeBy lands only via a shared collector threaded through the batch.
			await request(url)
				.patch(`/items/${ORDER}`)
				.send([
					{ id: acmeOrder, amount: '58' },
					{ id: globexOrder, amount: '78' },
				])
				.set('Authorization', auth);

			const [acme, globex] = await Promise.all([
				readSummary('acme'),
				readSummary('globex'),
			]);

			expect(acme.headers[cacheStatusHeader]).toBe('MISS');
			expect(globex.headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
