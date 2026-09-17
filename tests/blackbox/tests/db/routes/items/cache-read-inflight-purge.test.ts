import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// RED until fixed. The read's tags are written to the index only in `respond`, long
// after the rows were fetched, so a purge landing in between finds nothing to drop
// and the entry is filled with rows that were already superseded — stale for its
// whole TTL. The cache-read-inflight-purge extension makes the window deterministic
// by writing from an `items.read` filter, which fires with the rows in hand.

const COLLECTION = 'read_inflight_purge';
const FLUSHED = 'read_inflight_flush';
const BURST = 'read_inflight_burst';
const BURST_WIDTH = 8;
const ANOMALIES = 'directus_cache_stats_anomalies';
const PENDING = 'directus_scoped_cache_pending_purges';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a write that commits while a read is in flight leaves that read cacheable, so the
	next caller is served rows the write already replaced (#428)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-inflight-${vendor}`;

		// The refusal is silent by design, so the operator only ever learns of it
		// through the anomaly it files — which is itself only written with stats on.
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';

		let instance: ChildProcess;
		let db: Knex;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [COLLECTION, FLUSHED, BURST].map((collection) => {
					return {
						collection,
						meta: { scoped_cache_fields: ['slot'] },
						fields: [
							{ field: 'slot', type: 'string', meta: {} },
							{ field: 'label', type: 'string', meta: {} },
						],
					};
				}),
			});

			await Promise.all([
				CreateItem(vendor, {
					collection: COLLECTION,
					item: [{ slot: 'a', label: 'v1' }],
				}),
				CreateItem(vendor, {
					collection: FLUSHED,
					item: [{ slot: 'a', label: 'v1' }],
				}),
				CreateItem(vendor, {
					collection: BURST,
					item: Array.from({ length: BURST_WIDTH }, (_, slot) => {
						return { slot: String(slot), label: 'v1' };
					}),
				}),
			]);

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			db = knex(config.knexConfig[vendor]!);

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance?.kill();

			await db.destroy();
			await DeleteCollection(vendor, { collection: COLLECTION });
			await DeleteCollection(vendor, { collection: FLUSHED });
			await DeleteCollection(vendor, { collection: BURST });
		});

		function readSlotAOf(collection: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[slot][_eq]': 'a' })
				.set('Authorization', auth);
		}

		function readSlotA() {
			return readSlotAOf(COLLECTION);
		}

		it(oneLine`
			refuses to cache a read the in-flight write already invalidated, so the
			next read reflects that write
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Carries the pre-write rows by construction: the hook runs after the
			// fetch, so this body is allowed to be `v1` — it just must not be stored.
			const warm = await readSlotA();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			const after = await readSlotA();

			// RED until fixed: the fill landed after the purge and survived it.
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data[0].label).toBe('v2');
		});

		it(oneLine`
			files the refusal as an anomaly naming the collection whose counter moved,
			so a read that never caches is visible rather than only slow
		`, async () => {
			await readSlotA();

			// The stats stream drains on a ten-second cron, so the row lands some
			// ticks after the request that refused.
			for (let attempt = 0; attempt < 40; attempt++) {
				// Filtered on the detail too, not just the reason: the table is shared
				// by every instance on this database and never truncated, and the query
				// is unordered — so `rows[0]` of a reason alone is whichever row the
				// planner hands back first, this spec's or a neighbour's.
				const rows = await db(ANOMALIES)
					.where({ reason: 'inflight_purge', detail: COLLECTION })
					.select('id');

				if (rows.length > 0) {
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			throw new Error('no inflight_purge anomaly was recorded');
		}, 60_000);

		it(oneLine`
			refuses to cache a read a whole-cache flush crossed, which drops the tag
			sets a write's purge would have found
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// The flush the hook raises runs while this read holds its rows and before
			// `respond` files its tags, so there is no tag set for it to drop — only
			// the wholesale counter it moves on the way says the read was crossed.
			const warm = await readSlotAOf(FLUSHED);
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			const after = await readSlotAOf(FLUSHED);

			// Storing the first read would leave it reachable to no later purge: the
			// index it would have been filed under was deleted mid-flight.
			expect(after.headers[cacheStatusHeader]).toBe('MISS');

			// The hook is one-shot, so nothing crosses this one and it caches
			// normally — which is what separates the refusal above from a collection
			// that simply never caches.
			expect((await readSlotAOf(FLUSHED)).headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		// A regression net rather than a witness: the race is between two evictions
		// probing the store within one round trip of each other, and eight reads
		// crossed at once only make it likely. The deterministic case is the unit
		// test on `cacheStoreDropsEntries`.
		it(oneLine`
			a burst of crossed reads leaves nothing recorded for retry — every eviction
			took, and none read a neighbour's probe as a store that swallows (#507)
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await db(PENDING)
				.where({ collection: BURST })
				.delete();

			const crossed = await Promise.all(
				Array.from({ length: BURST_WIDTH }, (_, slot) => {
					return request(getUrl(vendor, env))
						.get(`/items/${BURST}`)
						.query({ 'filter[slot][_eq]': String(slot) })
						.set('Authorization', auth);
				}),
			);

			for (const read of crossed) {
				expect(read.headers[cacheStatusHeader]).toBe('MISS');
			}

			// One refusal per read says every fill was crossed and evicted — the
			// probes ran — before the table is read as proof none of them was fooled.
			for (let attempt = 0; attempt < 40; attempt++) {
				const refused = await db(ANOMALIES)
					.where({ reason: 'inflight_purge', detail: BURST })
					.select('id');

				if (refused.length >= BURST_WIDTH) {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			expect(
				await db(ANOMALIES)
					.where({ reason: 'inflight_purge', detail: BURST })
					.select('id'),
			).toHaveLength(BURST_WIDTH);

			const recorded = await db(PENDING)
				.where({ collection: BURST })
				.select('id');

			expect(recorded).toEqual([]);
		}, 60_000);
	});
});
