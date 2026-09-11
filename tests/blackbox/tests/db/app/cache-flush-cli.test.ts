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
// written against. These drive real Redis, the real namespace, the real
// `<namespace>:scoped-cache-index:*` scan, and the cache-stats keys sitting
// beside it.

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

		// Same bus, its own response and system tiers. `schemaChanged` reaches neither
		// of them, so this is the node the flush has to speak to rather than clear.
		const peerEnv = cloneDeep(env);
		peerEnv[vendor]['CACHE_STORE'] = 'memory';

		// Off, or the peer arm proves nothing: the system clear this flush runs has
		// always published `schemaChanged`, and its handler drops a memory-store
		// peer's response cache on its own whenever this is on.
		peerEnv[vendor]['CACHE_AUTO_PURGE'] = 'false';

		let instance: ChildProcess;
		let peer: ChildProcess;
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

			const peerPort = await getPort();
			peerEnv[vendor].PORT = String(peerPort);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			peer = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: peerEnv[vendor],
			});

			db = knex(config.knexConfig[vendor]!);

			await Promise.all([
				awaitDirectusConnection(port),
				awaitDirectusConnection(peerPort),
			]);
		}, 60_000);

		afterAll(async () => {
			instance.kill();
			peer.kill();

			await db.destroy();
			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		// Its own process, with the instance's env: the deploy step the command
		// exists for, not an in-process call to `flushCaches`.
		function runCacheFlush(
			overrides: Record<string, string> = {},
		): Promise<{ code: number | null; output: string }> {
			return new Promise((resolve) => {
				const cli = spawn('node', [paths.cli, 'cache', 'flush'], {
					cwd: paths.cwd,
					env: { ...env[vendor], LOG_LEVEL: 'info', ...overrides },
				});

				let output = '';

				cli.stdout.on('data', (chunk) => (output += String(chunk)));
				cli.stderr.on('data', (chunk) => (output += String(chunk)));

				cli.on('exit', (code) => resolve({ code, output }));
			});
		}

		function readOwner(owner: string, from = env) {
			return request(getUrl(vendor, from))
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
				/\[cache\] flushed in (\d+)ms, dropped (\d+) scoped-cache index keys/,
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
			fails within its budget when Redis cannot be reached, rather than holding
			the deploy step open
		`, async () => {
			// A command issued while Redis is unreachable waits on the next reconnect,
			// and the CLI bootstrap issues some before the flush itself does — so
			// without the deadline this asserts, the deploy step calling the command
			// hangs before it even reaches the flush.
			const startedAt = Date.now();

			const { code, output } = await runCacheFlush({
				REDIS: 'redis://localhost:6199',
				CACHE_FLUSH_TIMEOUT: '3s',

				// Past the budget on purpose. ioredis abandons a command after 20
				// reconnect attempts, and the default backoff burns those inside three
				// seconds — which would end the run on ioredis's deadline rather than
				// on the one under test.
				REDIS_RETRY_BASE_DELAY: '5000',
				REDIS_RETRY_MAX_DELAY: '5000',
			});

			expect(code).toBe(1);
			expect(Date.now() - startedAt).toBeLessThan(30_000);
			expect(output).toMatch(/did not finish within 3000ms/);
		}, 60_000);

		it(oneLine`
			says a run can reach no other node, rather than reporting a flush the rest
			of the cluster never heard about
		`, async () => {
			// The command runs in the deploy shell, whose env is not the running
			// service's, so a bus-less run is as likely a misconfiguration as a real
			// single node: it clears this process alone, and has to say so.
			const { code, output } = await runCacheFlush({ REDIS_ENABLED: 'false' });

			expect(code).toBe(0);
			expect(output).toMatch(/no REDIS is configured/);
		}, 60_000);

		it(oneLine`
			drops the copy a peer on a memory store holds, which no broadcast the flush
			used to send could reach
		`, async () => {
			await readOwner('acme', peerEnv);

			const warmed = await readOwner('acme', peerEnv);
			expect(warmed.headers[cacheStatusHeader]).toBe('HIT');

			const { code } = await runCacheFlush();
			expect(code).toBe(0);

			// The peer clears on a message rather than on the call, so its read is
			// only eventually a MISS.
			let status: string | undefined = 'HIT';

			for (let attempt = 0; attempt < 20 && status === 'HIT'; attempt++) {
				const afterFlush = await readOwner('acme', peerEnv);
				status = afterFlush.headers[cacheStatusHeader];

				if (status === 'HIT') {
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
			}

			expect(status).toBe('MISS');
		}, 60_000);

		it(oneLine`
			leaves the cache-stats stream sitting beside the index alone
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

			// `<namespace>:stats:events` is one widened MATCH away from going with
			// the index it neighbours, and nothing else here would say so.
			expect(afterFlush.body.data.bufferLength).toBeGreaterThanOrEqual(buffered);
		}, 60_000);
	});
});
