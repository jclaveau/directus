import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	CreatePermission,
	DeleteCollection,
} from '@common/functions';
import vendors, { allVendors } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `flushCachesIfBuildChanged` fires once per deploy, before the process serves
// anything. A deploy step that changes the DATA the caches are derived from — a
// schema-sync import, a permission sync, raw SQL — runs after that, and every node
// keeps answering from the pre-change read (jclaveau/directus#474). `directus cache
// flush` is that step's way to say so, and it runs in its OWN process: what has to
// hold is that a node it never touched serves the change.
//
// The unit tests mock ioredis, so the key layout they assume is the one they were
// written against. These drive real Redis, the real namespace, the real widened
// `<namespace>:*` scan, and the cache-stats keys under that same prefix.

const COLLECTION = 'test_cache_flush_cli';
const cacheStatusHeader = 'x-cache-status';

describe('`directus cache flush` clears a running node from another process', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);

		// Its own Redis database, keyed off the vendor. The scoped-cache index is
		// namespaced but the permission cache is not — every instance on this Redis
		// shares one `permissions:` prefix — so a namespace alone would leave the
		// permission arm below reading another test's clears.
		const redisDb = allVendors.indexOf(vendor) + 1;

		env[vendor]['REDIS'] = `redis://localhost:6108/${redisDb}`;
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['CACHE_NAMESPACE'] = `directus-flush-cli-${vendor}`;
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';

		// The drain empties the very stream the stats arm asserts survived the
		// flush, so it is parked on new year's day and the stream only grows.
		env[vendor]['CACHE_STATS_DRAIN_SCHEDULE'] = '0 0 0 1 1 *';

		let instance: ChildProcess;
		let db: Knex;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		const restricted = `Bearer ${USER.APP_ACCESS.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: COLLECTION,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'amount', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, {
				collection: COLLECTION,
				item: [
					{ owner: 'acme', amount: '1' },
					{ owner: 'globex', amount: '2' },
				],
			});

			// On an action nothing here reads: its only purpose is to have the API
			// build the policy, attach it to the role, and write one row whose exact
			// column set the read permission is cloned from below.
			await CreatePermission(vendor, {
				role: 'APP_ACCESS',
				policyName: 'cache-flush-cli',
				permission: {
					collection: COLLECTION,
					action: 'update',
					fields: ['*'],
				},
			});

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
			instance.kill();

			await db.destroy();
			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		// Its own process, with the instance's env: the deploy step the command
		// exists for, not an in-process call to `flushCaches`.
		function runCacheFlush(): Promise<{ code: number | null; output: string }> {
			return new Promise((resolve) => {
				const cli = spawn('node', [paths.cli, 'cache', 'flush'], {
					cwd: paths.cwd,
					env: { ...env[vendor], LOG_LEVEL: 'info' },
				});

				let output = '';

				cli.stdout.on('data', (chunk) => (output += String(chunk)));
				cli.stderr.on('data', (chunk) => (output += String(chunk)));

				cli.on('exit', (code) => resolve({ code, output }));
			});
		}

		function readOwner(owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${COLLECTION}`)
				.query({ filter: { owner: { _eq: owner } } })
				.set('Authorization', auth);
		}

		function readAsRestricted() {
			return request(getUrl(vendor, env))
				.get(`/items/${COLLECTION}`)
				.set('Authorization', restricted);
		}

		function cacheStatsState() {
			return request(getUrl(vendor, env))
				.get('/utils/cache/stats')
				.set('Authorization', auth);
		}

		it(oneLine`
			exits 0 and reports what the flush cost and how much index it dropped
		`, async () => {
			// Two scope values, so the count cannot come out at one whatever the
			// scan returned.
			await readOwner('acme');
			await readOwner('globex');

			const { code, output } = await runCacheFlush();

			expect(code).toBe(0);

			const flushed = output.match(
				/\[cache\] flushed in (\d+)ms, dropped (\d+) scoped-tag index keys/,
			);

			expect(flushed).not.toBe(null);
			expect(Number(flushed![2])).toBeGreaterThanOrEqual(2);
		}, 60_000);

		it(oneLine`
			serves a read the running node had cached before it as a MISS
		`, async () => {
			await readOwner('acme');

			const warmed = await readOwner('acme');
			expect(warmed.headers[cacheStatusHeader]).toBe('HIT');

			const { code } = await runCacheFlush();
			expect(code).toBe(0);

			const afterFlush = await readOwner('acme');
			expect(afterFlush.headers[cacheStatusHeader]).toBe('MISS');
		}, 60_000);

		it(oneLine`
			serves a permission written outside the API, whose absence the node had
			cached
		`, async () => {
			const denied = await readAsRestricted();
			expect(denied.statusCode).toBe(403);

			// Straight to the table, the way a schema-sync import writes it: no API
			// call, so no `schemaChanged` broadcast, so nothing tells the running
			// node its cached "no read permission" is now wrong.
			const [seeded] = await db('directus_permissions')
				.where({ collection: COLLECTION, action: 'update' });

			const { id: _seededId, ...template } = seeded;

			await db('directus_permissions').insert({ ...template, action: 'read' });

			const stillDenied = await readAsRestricted();
			expect(stillDenied.statusCode).toBe(403);

			const { code } = await runCacheFlush();
			expect(code).toBe(0);

			const allowed = await readAsRestricted();
			expect(allowed.statusCode).toBe(200);
		}, 60_000);

		it(oneLine`
			leaves the cache-stats stream the widened index scan walks over
		`, async () => {
			await readOwner('acme');
			await readOwner('globex');

			// The XADDs are batched per event-loop tick, so the stream lands a
			// moment after the response does.
			let buffered = 0;

			for (let attempt = 0; attempt < 20 && buffered === 0; attempt++) {
				const state = await cacheStatsState();
				buffered = state.body.data.bufferLength;

				if (buffered === 0) {
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
			}

			expect(buffered).toBeGreaterThan(0);

			const { code } = await runCacheFlush();
			expect(code).toBe(0);

			const afterFlush = await cacheStatsState();

			// `<namespace>:stats:events` shares the prefix the flush now scans, and
			// only the client-side filter keeps it out of the unlink.
			expect(afterFlush.body.data.bufferLength).toBeGreaterThanOrEqual(buffered);
		}, 60_000);
	});
});
