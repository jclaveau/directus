import { oneLine } from '@directus/utils';
import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import type { Knex } from 'knex';
import knex from 'knex';
import { cloneDeep } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
	collectionBlock,
	collectionChild,
	collectionFirst,
	collectionGrandChild,
	collectionGrandRelated,
	collectionIgnored,
	collectionRelated,
	collectionScoped,
	collectionScopedMulti,
	collectionMember,
	collectionOwnedSubItem,
	collectionOwnedItem,
	collectionTeam,
	collectionScopedRel,
	collectionTag,
	scopedOwnerA,
	scopedOwnerB,
	seedDBValues,
} from './cache.seed';

let isSeeded = false;

beforeAll(async () => {
	isSeeded = await seedDBValues();
}, 300_000);

test('Seed Database Values', () => {
	expect(isSeeded).toStrictEqual(true);
});

describe('App Caching Tests', () => {
	const databases = new Map<string, Knex>();
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };
	const envKeys = ['envMem', 'envMemPurge', 'envRedis', 'envRedisPurge', 'envRedisScopedPurge'] as const;
	type EnvTypes = Record<(typeof envKeys)[number], Env>;
	const envs = {} as Record<Vendor, EnvTypes>;
	const cacheNamespacePrefix = 'directus-app-cache';
	const cacheStatusHeader = 'x-cache-status';
	const tagsHeader = 'x-scoped-cache-tags';
	const purgedTagsHeader = 'x-scoped-cache-purged-tags';
	const publicURL = 'http://example.com';

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			databases.set(vendor, knex(config.knexConfig[vendor]!));

			// The Redis instance (localhost:6108) is shared across vendors, so the cache
			// namespace — and thus the stats stream/flag/tables keyed off it — must carry
			// the vendor, or one vendor's flush drains another's events and a stats toggle
			// on one disables capture on the others.
			const vendorPrefix = `${cacheNamespacePrefix}-${vendor}`;

			const envMem = cloneDeep(config.envs);
			envMem[vendor]['PUBLIC_URL'] = publicURL;
			envMem[vendor]['CACHE_ENABLED'] = 'true';
			envMem[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			envMem[vendor]['CACHE_AUTO_PURGE'] = 'false';
			envMem[vendor]['CACHE_AUTO_PURGE_IGNORE_LIST'] = `directus_activity,directus_presets,${collectionIgnored}`;
			envMem[vendor]['CACHE_STORE'] = 'memory';
			envMem[vendor]['CACHE_NAMESPACE'] = `${vendorPrefix}_mem`;

			const envMemPurge = cloneDeep(envMem);
			envMemPurge[vendor]['CACHE_AUTO_PURGE'] = 'true';
			envMemPurge[vendor]['CACHE_NAMESPACE'] = `${vendorPrefix}_mem_purge`;

			const envRedis = cloneDeep(envMem);
			envRedis[vendor]['CACHE_STORE'] = 'redis';
			envRedis[vendor]['REDIS_HOST'] = 'localhost';
			envRedis[vendor]['REDIS_PORT'] = '6108';
			envRedis[vendor]['CACHE_NAMESPACE'] = `${vendorPrefix}_redis`;
			// Stats are opt-in — enable so the registry/stats endpoints are live.
			envRedis[vendor]['CACHE_STATS_ENABLED'] = 'true';

			const envRedisPurge = cloneDeep(envRedis);
			envRedisPurge[vendor]['CACHE_AUTO_PURGE'] = 'true';
			// scoped is the default now, so pin full explicitly to keep covering whole-namespace purge.
			envRedisPurge[vendor]['CACHE_AUTO_PURGE_MODE'] = 'full';
			envRedisPurge[vendor]['CACHE_NAMESPACE'] = `${vendorPrefix}_redis_purge`;

			// Auto-purge with scoped (tag-based) invalidation: a mutation drops only the cache entries
			// that read the mutated collection, leaving other collections warm.
			const envRedisScopedPurge = cloneDeep(envRedisPurge);
			envRedisScopedPurge[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
			envRedisScopedPurge[vendor]['CACHE_NAMESPACE'] = `${vendorPrefix}_redis_scoped`;

			const scopedEnv = envRedisScopedPurge[vendor];
			scopedEnv['CACHE_TAGS_HEADER'] = tagsHeader;
			scopedEnv['CACHE_PURGED_TAGS_HEADER'] = purgedTagsHeader;

			const newServerPortMem = await getPort();
			const newServerPortMemPurge = await getPort();
			const newServerPortRedis = await getPort();
			const newServerPortRedisPurge = await getPort();
			const newServerPortRedisScopedPurge = await getPort();

			envMem[vendor].PORT = String(newServerPortMem);
			envMemPurge[vendor].PORT = String(newServerPortMemPurge);
			envRedis[vendor].PORT = String(newServerPortRedis);
			envRedisPurge[vendor].PORT = String(newServerPortRedisPurge);
			envRedisScopedPurge[vendor].PORT = String(newServerPortRedisScopedPurge);

			const serverMem = spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: envMem[vendor] });
			const serverMemPurge = spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: envMemPurge[vendor] });
			const serverRedis = spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: envRedis[vendor] });
			const serverRedisPurge = spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: envRedisPurge[vendor] });

			const serverRedisScopedPurge = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: envRedisScopedPurge[vendor],
			});

			directusInstances[vendor] = [serverMem, serverMemPurge, serverRedis, serverRedisPurge, serverRedisScopedPurge];
			envs[vendor] = { envMem, envMemPurge, envRedis, envRedisPurge, envRedisScopedPurge };

			promises.push(
				awaitDirectusConnection(newServerPortMem),
				awaitDirectusConnection(newServerPortMemPurge),
				awaitDirectusConnection(newServerPortRedis),
				awaitDirectusConnection(newServerPortRedisPurge),
				awaitDirectusConnection(newServerPortRedisScopedPurge),
			);
		}

		// Give the server some time to start
		await Promise.all(promises);
	}, 180_000);

	afterAll(async () => {
		for (const [vendor, connection] of databases) {
			for (const instance of directusInstances[vendor]!) {
				instance.kill();
			}

			await connection.destroy();
		}
	});

	describe('Does not purge cache browsing app without Referer header', () => {
		describe.each(envKeys)('%s', (key) => {
			describe.each([collectionFirst, collectionIgnored])('%s', (collection) => {
				it.each(vendors)('%s', async (vendor) => {
					// Setup
					const env = envs[vendor][key];

					await request(getUrl(vendor, env))
						.post(`/utils/cache/clear`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Action
					await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					await request(getUrl(vendor, env))
						.patch('/users/me/track/page')
						.send({ last_page: `/content/${collection}` })
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const presetId = (
						await request(getUrl(vendor, env))
							.post('/presets')
							.send({
								collection,
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
					).body.data.id;

					await request(getUrl(vendor, env))
						.patch(`/presets/${presetId}`)
						.send({
							collection,
						})
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const response = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Assert
					expect(response.statusCode).toBe(200);
					expect(response.headers[cacheStatusHeader]).toBe('HIT');
				});
			});
		});
	});

	describe('Does not purge cache when browsing app with Referer header', () => {
		describe.each(envKeys)('%s', (key) => {
			describe.each([collectionFirst, collectionIgnored])('%s', (collection) => {
				it.each(vendors)('%s', async (vendor) => {
					// Setup
					const env = envs[vendor][key];
					const referer = `${publicURL}/admin/content/${collection}/`;

					await request(getUrl(vendor, env))
						.post(`/utils/cache/clear`)
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Action
					await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					await request(getUrl(vendor, env))
						.patch('/users/me/track/page')
						.send({ last_page: `/content/${collection}` })
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const presetId = (
						await request(getUrl(vendor, env))
							.post('/presets')
							.send({
								collection,
							})
							.set('Referer', referer)
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
					).body.data.id;

					await request(getUrl(vendor, env))
						.patch(`/presets/${presetId}`)
						.send({
							collection,
						})
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const response = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Assert
					if (collection === collectionFirst) {
						const expectedCacheStatus = key.endsWith('Purge')
							? 'HIT'
							: 'MISS';

						expect(response.statusCode).toBe(200);
						expect(response.headers[cacheStatusHeader]).toBe(expectedCacheStatus);
					}
					else {
						expect(response.statusCode).toBe(200);
						expect(response.headers[cacheStatusHeader]).toBe('MISS');
					}
				});
			});
		});
	});

	describe('Purges cache when item is mutated', () => {
		describe.each(envKeys)('%s', (key) => {
			describe.each([collectionFirst, collectionIgnored])('%s', (collection) => {
				it.each(vendors)('%s', async (vendor) => {
					// Setup
					const env = envs[vendor][key];

					await request(getUrl(vendor, env))
						.post(`/utils/cache/clear`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Action
					await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					await request(getUrl(vendor, env))
						.post(`/items/${collection}`)
						.send({ string_field: randomUUID() })
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const response = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Assert
					if (collection === collectionFirst) {
						const expectedCacheStatus = key.endsWith('Purge')
							? 'MISS'
							: 'HIT';

						expect(response.statusCode).toBe(200);
						expect(response.headers[cacheStatusHeader]).toBe(expectedCacheStatus);
					}
					else {
						expect(response.statusCode).toBe(200);
						expect(response.headers[cacheStatusHeader]).toBe('HIT');
					}
				});
			});
		});
	});

	describe('Purges cache when item is mutated with Referer header', () => {
		describe.each(envKeys)('%s', (key) => {
			describe.each([collectionFirst, collectionIgnored])('%s', (collection) => {
				it.each(vendors)('%s', async (vendor) => {
					// Setup
					const env = envs[vendor][key];
					const referer = `${publicURL}/admin/content/${collection}/`;

					await request(getUrl(vendor, env))
						.post(`/utils/cache/clear`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Action
					await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					await request(getUrl(vendor, env))
						.post(`/items/${collection}`)
						.send({ string_field: randomUUID() })
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const response = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Assert
					expect(response.statusCode).toBe(200);
					expect(response.headers[cacheStatusHeader]).toBe('MISS');
				});
			});
		});
	});

	describe('Purges cache when item is mutated with an external Referer header', () => {
		describe.each(envKeys)('%s', (key) => {
			describe.each([collectionFirst, collectionIgnored])('%s', (collection) => {
				it.each(vendors)('%s', async (vendor) => {
					// Setup
					const env = envs[vendor][key];
					const referer = `http://external.com/admin/content/${collection}`;

					await request(getUrl(vendor, env))
						.post(`/utils/cache/clear`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Action
					await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					await request(getUrl(vendor, env))
						.post(`/items/${collection}`)
						.send({ string_field: randomUUID() })
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const response = await request(getUrl(vendor, env))
						.get(`/items/${collection}`)
						.set('Referer', referer)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Assert
					if (collection === collectionFirst) {
						const expectedCacheStatus = key.endsWith('Purge')
							? 'MISS'
							: 'HIT';

						expect(response.statusCode).toBe(200);
						expect(response.headers[cacheStatusHeader]).toBe(expectedCacheStatus);
					}
					else {
						expect(response.statusCode).toBe(200);
						expect(response.headers[cacheStatusHeader]).toBe('HIT');
					}
				});
			});
		});
	});

	describe('Scoped purge isolates the mutated collection from other collections', () => {
		it.each(vendors)('%s', async (vendor) => {
			// Setup
			const env = envs[vendor].envRedisScopedPurge;

			await request(getUrl(vendor, env)).post(`/utils/cache/clear`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Warm both collections
			await request(getUrl(vendor, env))
				.get(`/items/${collectionFirst}`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			await request(getUrl(vendor, env))
				.get(`/items/${collectionIgnored}`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Action: mutate only collectionFirst
			await request(getUrl(vendor, env))
				.post(`/items/${collectionFirst}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			const mutated = await request(getUrl(vendor, env))
				.get(`/items/${collectionFirst}`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			const untouched = await request(getUrl(vendor, env))
				.get(`/items/${collectionIgnored}`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// Assert: the mutated collection's cache is dropped, the other survives. Under full
			// auto-purge `untouched` would be MISS (whole-namespace flush); scoped keeps it warm.
			expect(mutated.statusCode).toBe(200);
			expect(mutated.headers[cacheStatusHeader]).toBe('MISS');
			expect(untouched.statusCode).toBe(200);
			expect(untouched.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		Scoped purge invalidates a pure-aggregate (count) read of the mutated collection —
		an empty field map still yields the bare collection tag
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			await request(url)
				.post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// Warm the aggregate reads. A `count(*)` names no field, so the read's field map has
			// only the root collection (no value slice to pin) — it must fall back to the bare
			// collection tag, or a later write leaves a stale HIT.
			await request(url)
				.get(`/items/${collectionFirst}`)
				.query({ 'aggregate[count]': '*' })
				.set('Authorization', auth);

			await request(url)
				.get(`/items/${collectionIgnored}`)
				.query({ 'aggregate[count]': '*' })
				.set('Authorization', auth);

			// Non-vacuity: the aggregate response is genuinely cached, so a re-read HITs.
			const warm = await request(url)
				.get(`/items/${collectionFirst}`)
				.query({ 'aggregate[count]': '*' })
				.set('Authorization', auth);

			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Mutate the aggregated collection.
			await request(url)
				.post(`/items/${collectionFirst}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			// The bare collection tag must have been applied → the write drops the aggregate.
			const invalidated = await request(url)
				.get(`/items/${collectionFirst}`)
				.query({ 'aggregate[count]': '*' })
				.set('Authorization', auth);

			// Witness: an untouched collection's aggregate survives (scoped, not a global flush).
			const witness = await request(url)
				.get(`/items/${collectionIgnored}`)
				.query({ 'aggregate[count]': '*' })
				.set('Authorization', auth);

			expect(invalidated.statusCode).toBe(200);
			expect(invalidated.headers[cacheStatusHeader]).toBe('MISS');
			expect(witness.statusCode).toBe(200);
			expect(witness.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		Scoped purge invalidates a read joining a related (m2o) collection when that related
		row is mutated
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			// A related row + a first row pointing at it.
			const related = (
				await request(url)
					.post(`/items/${collectionRelated}`)
					.send({ string_field: randomUUID() })
					.set('Authorization', auth)
			).body.data;

			await request(url)
				.post(`/items/${collectionFirst}`)
				.send({ string_field: randomUUID(), related: related.id })
				.set('Authorization', auth);

			// A read that joins the related collection — tagged under both collections.
			const read = `/items/${collectionFirst}?fields=*,related.*`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Mutate ONLY the related row — collectionFirst is untouched, yet the join read
			// must drop.
			await request(url)
				.patch(`/items/${collectionRelated}/${related.id}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			const afterRelatedWrite = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterRelatedWrite.statusCode).toBe(200);
			expect(afterRelatedWrite.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Scoped purge invalidates a read nested two relations deep (related.grand) when the
		leaf collection is mutated
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			// Build the chain leaf → up: grand ← related ← first.
			const grand = (
				await request(url)
					.post(`/items/${collectionGrandRelated}`)
					.send({ string_field: randomUUID() })
					.set('Authorization', auth)
			).body.data;

			const related = (
				await request(url)
					.post(`/items/${collectionRelated}`)
					.send({ string_field: randomUUID(), grand: grand.id })
					.set('Authorization', auth)
			).body.data;

			await request(url)
				.post(`/items/${collectionFirst}`)
				.send({ string_field: randomUUID(), related: related.id })
				.set('Authorization', auth);

			// A read two relations deep — the AST tags first, related AND grand.
			const read = `/items/${collectionFirst}?fields=*,related.grand.*`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Mutate ONLY the leaf, two hops down; first + related untouched, yet the nested
			// read must drop.
			await request(url)
				.patch(`/items/${collectionGrandRelated}/${grand.id}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			const afterGrandWrite = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterGrandWrite.statusCode).toBe(200);
			expect(afterGrandWrite.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	// o2m / m2m / m2a: a read that joins the target collection is tagged with it (from the
	// query AST, regardless of whether any rows are linked), so a write to that target
	// collection must drop the cached read. The deep field paths embed the target's own
	// data (`tags.<fk>.*`, `blocks.item:<col>.*`).
	describe.each([
		{
			relation: 'o2m',
			read: `/items/${collectionFirst}?fields=*,children.*`,
			target: collectionChild,
		},
		{
			relation: 'm2m',
			read: `/items/${collectionFirst}?fields=*,tags.${collectionTag}_id.*`,
			target: collectionTag,
		},
		{
			relation: 'm2a',
			read: `/items/${collectionFirst}?fields=*,blocks.item:${collectionBlock}.*`,
			target: collectionBlock,
		},
	])(oneLine`
		Scoped purge invalidates a $relation join read when its target collection is mutated
	`, ({ read, target }) => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// A write to the joined target collection — the join read is tagged with it, so
			// it must drop.
			await request(url).post(`/items/${target}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			const after = await request(url).get(read)
				.set('Authorization', auth);

			expect(after.statusCode).toBe(200);
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	// Depth-2 chains, one per first-hop relation type, ending on a second-hop leaf (grandRelated
	// via m2o, grandChild via o2m). The read tags the whole path from the AST, so a write to the
	// leaf — two relations down — must drop the cached read even though nothing is linked.
	describe.each([
		{
			chain: 'm2o→o2m',
			read: `/items/${collectionFirst}?fields=*,related.subs.*`,
			target: collectionGrandChild,
		},
		{
			chain: 'o2m→o2m',
			read: `/items/${collectionFirst}?fields=*,children.subChildren.*`,
			target: collectionGrandChild,
		},
		{
			chain: 'o2m→m2o',
			read: `/items/${collectionFirst}?fields=*,children.owner.*`,
			target: collectionGrandRelated,
		},
		{
			chain: 'm2m→m2o',
			read: `/items/${collectionFirst}?fields=*,tags.${collectionTag}_id.category.*`,
			target: collectionGrandRelated,
		},
		{
			chain: 'm2a→m2o',
			read: `/items/${collectionFirst}?fields=*,blocks.item:${collectionBlock}.author.*`,
			target: collectionGrandRelated,
		},
	])(oneLine`
		Scoped purge invalidates a $chain nested read when its second-hop leaf collection is
		mutated
	`, ({ read, target }) => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// A write to the leaf two hops down — the read is tagged with it, so it must drop.
			await request(url).post(`/items/${target}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			const after = await request(url).get(read)
				.set('Authorization', auth);

			expect(after.statusCode).toBe(200);
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Scoped purge invalidates a read filtered by a relational path when that related
		collection is mutated
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			// `related` is used only in the filter (not selected) — the read still gets
			// tagged with it, because its result set depends on collectionRelated.
			const relatedFilter = `filter[related][string_field][_eq]=${randomUUID()}`;
			const read = `/items/${collectionFirst}?fields=id&${relatedFilter}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// A write to the filtered-on collection must drop the read.
			await request(url)
				.post(`/items/${collectionRelated}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			const after = await request(url).get(read)
				.set('Authorization', auth);

			expect(after.statusCode).toBe(200);
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Value-scoped purge isolates one owner slice — a write to owner A drops A's read but
		spares owner B's
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const readA = `/items/${collectionScoped}?filter[owner_field][_eq]=${scopedOwnerA}`;
			const readB = `/items/${collectionScoped}?filter[owner_field][_eq]=${scopedOwnerB}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// Warm both owner slices.
			await request(url).get(readA)
				.set('Authorization', auth);

			await request(url).get(readB)
				.set('Authorization', auth);

			const warmA = await request(url).get(readA)
				.set('Authorization', auth);

			const warmB = await request(url).get(readB)
				.set('Authorization', auth);

			expect(warmA.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmB.headers[cacheStatusHeader]).toBe('HIT');

			// Mutate owner A only.
			await request(url)
				.post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: scopedOwnerA })
				.set('Authorization', auth);

			const afterA = await request(url).get(readA)
				.set('Authorization', auth);

			const afterB = await request(url).get(readB)
				.set('Authorization', auth);

			// A's slice drops; B's is untouched.
			expect(afterA.statusCode).toBe(200);
			expect(afterA.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterB.statusCode).toBe(200);
			expect(afterB.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		Dev headers expose scope tags: a scoped read emits the slice on MISS+HIT, a
		scoped write emits the purged slice
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const readA = `/items/${collectionScoped}`
				+ `?filter[owner_field][_eq]=${scopedOwnerA}`;

			const slice = `${collectionScoped}:owner_field=${scopedOwnerA}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// A MISS read pins the owner slice into the header.
			const miss = await request(url).get(readA)
				.set('Authorization', auth);

			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(miss.headers[tagsHeader]).toContain(slice);

			// A HIT re-emits it from the `__tags` sibling (the read is skipped).
			const hit = await request(url).get(readA)
				.set('Authorization', auth);

			expect(hit.headers[cacheStatusHeader]).toBe('HIT');
			expect(hit.headers[tagsHeader]).toContain(slice);

			// A write to owner A emits the purged slice.
			const write = await request(url)
				.post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: scopedOwnerA })
				.set('Authorization', auth);

			expect(write.headers[purgedTagsHeader]).toContain(slice);
		});
	});

	describe(oneLine`
		An _or query filter binding the owner in every branch pins the UNION of the slices —
		a write to either owner purges the read, an owner outside the union spares it
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const read = `/items/${collectionScoped}`
				+ `?filter[_or][0][owner_field][_eq]=${scopedOwnerA}`
				+ `&filter[_or][1][owner_field][_eq]=${scopedOwnerB}`;

			const outsideOwner = randomUUID(); // a third owner, outside { A, B }

			const warmUp = async () => {
				await request(url).post(`/utils/cache/clear`)
					.set('Authorization', auth);

				await request(url).get(read)
					.set('Authorization', auth); // cold → cached, pinned to { A, B }

				const warm = await request(url).get(read)
					.set('Authorization', auth);

				expect(warm.headers[cacheStatusHeader]).toBe('HIT');
			};

			const writeOwner = async (owner: string) => {
				await request(url).post(`/items/${collectionScoped}`)
					.send({ string_field: randomUUID(), owner_field: owner })
					.set('Authorization', auth);

				return request(url).get(read)
					.set('Authorization', auth);
			};

			// An owner outside the union spares the read — the union pin, not bare.
			await warmUp();
			const afterOutside = await writeOwner(outsideOwner);
			expect(afterOutside.statusCode).toBe(200);
			expect(afterOutside.headers[cacheStatusHeader]).toBe('HIT');

			// Each union member purges it.
			await warmUp();
			expect((await writeOwner(scopedOwnerA)).headers[cacheStatusHeader]).toBe('MISS');

			await warmUp();
			expect((await writeOwner(scopedOwnerB)).headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Value-scoped self-referential read is not owner-pinned — a write to another
		owner still invalidates it (the nested same-collection rows are unbounded)
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			// Owner-A rows plus each row's `parent` — which may belong to ANY owner, so the
			// filter doesn't bound the read. Reaches collectionScoped again through `parent.*`.
			const scopedItems = `/items/${collectionScoped}`;
			const ownerAFilter = `filter[owner_field][_eq]=${scopedOwnerA}`;
			const read = `${scopedItems}?${ownerAFilter}&fields=*,parent.*`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Mutate a DIFFERENT owner (B). An owner-A-pinned read would wrongly survive; the
			// self-reference guard tags this read bare, so it must drop.
			await request(url)
				.post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: scopedOwnerB })
				.set('Authorization', auth);

			const after = await request(url).get(read)
				.set('Authorization', auth);

			expect(after.statusCode).toBe(200);
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Value-scoped create resolves the DB-stored slice — a create omitting the scope field
		lands in another slice, sparing a pinned read
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			// A pinned owner-A read, an unfiltered (bare-tagged) read of the same collection,
			// and a read of another collection.
			const readA = `/items/${collectionScoped}?filter[owner_field][_eq]=${scopedOwnerA}`;
			const readBare = `/items/${collectionScoped}`;
			const otherRead = `/items/${collectionIgnored}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(readA)
				.set('Authorization', auth);

			await request(url).get(readBare)
				.set('Authorization', auth);

			await request(url).get(otherRead)
				.set('Authorization', auth);

			const warmA = await request(url).get(readA)
				.set('Authorization', auth);

			const warmBare = await request(url).get(readBare)
				.set('Authorization', auth);

			const warmOther = await request(url).get(otherRead)
				.set('Authorization', auth);

			expect(warmA.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmBare.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmOther.headers[cacheStatusHeader]).toBe('HIT');

			// Create a row that OMITS owner_field — it lands in the null slice, NOT A. The
			// purge re-reads the row's stored value and drops only that slice (+ bare), so the
			// pinned owner-A read survives. A coarse collection-wide fallback would have
			// dropped it.
			await request(url)
				.post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			const afterA = await request(url).get(readA)
				.set('Authorization', auth);

			const afterBare = await request(url).get(readBare)
				.set('Authorization', auth);

			const afterOther = await request(url).get(otherRead)
				.set('Authorization', auth);

			// A's slice is spared (precise null-slice purge, not collection-wide); the other
			// collection stays warm too. The bare read drops — witness that the create purged at
			// all (bare is always purged), so A's survival isn't a vacuous no-op.
			expect(afterA.statusCode).toBe(200);
			expect(afterA.headers[cacheStatusHeader]).toBe('HIT');
			expect(afterBare.statusCode).toBe(200);
			expect(afterBare.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterOther.statusCode).toBe(200);
			expect(afterOther.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		Value-scoped update moving a row across slices drops both the old and the new slice
		(old ∪ new capture), sparing an untouched third slice
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const srcOwner = 'owner-move-src';
			const dstOwner = 'owner-move-dst';
			const ctlOwner = 'owner-move-ctl';

			const readSrc = `/items/${collectionScoped}?filter[owner_field][_eq]=${srcOwner}`;
			const readDst = `/items/${collectionScoped}?filter[owner_field][_eq]=${dstOwner}`;
			const readCtl = `/items/${collectionScoped}?filter[owner_field][_eq]=${ctlOwner}`;
			const otherRead = `/items/${collectionIgnored}`;

			// A row in the source slice; the destination and control slices stay empty.
			const moved = (
				await request(url)
					.post(`/items/${collectionScoped}`)
					.send({ string_field: randomUUID(), owner_field: srcOwner })
					.set('Authorization', auth)
			).body.data;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			for (const read of [readSrc, readDst, readCtl, otherRead]) {
				await request(url).get(read)
					.set('Authorization', auth); // cold → cached
			}

			const warmSrc = await request(url).get(readSrc)
				.set('Authorization', auth);

			const warmDst = await request(url).get(readDst)
				.set('Authorization', auth);

			const warmCtl = await request(url).get(readCtl)
				.set('Authorization', auth);

			const warmOther = await request(url).get(otherRead)
				.set('Authorization', auth);

			expect(warmSrc.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmDst.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmCtl.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmOther.headers[cacheStatusHeader]).toBe('HIT');

			// Move the row src → dst. The pre-update capture holds src, the committed re-read
			// holds dst; their union purges both slices (+ bare), leaving the control slice — and
			// every other collection — warm.
			await request(url)
				.patch(`/items/${collectionScoped}/${moved.id}`)
				.send({ owner_field: dstOwner })
				.set('Authorization', auth);

			const afterSrc = await request(url).get(readSrc)
				.set('Authorization', auth);

			const afterDst = await request(url).get(readDst)
				.set('Authorization', auth);

			const afterCtl = await request(url).get(readCtl)
				.set('Authorization', auth);

			const afterOther = await request(url).get(otherRead)
				.set('Authorization', auth);

			// Old slice drops (the row left it), new slice drops (the row arrived); the control
			// slice and the other collection are spared (no leak past the mutated slices).
			expect(afterSrc.statusCode).toBe(200);
			expect(afterSrc.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterDst.statusCode).toBe(200);
			expect(afterDst.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterCtl.statusCode).toBe(200);
			expect(afterCtl.headers[cacheStatusHeader]).toBe('HIT');
			expect(afterOther.statusCode).toBe(200);
			expect(afterOther.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		Value-scoped delete drops the removed row's slice (captured pre-delete) but spares
		an untouched slice
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const delOwner = 'owner-del';
			const ctlOwner = 'owner-del-ctl';

			const readDel = `/items/${collectionScoped}?filter[owner_field][_eq]=${delOwner}`;
			const readCtl = `/items/${collectionScoped}?filter[owner_field][_eq]=${ctlOwner}`;
			const otherRead = `/items/${collectionIgnored}`;

			const doomed = (
				await request(url)
					.post(`/items/${collectionScoped}`)
					.send({ string_field: randomUUID(), owner_field: delOwner })
					.set('Authorization', auth)
			).body.data;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(readDel)
				.set('Authorization', auth);

			await request(url).get(readCtl)
				.set('Authorization', auth);

			await request(url).get(otherRead)
				.set('Authorization', auth);

			const warmDel = await request(url).get(readDel)
				.set('Authorization', auth);

			const warmCtl = await request(url).get(readCtl)
				.set('Authorization', auth);

			const warmOther = await request(url).get(otherRead)
				.set('Authorization', auth);

			expect(warmDel.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmCtl.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmOther.headers[cacheStatusHeader]).toBe('HIT');

			// After the delete the row's scope value is gone, so it's captured before the delete.
			await request(url)
				.delete(`/items/${collectionScoped}/${doomed.id}`)
				.set('Authorization', auth);

			const afterDel = await request(url).get(readDel)
				.set('Authorization', auth);

			const afterCtl = await request(url).get(readCtl)
				.set('Authorization', auth);

			const afterOther = await request(url).get(otherRead)
				.set('Authorization', auth);

			// The deleted row's slice drops; the untouched slice and the other collection stay warm.
			expect(afterDel.statusCode).toBe(200);
			expect(afterDel.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterCtl.statusCode).toBe(200);
			expect(afterCtl.headers[cacheStatusHeader]).toBe('HIT');
			expect(afterOther.statusCode).toBe(200);
			expect(afterOther.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		$CURRENT_USER-filtered scoped read pins the resolved user id, not the
		literal token — sanitizeQuery substitutes it before the read, so the
		owner's own write purges the read
	`, () => {
		// Regression guard: the read-side pin consumes updatedQuery.filter, which looks like it
		// could still hold the literal '$CURRENT_USER'. It doesn't — sanitizeQuery (REST middleware
		// + GraphQL parse-query) resolves the dynamic var to the concrete user id before the service
		// runs, so the scope tag is owner_field=<uuid>, matching what a write derives from the row.
		// If that resolution ever regressed, the read would tag the literal token, the write would
		// tag the uuid, they'd never match, and this read would stay a stale HIT after the write.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const me = (
				await request(url).get('/users/me?fields=id')
					.set('Authorization', auth)
			).body.data;

			// Rows owned by the current user (owner_field holds the user's id), plus a control slice.
			await request(url)
				.post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', auth);

			// $CURRENT_USER resolves to me.id → pins slice owner_field=<me.id>.
			const scopedItems = `/items/${collectionScoped}`;
			const readMine = `${scopedItems}?filter[owner_field][_eq]=$CURRENT_USER`;
			const readCtl = `${scopedItems}?filter[owner_field][_eq]=${scopedOwnerB}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await request(url).get(readMine)
				.set('Authorization', auth);

			await request(url).get(readCtl)
				.set('Authorization', auth);

			const warmMine = await request(url).get(readMine)
				.set('Authorization', auth);

			const warmCtl = await request(url).get(readCtl)
				.set('Authorization', auth);

			expect(warmMine.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmCtl.headers[cacheStatusHeader]).toBe('HIT');

			// A write in the current user's slice (owner_field=<me.id>) — the same value
			// $CURRENT_USER resolved to. It must purge the $CURRENT_USER read.
			await request(url)
				.post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', auth);

			const afterMine = await request(url).get(readMine)
				.set('Authorization', auth);

			const afterCtl = await request(url).get(readCtl)
				.set('Authorization', auth);

			// MISS proves the pin used the resolved uuid (matched the write); a literal-token pin
			// would have left this a stale HIT. The control slice stays warm.
			expect(afterMine.statusCode).toBe(200);
			expect(afterMine.headers[cacheStatusHeader]).toBe('MISS');
			expect(afterCtl.statusCode).toBe(200);
			expect(afterCtl.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		A permission-scoped read (partition in the policy, NOT the API filter) is value-scoped
		off the injected case: a write to the user's own slice drops their read, a write to
		another slice spares it
	`, () => {
		// The planner case: a student lists /items/slots with no filter, but a policy restricts
		// them to `owner_field = $CURRENT_USER`. That predicate lives in the permission rule,
		// injected as `ast.cases`, not in the query — so the pin off
		// `joinFilterWithCases(filter, cases)` (its `{ _or: cases }`) scopes the read.
		// Without it the read falls back to the bare collection tag and any other user's
		// write purges it (the over-purge this fixes). The "spared" witness below is the
		// proof it's value-scoped and not bare.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const admin = `Bearer ${USER.ADMIN.TOKEN}`;

			// A policy that scopes reads of collectionScoped to the caller's own rows, plus a role
			// carrying it and a static-token user to read as. Unique names per run avoid collisions.
			const suffix = randomUUID();

			const role = (
				await request(url).post('/roles')
					.send({ name: `cache-case-scope-${suffix}` })
					.set('Authorization', admin)
			).body.data;

			const policy = (
				await request(url).post('/policies')
					.send({
						name: `cache-case-scope-${suffix}`,
						app_access: true,
						admin_access: false,
						roles: [{ role: role.id }],
					})
					.set('Authorization', admin)
			).body.data;

			await request(url).post('/permissions')
				.send({
					policy: policy.id,
					collection: collectionScoped,
					action: 'read',
					fields: ['*'],
					permissions: { owner_field: { _eq: '$CURRENT_USER' } },
				})
				.set('Authorization', admin);

			const token = `cache-case-scope-${suffix}`;

			const me = (
				await request(url).post('/users')
					.send({
						email: `cache-case-scope-${suffix}@example.com`,
						password: randomUUID(),
						role: role.id,
						token,
						status: 'active',
					})
					.set('Authorization', admin)
			).body.data;

			const auth = `Bearer ${token}`;

			// One row in the user's own slice (owner_field=<me.id>) so the read has data + a scope
			// value; the other-slice write later targets a value the user is NOT pinned to.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', admin);

			// No filter — the owner_field bound comes only from the policy case.
			const read = `/items/${collectionScoped}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', admin);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached, case-pinned to owner_field=<me.id>

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// A write in ANOTHER owner's slice. A bare-tagged read would MISS here; a case-pinned
			// read to <me.id> is spared.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: scopedOwnerB })
				.set('Authorization', admin);

			const afterOther = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterOther.statusCode).toBe(200);
			expect(afterOther.headers[cacheStatusHeader]).toBe('HIT');

			// A write in the user's OWN slice (owner_field=<me.id>) — the value the case resolved
			// to. It must purge the read.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', admin);

			const afterMine = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterMine.statusCode).toBe(200);
			expect(afterMine.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A permission case pins the RESOLVED user id, not the literal $CURRENT_USER token —
		a write to a row whose owner_field literally holds '$CURRENT_USER' spares the read,
		a write to the resolved id purges it
	`, () => {
		// Regression guard for the resolution the case pin relies on: fetchPermissions →
		// processPermissions → parseFilter substitutes $CURRENT_USER in the policy rule with
		// the concrete user id before it becomes ast.cases, so the read pins
		// owner_field=<me.id>. If that regressed to pinning the literal token, a row with
		// owner_field='$CURRENT_USER' would share the read's slice and wrongly purge it.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const admin = `Bearer ${USER.ADMIN.TOKEN}`;

			const suffix = randomUUID();

			const role = (
				await request(url).post('/roles')
					.send({ name: `cache-case-token-${suffix}` })
					.set('Authorization', admin)
			).body.data;

			const policy = (
				await request(url).post('/policies')
					.send({
						name: `cache-case-token-${suffix}`,
						app_access: true,
						admin_access: false,
						roles: [{ role: role.id }],
					})
					.set('Authorization', admin)
			).body.data;

			await request(url).post('/permissions')
				.send({
					policy: policy.id,
					collection: collectionScoped,
					action: 'read',
					fields: ['*'],
					permissions: { owner_field: { _eq: '$CURRENT_USER' } },
				})
				.set('Authorization', admin);

			const token = `cache-case-token-${suffix}`;

			const me = (
				await request(url).post('/users')
					.send({
						email: `cache-case-token-${suffix}@example.com`,
						password: randomUUID(),
						role: role.id,
						token,
						status: 'active',
					})
					.set('Authorization', admin)
			).body.data;

			const auth = `Bearer ${token}`;

			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', admin);

			const read = `/items/${collectionScoped}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', admin);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached, pinned to owner_field=<me.id>

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Write a row whose owner_field is the LITERAL token string. If the case had
			// pinned '$CURRENT_USER' unresolved, this would share the slice and purge the
			// read. It must not — the read is pinned to the resolved <me.id>.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: '$CURRENT_USER' })
				.set('Authorization', admin);

			const afterLiteral = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterLiteral.statusCode).toBe(200);
			expect(afterLiteral.headers[cacheStatusHeader]).toBe('HIT');

			// Positive control: a write to the resolved id purges the read.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', admin);

			const afterResolved = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterResolved.statusCode).toBe(200);
			expect(afterResolved.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Two permission cases (OR-joined) do NOT bound the read — it falls back to the bare
		collection tag, so a write to ANY owner's slice purges it
	`, () => {
		// The single-case soundness gate: joinFilterWithCases applies cases as { _or: cases },
		// so 2 rules mean a row need match only one — the read is not bounded to owner=me and
		// must be bare. If the gate regressed to pinning cases[0] (owner=me), a write to
		// another owner would wrongly spare this read. Two policies on the role = two cases.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const admin = `Bearer ${USER.ADMIN.TOKEN}`;

			const suffix = randomUUID();

			const role = (
				await request(url).post('/roles')
					.send({ name: `cache-multicase-${suffix}` })
					.set('Authorization', admin)
			).body.data;

			// Two policies, each a read permission on collectionScoped with a DISTINCT rule, so
			// getCases yields two cases (OR-joined) rather than one bounding predicate.
			for (const rule of [
				{ owner_field: { _eq: '$CURRENT_USER' } },
				{ string_field: { _nnull: true } },
			]) {
				const policy = (
					await request(url).post('/policies')
						.send({
							name: `cache-multicase-${suffix}-${randomUUID()}`,
							app_access: true,
							admin_access: false,
							roles: [{ role: role.id }],
						})
						.set('Authorization', admin)
				).body.data;

				await request(url).post('/permissions')
					.send({
						policy: policy.id,
						collection: collectionScoped,
						action: 'read',
						fields: ['*'],
						permissions: rule,
					})
					.set('Authorization', admin);
			}

			const token = `cache-multicase-${suffix}`;

			const me = (
				await request(url).post('/users')
					.send({
						email: `cache-multicase-${suffix}@example.com`,
						password: randomUUID(),
						role: role.id,
						token,
						status: 'active',
					})
					.set('Authorization', admin)
			).body.data;

			const auth = `Bearer ${token}`;

			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', admin);

			const read = `/items/${collectionScoped}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', admin);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached, bare (two OR'd cases)

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Write in ANOTHER owner's slice. A bare-tagged read MISSes here; a wrongly
			// owner=me-pinned read would survive.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: scopedOwnerB })
				.set('Authorization', admin);

			const after = await request(url).get(read)
				.set('Authorization', auth);

			expect(after.statusCode).toBe(200);
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A multilevel permission rule (_and of an owner bound + another condition) still
		value-scopes the read — the pinner descends the _and, pins the bounding branch,
		ignores the rest
	`, () => {
		// The rule nests: `{ _and: [ { owner_field: _eq $CURRENT_USER }, { string_field:
		// _nnull } ] }`. A single case AND-bounds, so it pins; the walker descends `_and`,
		// pins owner_field=<me.id> (the _nnull branch doesn't bound and is skipped). Isolation
		// must hold exactly like the flat rule: other-owner write spares, own write purges.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const admin = `Bearer ${USER.ADMIN.TOKEN}`;

			const suffix = randomUUID();

			const role = (
				await request(url).post('/roles')
					.send({ name: `cache-nested-${suffix}` })
					.set('Authorization', admin)
			).body.data;

			const policy = (
				await request(url).post('/policies')
					.send({
						name: `cache-nested-${suffix}`,
						app_access: true,
						admin_access: false,
						roles: [{ role: role.id }],
					})
					.set('Authorization', admin)
			).body.data;

			await request(url).post('/permissions')
				.send({
					policy: policy.id,
					collection: collectionScoped,
					action: 'read',
					fields: ['*'],
					permissions: {
						_and: [
							{ owner_field: { _eq: '$CURRENT_USER' } },
							{ string_field: { _nnull: true } },
						],
					},
				})
				.set('Authorization', admin);

			const token = `cache-nested-${suffix}`;

			const me = (
				await request(url).post('/users')
					.send({
						email: `cache-nested-${suffix}@example.com`,
						password: randomUUID(),
						role: role.id,
						token,
						status: 'active',
					})
					.set('Authorization', admin)
			).body.data;

			const auth = `Bearer ${token}`;

			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', admin);

			const read = `/items/${collectionScoped}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', admin);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached, pinned to owner_field=<me.id>

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Other-owner write: an owner=me-pinned read is spared.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: scopedOwnerB })
				.set('Authorization', admin);

			const afterOther = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterOther.statusCode).toBe(200);
			expect(afterOther.headers[cacheStatusHeader]).toBe('HIT');

			// Own-slice write: purges the pinned read.
			await request(url).post(`/items/${collectionScoped}`)
				.send({ string_field: randomUUID(), owner_field: me.id })
				.set('Authorization', admin);

			const afterMine = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterMine.statusCode).toBe(200);
			expect(afterMine.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Two cases that both bind the owner field pin the UNION of their slices — a write to
		either owner purges the read, a write to an owner outside the union spares it
	`, () => {
		// The multi-policy planner case: a student sees their own rows AND a shared bucket, via
		// two read policies both scoping owner_field. Each case binds owner_field, so the read
		// is soundly pinned to { <me.id>, 'shared-bucket' } rather than falling back to bare —
		// more precise than a collection-wide flush. An unrelated owner's write must spare it.
		const sharedBucket = 'shared-bucket';

		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const admin = `Bearer ${USER.ADMIN.TOKEN}`;

			const suffix = randomUUID();

			const role = (
				await request(url).post('/roles')
					.send({ name: `cache-union-${suffix}` })
					.set('Authorization', admin)
			).body.data;

			// Two policies, each binding owner_field: one to the caller, one to a shared bucket.
			for (const rule of [
				{ owner_field: { _eq: '$CURRENT_USER' } },
				{ owner_field: { _eq: sharedBucket } },
			]) {
				const policy = (
					await request(url).post('/policies')
						.send({
							name: `cache-union-${suffix}-${randomUUID()}`,
							app_access: true,
							admin_access: false,
							roles: [{ role: role.id }],
						})
						.set('Authorization', admin)
				).body.data;

				await request(url).post('/permissions')
					.send({
						policy: policy.id,
						collection: collectionScoped,
						action: 'read',
						fields: ['*'],
						permissions: rule,
					})
					.set('Authorization', admin);
			}

			const token = `cache-union-${suffix}`;

			const me = (
				await request(url).post('/users')
					.send({
						email: `cache-union-${suffix}@example.com`,
						password: randomUUID(),
						role: role.id,
						token,
						status: 'active',
					})
					.set('Authorization', admin)
			).body.data;

			const auth = `Bearer ${token}`;

			// A row in each union slice, so the read has data on both sides.
			for (const owner of [me.id, sharedBucket]) {
				await request(url).post(`/items/${collectionScoped}`)
					.send({ string_field: randomUUID(), owner_field: owner })
					.set('Authorization', admin);
			}

			const read = `/items/${collectionScoped}`;

			const warmUp = async () => {
				await request(url).post(`/utils/cache/clear`)
					.set('Authorization', admin);

				await request(url).get(read)
					.set('Authorization', auth); // cold → cached, pinned to the union

				const warm = await request(url).get(read)
					.set('Authorization', auth);

				expect(warm.statusCode).toBe(200);
				expect(warm.headers[cacheStatusHeader]).toBe('HIT');
			};

			const writeOwner = async (owner: string) => {
				await request(url).post(`/items/${collectionScoped}`)
					.send({ string_field: randomUUID(), owner_field: owner })
					.set('Authorization', admin);

				return request(url).get(read)
					.set('Authorization', auth);
			};

			// A write outside the union (owner-b) spares the read — the union pin, not bare.
			await warmUp();
			const afterOutside = await writeOwner(scopedOwnerB);
			expect(afterOutside.statusCode).toBe(200);
			expect(afterOutside.headers[cacheStatusHeader]).toBe('HIT');

			// A write to the caller's own slice (a union member) purges it.
			await warmUp();
			const afterMine = await writeOwner(me.id);
			expect(afterMine.statusCode).toBe(200);
			expect(afterMine.headers[cacheStatusHeader]).toBe('MISS');

			// A write to the shared bucket (the other union member) also purges it.
			await warmUp();
			const afterShared = await writeOwner(sharedBucket);
			expect(afterShared.statusCode).toBe(200);
			expect(afterShared.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		Scoped purge pins a slice read filtered by a relation's primary key — a write to
		one owner's slice leaves another owner's cached read intact (the relational pin)
	`, () => {
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const createOwner = async () => {
				const response = await request(url)
					.post(`/items/${collectionGrandRelated}`)
					.send({ string_field: randomUUID() })
					.set('Authorization', auth);

				return response.body.data.id;
			};

			const addItem = async (owner: number) => {
				await request(url)
					.post(`/items/${collectionScopedRel}`)
					.send({ string_field: randomUUID(), owner_ref: owner })
					.set('Authorization', auth);
			};

			// Two owners, an item in each owner's slice.
			const ownerA = await createOwner();
			const ownerB = await createOwner();
			await addItem(ownerA);
			await addItem(ownerB);

			// Read each slice through the related pk — the relational form my fix unwraps.
			const base = `/items/${collectionScopedRel}?filter[owner_ref][id][_eq]=`;
			const readA = `${base}${ownerA}`;
			const readB = `${base}${ownerB}`;

			const read = (path: string) => {
				return request(url).get(path)
					.set('Authorization', auth);
			};

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// Warm both slices. Non-vacuity: a re-read HITs, so each slice is genuinely cached.
			await read(readA);
			await read(readB);
			const warmA = await read(readA);
			const warmB = await read(readB);

			expect(warmA.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmB.headers[cacheStatusHeader]).toBe('HIT');

			// Write into owner B's slice only.
			await addItem(ownerB);

			const afterA = await read(readA);
			const afterB = await read(readB);

			// The relational-pk filter pinned owner_ref=<ownerA>, so B's write dropped only B
			// (MISS) and left A cached (HIT). Without the relational unwrap the read would pin
			// nothing → bare collection tag → B's write would leave A a MISS too.
			expect(afterA.statusCode).toBe(200);
			expect(afterA.headers[cacheStatusHeader]).toBe('HIT');
			expect(afterB.statusCode).toBe(200);
			expect(afterB.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A multi-hop relational path (owned_item.owner_ref) value-scopes the read: the
		owner is two hops away, so the write side joins through owned_item to purge
		only the mutated owner's slice and spare another owner's
	`, () => {
		// scoped_cache_fields = ['owned_item.owner_ref'] on owned_sub_item: the owner is
		// owned_sub_item → owned_item → owner_ref, so the mutated row only carries
		// `owned_item` — the write must join through it to recover the owner. Without
		// path resolution the read pins nothing → bare tag → B's write leaves A a MISS.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const createMany = async (collection: string, items: object[]) => {
				return (
					await request(url).post(`/items/${collection}?fields=id`)
						.send(items)
						.set('Authorization', auth)
				).body.data;
			};

			const addSubItem = async (ownedItem: number) => {
				await request(url).post(`/items/${collectionOwnedSubItem}`)
					.send({ string_field: randomUUID(), owned_item: ownedItem })
					.set('Authorization', auth);
			};

			// Two owners, an owned_item under each, an owned_sub_item under each
			// owned_item — one createMany array POST per tier.
			const [ownerA, ownerB] = await createMany(collectionGrandRelated, [
				{ string_field: randomUUID() },
				{ string_field: randomUUID() },
			]);

			const [itemA, itemB] = await createMany(collectionOwnedItem, [
				{ owner_ref: ownerA.id },
				{ owner_ref: ownerB.id },
			]);

			await createMany(collectionOwnedSubItem, [
				{ string_field: randomUUID(), owned_item: itemA.id },
				{ string_field: randomUUID(), owned_item: itemB.id },
			]);

			// Read each slice through the terminal related pk (`owned_item.owner_ref.id`).
			const base =
				`/items/${collectionOwnedSubItem}?filter[owned_item][owner_ref][id][_eq]=`;

			const readA = `${base}${ownerA.id}`;
			const readB = `${base}${ownerB.id}`;

			const read = (path: string) => {
				return request(url).get(path)
					.set('Authorization', auth);
			};

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// Warm both slices. Non-vacuity: a re-read HITs, so each slice is cached.
			await read(readA);
			await read(readB);
			const warmA = await read(readA);
			const warmB = await read(readB);

			expect(warmA.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmB.headers[cacheStatusHeader]).toBe('HIT');

			// Write an owned_sub_item into owner B's chain only.
			await addSubItem(itemB.id);

			const afterA = await read(readA);
			const afterB = await read(readB);

			// The write joined owned_sub_item→owned_item to resolve owner_ref=<ownerB>,
			// so B's write dropped only B (MISS) and left A cached (HIT).
			expect(afterA.statusCode).toBe(200);
			expect(afterA.headers[cacheStatusHeader]).toBe('HIT');
			expect(afterB.statusCode).toBe(200);
			expect(afterB.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A DERIVED path (member scoped by its own team, team by its own owner_ref)
		value-scopes member reads by owner with no config naming another collection's
		relation: the team.owner_ref path composes itself
	`, () => {
		// member.scoped_cache_fields = ['team']; team's = ['owner_ref']. Neither names
		// `team.owner_ref` — it auto-derives. Reads/writes slice member by the owner
		// like the explicit-path case, proving composition feeds the same machinery.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const createMany = async (collection: string, items: object[]) => {
				return (
					await request(url).post(`/items/${collection}?fields=id`)
						.send(items)
						.set('Authorization', auth)
				).body.data;
			};

			const addMember = async (team: number) => {
				await request(url).post(`/items/${collectionMember}`)
					.send({ team })
					.set('Authorization', auth);
			};

			const [ownerA, ownerB] = await createMany(collectionGrandRelated, [
				{ string_field: randomUUID() },
				{ string_field: randomUUID() },
			]);

			const [teamA, teamB] = await createMany(collectionTeam, [
				{ owner_ref: ownerA.id },
				{ owner_ref: ownerB.id },
			]);

			await createMany(collectionMember, [
				{ team: teamA.id },
				{ team: teamB.id },
			]);

			const base =
				`/items/${collectionMember}?filter[team][owner_ref][id][_eq]=`;

			const readA = `${base}${ownerA.id}`;
			const readB = `${base}${ownerB.id}`;

			const read = (path: string) => {
				return request(url).get(path)
					.set('Authorization', auth);
			};

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await read(readA);
			await read(readB);
			const warmA = await read(readA);
			const warmB = await read(readB);

			expect(warmA.headers[cacheStatusHeader]).toBe('HIT');
			expect(warmB.headers[cacheStatusHeader]).toBe('HIT');

			// Write a member into owner B's team only.
			await addMember(teamB.id);

			const afterA = await read(readA);
			const afterB = await read(readB);

			// The derived team.owner_ref path resolved owner_ref=<ownerB> on both sides,
			// so B's write dropped only B (MISS) and left A cached (HIT).
			expect(afterA.statusCode).toBe(200);
			expect(afterA.headers[cacheStatusHeader]).toBe('HIT');
			expect(afterB.statusCode).toBe(200);
			expect(afterB.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A permission case whose rule is RELATIONAL (owner_ref.id _eq — the
		partition on a related pk, not a scalar) still value-scopes the read:
		a write to the pinned owner's slice purges it, another owner's spares it
	`, () => {
		// The `{ user_created: { id: { _eq: $CURRENT_USER } } }` shape — the dominant
		// real pattern — routed through a policy, not the query. The case reaches the
		// fk value through the related pk, so the pinner's relational unwrap has to fire
		// on a case (an `_or` branch via joinFilterWithCases), not just on a query
		// filter. The query-side relational pin is proven above; this proves the same
		// unwrap through ast.cases. A concrete related pk (not $CURRENT_USER — its
		// resolution is a separate guard) keeps this focused on the relational case path.
		// Without the unwrap the read would pin nothing → bare → the spare witness fails.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const admin = `Bearer ${USER.ADMIN.TOKEN}`;

			const createOwner = async () => {
				return (
					await request(url).post(`/items/${collectionGrandRelated}`)
						.send({ string_field: randomUUID() })
						.set('Authorization', admin)
				).body.data.id;
			};

			const addItem = async (owner: number) => {
				await request(url).post(`/items/${collectionScopedRel}`)
					.send({ string_field: randomUUID(), owner_ref: owner })
					.set('Authorization', admin);
			};

			// Two related owners; the policy pins the read to ownerA's slice.
			const ownerA = await createOwner();
			const ownerB = await createOwner();

			const suffix = randomUUID();

			const role = (
				await request(url).post('/roles')
					.send({ name: `cache-case-rel-${suffix}` })
					.set('Authorization', admin)
			).body.data;

			const policy = (
				await request(url).post('/policies')
					.send({
						name: `cache-case-rel-${suffix}`,
						app_access: true,
						admin_access: false,
						roles: [{ role: role.id }],
					})
					.set('Authorization', admin)
			).body.data;

			await request(url).post('/permissions')
				.send({
					policy: policy.id,
					collection: collectionScopedRel,
					action: 'read',
					fields: ['*'],
					permissions: { owner_ref: { id: { _eq: ownerA } } },
				})
				.set('Authorization', admin);

			const token = `cache-case-rel-${suffix}`;

			await request(url).post('/users')
				.send({
					email: `cache-case-rel-${suffix}@example.com`,
					password: randomUUID(),
					role: role.id,
					token,
					status: 'active',
				})
				.set('Authorization', admin);

			const auth = `Bearer ${token}`;

			// A row in the pinned slice so the read has data + a scope value.
			await addItem(ownerA);

			// No filter — the owner_ref bound comes only from the relational policy case.
			const read = `/items/${collectionScopedRel}`;

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', admin);

			await request(url).get(read)
				.set('Authorization', auth); // cold → cached, pinned to owner_ref=<ownerA>

			const warm = await request(url).get(read)
				.set('Authorization', auth);

			expect(warm.statusCode).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// A write in ANOTHER owner's slice. A bare-tagged read would MISS; the
			// relational case pin to <ownerA> spares it.
			await addItem(ownerB);

			const afterOther = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterOther.statusCode).toBe(200);
			expect(afterOther.headers[cacheStatusHeader]).toBe('HIT');

			// A write in the pinned slice (owner_ref=<ownerA>) purges the read.
			await addItem(ownerA);

			const afterMine = await request(url).get(read)
				.set('Authorization', auth);

			expect(afterMine.statusCode).toBe(200);
			expect(afterMine.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A permission case set binding DIFFERENT scope fields (field_a in one
		policy, field_b in another) union-pins BOTH — a write to either field's
		slice purges the read, a write to neither spares it (the multi-field _or
		lift, not the bare floor)
	`, () => {
		// Two read policies OR-join as { _or: [ {field_a:_eq A}, {field_b:_eq B} ] }.
		// Every branch binds a pinnable field, so the read pins BOTH slices, not bare.
		// The spare witness (a write touching neither slice) proves it's value-scoped
		// across the two fields; the two purge witnesses prove either slice drops it.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const admin = `Bearer ${USER.ADMIN.TOKEN}`;

			const suffix = randomUUID();
			const valA = randomUUID(); // the field_a slice the read is pinned to
			const valB = randomUUID(); // the field_b slice the read is pinned to

			const role = (
				await request(url).post('/roles')
					.send({ name: `cache-multifield-${suffix}` })
					.set('Authorization', admin)
			).body.data;

			// One policy per field, each read-permitting a DISTINCT scope field, so
			// getCases yields two cases both bounding — the multi-field union.
			for (const rule of [{ field_a: { _eq: valA } }, { field_b: { _eq: valB } }]) {
				const policy = (
					await request(url).post('/policies')
						.send({
							name: `cache-multifield-${suffix}-${randomUUID()}`,
							app_access: true,
							admin_access: false,
							roles: [{ role: role.id }],
						})
						.set('Authorization', admin)
				).body.data;

				await request(url).post('/permissions')
					.send({
						policy: policy.id,
						collection: collectionScopedMulti,
						action: 'read',
						fields: ['*'],
						permissions: rule,
					})
					.set('Authorization', admin);
			}

			const token = `cache-multifield-${suffix}`;

			await request(url).post('/users')
				.send({
					email: `cache-multifield-${suffix}@example.com`,
					password: randomUUID(),
					role: role.id,
					token,
					status: 'active',
				})
				.set('Authorization', admin);

			const auth = `Bearer ${token}`;

			// A row in field_a's pinned slice so the read has data.
			await request(url).post(`/items/${collectionScopedMulti}`)
				.send({ field_a: valA })
				.set('Authorization', admin);

			// No filter — the field_a/field_b bounds come only from the two policy cases.
			const read = `/items/${collectionScopedMulti}`;

			const warmUp = async () => {
				await request(url).post(`/utils/cache/clear`)
					.set('Authorization', admin);

				await request(url).get(read)
					.set('Authorization', auth); // cold → cached, pinned to A + B slices

				const warm = await request(url).get(read)
					.set('Authorization', auth);

				expect(warm.headers[cacheStatusHeader]).toBe('HIT');
			};

			const writeRow = async (item: { field_a?: string; field_b?: string }) => {
				await request(url).post(`/items/${collectionScopedMulti}`)
					.send(item)
					.set('Authorization', admin);

				return request(url).get(read)
					.set('Authorization', auth);
			};

			// A write touching NEITHER slice spares the read — the union pin, not bare.
			await warmUp();

			const afterNeither = await writeRow({
				field_a: randomUUID(),
				field_b: randomUUID(),
			});

			expect(afterNeither.statusCode).toBe(200);
			expect(afterNeither.headers[cacheStatusHeader]).toBe('HIT');

			// A write to the field_a slice purges it.
			await warmUp();
			expect((await writeRow({ field_a: valA })).headers[cacheStatusHeader]).toBe('MISS');

			// A write to the field_b slice purges it too.
			await warmUp();
			expect((await writeRow({ field_b: valB })).headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A cached custom-controller read (/settings) is purged when its collection is
		mutated: the bare-collection-tag fallback keeps it from orphaning in scoped mode
	`, () => {
		// The /settings controller sets res.locals.payload but no scopedCacheTags. Its
		// cached response would be tagged [] and no scoped purge could drop it (a stale
		// HIT after a settings PATCH: the license reask). respond.ts adds the bare
		// `directus_settings` tag, so the PATCH's scoped purge reaches it.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const readSettings = () => {
				return request(url).get('/settings')
					.set('Authorization', auth);
			};

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// Warm. Non-vacuity: a re-read HITs, so /settings is genuinely cached.
			await readSettings();
			const warm = await readSettings();

			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// A settings PATCH scope-purges directus_settings.
			await request(url).patch('/settings')
				.send({ project_name: `preview-${randomUUID()}` })
				.set('Authorization', auth);

			const after = await readSettings();

			// Purged (MISS). Without the fallback it was orphaned → stale HIT.
			expect(after.statusCode).toBe(200);
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A collection-less read (/server/info) is not cached in scoped mode: nothing
		could purge it, so respond.ts skips it rather than orphan a stale entry
	`, () => {
		// /server/info runs respond without useCollection → no scopedCacheTags and no
		// req.collection. In scoped mode nothing could ever purge it, so it isn't cached
		// (MISS every read) — unlike an item read, which HITs in the same env.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const readInfo = () => {
				return request(url).get('/server/info')
					.set('Authorization', auth);
			};

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			const first = await readInfo();
			const second = await readInfo();

			// Never cached in scoped mode — both reads MISS.
			expect(first.statusCode).toBe(200);
			expect(first.headers[cacheStatusHeader]).toBe('MISS');
			expect(second.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		A schema endpoint (/collections) is cached against its system collection, not
		data: a business-row write leaves it cached; a schema mutation purges it
	`, () => {
		// /collections describes the SCHEMA. useCollection('directus_collections') + the
		// respond.ts fallback tag its cached response with directus_collections, so it
		// survives item writes (schema, not data); only a schema mutation drops it.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const readCollections = () => {
				return request(url).get('/collections')
					.set('Authorization', auth);
			};

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// Warm. Non-vacuity: cached now (was orphaned/uncached before the tag).
			await readCollections();
			const warm = await readCollections();

			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// A business-row insert must NOT flush it — its content is schema, not data.
			await request(url).post(`/items/${collectionFirst}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			const afterData = await readCollections();

			expect(afterData.headers[cacheStatusHeader]).toBe('HIT');

			// A schema mutation (a directus_collections write) purges it.
			await request(url).patch(`/collections/${collectionFirst}`)
				.send({ meta: { note: `n-${randomUUID()}` } })
				.set('Authorization', auth);

			const afterSchema = await readCollections();

			expect(afterSchema.statusCode).toBe(200);
			expect(afterSchema.headers[cacheStatusHeader]).toBe('MISS');
		});
	});

	describe(oneLine`
		/fields, /relations and /schema/snapshot are tagged by their system collections:
		a business write leaves them cached; a field mutation purges all
	`, () => {
		// The param reads (/fields/:c, /relations/:c) set an explicit directus_fields /
		// directus_relations tag — validateCollection had reset req.collection to the
		// data collection. /schema/snapshot tags {collections,fields,relations}. So an
		// item write spares them, a field create/delete drops all three.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const read = (path: string) => {
				return request(url).get(path)
					.set('Authorization', auth);
			};

			const readFields = () => read(`/fields/${collectionFirst}`);
			const readRelations = () => read(`/relations/${collectionFirst}`);
			const readSnapshot = () => read('/schema/snapshot');

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			// Warm all three. Non-vacuity: a re-read HITs.
			await readFields();
			await readRelations();
			await readSnapshot();

			expect((await readFields()).headers[cacheStatusHeader]).toBe('HIT');
			expect((await readRelations()).headers[cacheStatusHeader]).toBe('HIT');
			expect((await readSnapshot()).headers[cacheStatusHeader]).toBe('HIT');

			// A business-row insert leaves all cached (schema, not data).
			await request(url).post(`/items/${collectionFirst}`)
				.send({ string_field: randomUUID() })
				.set('Authorization', auth);

			expect((await readFields()).headers[cacheStatusHeader]).toBe('HIT');
			expect((await readRelations()).headers[cacheStatusHeader]).toBe('HIT');
			expect((await readSnapshot()).headers[cacheStatusHeader]).toBe('HIT');

			// A field mutation (directus_fields write) purges all.
			const field = `tmp_${randomUUID().replace(/-/g, '')}`;

			await request(url).post(`/fields/${collectionFirst}`)
				.send({ field, type: 'string' })
				.set('Authorization', auth);

			expect((await readFields()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readRelations()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readSnapshot()).headers[cacheStatusHeader]).toBe('MISS');

			// Clean up the temp field.
			await request(url).delete(`/fields/${collectionFirst}/${field}`)
				.set('Authorization', auth);
		});

		// Bare-list and single-item variants cache like the filtered ones; read twice.
		// directus_users.role is a relation present on every install.
		it.each(vendors)('%s — sibling field/relation routes cache', async (vendor) => {
			const env = envs[vendor].envRedisScopedPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const read = (path: string) => {
				return request(url).get(path)
					.set('Authorization', auth);
			};

			const readFieldsAll = () => read('/fields');
			const readOneField = () => read(`/fields/${collectionFirst}/string_field`);
			const readRelationsAll = () => read('/relations');
			const readOneRelation = () => read('/relations/directus_users/role');

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await readFieldsAll();
			await readOneField();
			await readRelationsAll();
			await readOneRelation();

			expect((await readFieldsAll()).headers[cacheStatusHeader]).toBe('HIT');
			expect((await readOneField()).headers[cacheStatusHeader]).toBe('HIT');
			expect((await readRelationsAll()).headers[cacheStatusHeader]).toBe('HIT');
			expect((await readOneRelation()).headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe(oneLine`
		A collection-less read (/server/info) IS cached in full-purge mode — the skip is
		scoped-mode-only, since full mode's cache.clear() can't orphan
	`, () => {
		// The mirror of the scoped-mode skip above: in full mode the same tagless,
		// collection-less response is cached (a mutation clears the whole cache, so it
		// can't go stale). Proves the behavior split is intentional, not a blanket skip.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedisPurge;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const readInfo = () => {
				return request(url).get('/server/info')
					.set('Authorization', auth);
			};

			await request(url).post(`/utils/cache/clear`)
				.set('Authorization', auth);

			await readInfo();
			const warm = await readInfo();

			// Cached in full mode (unlike the scoped-mode MISS asserted above).
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');
		});
	});

	describe('The cache registry lists and evicts cached entries', () => {
		// Telemetry is buffered in Redis and flushed to Postgres on a schedule, so the
		// listing is eventually-consistent — poll until the fill/hit land.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedis;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			await request(url).post('/utils/cache/clear')
				.set('Authorization', auth);

			// Truncate the fact/dimension tables so a prior run's rows for this path can't
			// satisfy the hits assertion below — the listing must reflect THIS run's fill.
			await request(url).post('/utils/cache/stats/truncate')
				.set('Authorization', auth);

			// Populate a cached read (miss → fill → descriptor) and record a hit.
			await request(url).get(`/items/${collectionFirst}`)
				.set('Authorization', auth);

			await request(url).get(`/items/${collectionFirst}`)
				.set('Authorization', auth);

			await request(url).get(`/items/${collectionRelated}`)
				.set('Authorization', auth);

			// Wait for the flush to drain the buffer into the descriptor + fact tables.
			let first: any;

			for (let attempt = 0; attempt < 20; attempt++) {
				const listed = await request(url).get('/utils/cache')
					.set('Authorization', auth);

				expect(listed.statusCode).toBe(200);

				first = listed.body.data.find((entry: any) => {
					return entry.path === `/items/${collectionFirst}`;
				});

				if (first && first.hits >= 1) {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			expect(first).toBeDefined();
			expect(first.hits).toBeGreaterThanOrEqual(1);
			expect(typeof first.query).toBe('string');

			// The live Redis state is still there for the freshly-filled key.
			const entry = await request(url).get('/utils/cache/entry')
				.query({ key: first.key })
				.set('Authorization', auth);

			expect(entry.statusCode).toBe(200);
			expect(entry.body.data.exists).toBe(true);
			expect(entry.body.data.value).toBeDefined();

			// Missing key → 400.
			const noKey = await request(url).get('/utils/cache/entry')
				.set('Authorization', auth);

			expect(noKey.statusCode).toBe(400);

			// Evict one entry by key (its own branch)…
			const byKey = await request(url).delete('/utils/cache')
				.query({ key: first.key })
				.set('Authorization', auth);

			expect(byKey.statusCode).toBe(200);
			expect(byKey.body.data.evicted).toBe(1);

			// …then evict a whole endpoint by path (the described keys under it).
			const byPath = await request(url).delete('/utils/cache')
				.query({ path: `/items/${collectionFirst}` })
				.set('Authorization', auth);

			expect(byPath.statusCode).toBe(200);
			expect(byPath.body.data.evicted).toBeGreaterThanOrEqual(1);

			// Neither key nor path → 400.
			const bad = await request(url).delete('/utils/cache')
				.set('Authorization', auth);

			expect(bad.statusCode).toBe(400);
		}, 40000);
	});

	describe('Recommends a TTL from the re-request age p95 (Postgres only)', () => {
		// Seed the fact/dimension tables directly so the percentile_cont math is asserted
		// on known inputs — the capture path can't produce controlled ages/gaps. On a
		// non-pg dialect the ordered-set aggregate is skipped, so recommendedTtlMs is null.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedis;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;
			const db = databases.get(vendor)!;
			const isPg = db.client.config.client === 'pg';

			const key = `ttl-probe-${vendor}`;
			const path = `/items/ttl_probe_${vendor}`;
			const now = new Date();

			await db('directus_cache_events').where({ cache_key: key }).delete();
			await db('directus_cache_descriptors').where({ cache_key: key }).delete();

			await db('directus_cache_descriptors').insert({
				cache_key: key,
				method: 'GET',
				path,
				collection: null,
				user_id: null,
				query: '{}',
				url: path,
				bytes: 0,
				fill_ms: 0,
				last_filled: now,
			});

			// Ten hits at age 1000ms and ten near-expiry misses at ttl+gap = 2000ms. The p95
			// over {ten 1000s, ten 2000s} is 2000; a wrong CASE branch (age_ms for a miss,
			// which is null) would drop the misses and collapse the answer to 1000.
			const events = [];

			for (let i = 0; i < 10; i++) {
				events.push({
					time: now,
					cache_key: key,
					kind: 0,
					age_ms: 1000,
					gap_ms: null,
					ttl_ms: 300000,
					duration_ms: 5,
				});

				events.push({
					time: now,
					cache_key: key,
					kind: 1,
					age_ms: null,
					gap_ms: 500,
					ttl_ms: 1500,
					duration_ms: null,
				});
			}

			await db('directus_cache_events').insert(events);

			const listed = await request(url).get('/utils/cache')
				.set('Authorization', auth);

			expect(listed.statusCode).toBe(200);

			const row = listed.body.data.find((entry: any) => entry.path === path);

			expect(row).toBeDefined();

			if (isPg) {
				expect(row.recommendedTtlMs).toBe(2000);
			}
			else {
				expect(row.recommendedTtlMs).toBeNull();
			}

			await db('directus_cache_events').where({ cache_key: key }).delete();
			await db('directus_cache_descriptors').where({ cache_key: key }).delete();
		}, 40000);
	});

	describe('The cache stats endpoints report state and toggle collection', () => {
		// Redis-only: the runtime flag + event buffer live in Redis, so the state
		// reports `configured` and a toggle round-trips on the serving instance.
		it.each(vendors)('%s', async (vendor) => {
			const env = envs[vendor].envRedis;
			const url = getUrl(vendor, env);
			const auth = `Bearer ${USER.ADMIN.TOKEN}`;

			const state = await request(url).get('/utils/cache/stats')
				.set('Authorization', auth);

			expect(state.statusCode).toBe(200);
			expect(state.body.data.configured).toBe(true);
			expect(typeof state.body.data.bufferLength).toBe('number');

			// Disable collection at runtime…
			const off = await request(url).patch('/utils/cache/stats')
				.send({ enabled: false })
				.set('Authorization', auth);

			expect(off.statusCode).toBe(200);
			expect(off.body.data.enabled).toBe(false);

			const disabled = await request(url).get('/utils/cache/stats')
				.set('Authorization', auth);

			expect(disabled.body.data.enabled).toBe(false);

			// …reclaim the gathered events…
			const truncated = await request(url).post('/utils/cache/stats/truncate')
				.set('Authorization', auth);

			expect(truncated.statusCode).toBe(200);
			expect(truncated.body.data.truncated).toBe(true);

			// …then re-enable so later reads collect again.
			const on = await request(url).patch('/utils/cache/stats')
				.send({ enabled: true })
				.set('Authorization', auth);

			expect(on.statusCode).toBe(200);
			expect(on.body.data.enabled).toBe(true);

			// Missing `enabled` → 400.
			const bad = await request(url).patch('/utils/cache/stats')
				.set('Authorization', auth);

			expect(bad.statusCode).toBe(400);
		});
	});
});
