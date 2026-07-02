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
	const publicURL = 'http://example.com';

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			databases.set(vendor, knex(config.knexConfig[vendor]!));

			const envMem = cloneDeep(config.envs);
			envMem[vendor]['PUBLIC_URL'] = publicURL;
			envMem[vendor]['CACHE_ENABLED'] = 'true';
			envMem[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			envMem[vendor]['CACHE_AUTO_PURGE'] = 'false';
			envMem[vendor]['CACHE_AUTO_PURGE_IGNORE_LIST'] = `directus_activity,directus_presets,${collectionIgnored}`;
			envMem[vendor]['CACHE_STORE'] = 'memory';
			envMem[vendor]['CACHE_NAMESPACE'] = `${cacheNamespacePrefix}_mem`;

			const envMemPurge = cloneDeep(envMem);
			envMemPurge[vendor]['CACHE_AUTO_PURGE'] = 'true';
			envMemPurge[vendor]['CACHE_NAMESPACE'] = `${cacheNamespacePrefix}_mem_purge`;

			const envRedis = cloneDeep(envMem);
			envRedis[vendor]['CACHE_STORE'] = 'redis';
			envRedis[vendor]['REDIS_HOST'] = 'localhost';
			envRedis[vendor]['REDIS_PORT'] = '6108';
			envRedis[vendor]['CACHE_NAMESPACE'] = `${cacheNamespacePrefix}_redis`;

			const envRedisPurge = cloneDeep(envRedis);
			envRedisPurge[vendor]['CACHE_AUTO_PURGE'] = 'true';
			// scoped is the default now, so pin full explicitly to keep covering whole-namespace purge.
			envRedisPurge[vendor]['CACHE_AUTO_PURGE_MODE'] = 'full';
			envRedisPurge[vendor]['CACHE_NAMESPACE'] = `${cacheNamespacePrefix}_redis_purge`;

			// Auto-purge with scoped (tag-based) invalidation: a mutation drops only the cache entries
			// that read the mutated collection, leaving other collections warm.
			const envRedisScopedPurge = cloneDeep(envRedisPurge);
			envRedisScopedPurge[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
			envRedisScopedPurge[vendor]['CACHE_NAMESPACE'] = `${cacheNamespacePrefix}_redis_scoped`;

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
});
