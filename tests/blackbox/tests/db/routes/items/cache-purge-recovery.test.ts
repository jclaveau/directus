import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex from 'knex';
import { cloneDeep } from 'lodash-es';
import net from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for a purge that fails AFTER its mutation committed
// (https://github.com/jclaveau/directus/issues/365). The write is durable by then,
// so the request must succeed rather than 500 — a 500 would have the client retry
// a mutation that already landed — and the purge has to be finished later instead
// of forgotten.
//
// Redis is cut by putting a TCP proxy in front of it and destroying the sockets,
// which is the only way to make the purge fail while the database stays up. The
// retry knobs `create-redis.ts` exposes are what keep it quick: the default 20
// attempts would otherwise take ~30s to give up.

const NOTE = 'test_items_recovery_note';
const PENDING = 'directus_scoped_cache_pending_purges';

// A failing assertion here reports one header and nothing about the state that
// produced it, and the instance's own log is only dumped when the process exits — so
// each step says what it saw while it still can.
const startedAt = Date.now();

function mark(phase: string) {
	// eslint-disable-next-line no-console
	console.info(`[recovery] ${Date.now() - startedAt}ms ${phase}`);
}

const cacheStatusHeader = 'x-cache-status';

// A proxy we can kill and bring back, so the API keeps its config and only the
// connection dies — what a real Redis blip looks like from the app's side.
function createRedisProxy(upstreamPort: number, listenPort: number) {
	const sockets = new Set<net.Socket>();
	let server: net.Server | null = null;

	function open(): Promise<void> {
		server = net.createServer((client) => {
			const upstream = net.createConnection({
				host: '127.0.0.1',
				port: upstreamPort,
			});

			sockets.add(client);
			sockets.add(upstream);

			client.pipe(upstream);
			upstream.pipe(client);

			// Either side going away takes the pair with it; without this a half-open
			// socket keeps `server.close()` waiting.
			const drop = () => {
				client.destroy();
				upstream.destroy();
				sockets.delete(client);
				sockets.delete(upstream);
			};

			client.on('error', drop);
			upstream.on('error', drop);
			client.on('close', drop);
			upstream.on('close', drop);
		});

		return new Promise((resolve) => {
			server!.listen(listenPort, () => resolve());
		});
	}

	function cut(): Promise<void> {
		for (const socket of sockets) {
			socket.destroy();
		}

		sockets.clear();

		// Already down: the cleanup calls this too, and a case that failed before
		// reopening would otherwise throw here and bury the real failure.
		if (server === null) {
			return Promise.resolve();
		}

		const listening = server;

		return new Promise((resolve) => {
			listening.close(() => {
				server = null;
				resolve();
			});
		});
	}

	return { open, cut };
}

describe(oneLine`
	a purge that fails after its mutation committed is recorded and finished on
	reconnect (#365)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		let proxy: ReturnType<typeof createRedisProxy>;
		let instance: ChildProcess;
		let readNote: number;
		let siblingNote: number;

		// Cutting Redis is exactly the condition an unhandled `error` event turns into
		// a dead process, and a dead server answers ECONNRESET — which says nothing
		// about why. Keep the instance's own output so a failure here reports the
		// crash instead of the symptom.
		const instanceLog: string[] = [];

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		const db = knex(config.knexConfig[vendor]!);

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: NOTE,
						fields: [{ field: 'subject', type: 'string', meta: {} }],
					},
				],
			});

			const notes = await CreateItem(vendor, {
				collection: NOTE,
				item: [{ subject: 'read' }, { subject: 'sibling' }],
			});

			[readNote, siblingNote] = notes.map((note: { id: number }) => note.id);

			const proxyPort = await getPort();
			proxy = createRedisProxy(6108, proxyPort);
			await proxy.open();

			env[vendor]['CACHE_ENABLED'] = 'true';
			env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			env[vendor]['CACHE_AUTO_PURGE'] = 'true';
			env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
			env[vendor]['CACHE_STORE'] = 'redis';
			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = String(proxyPort);
			env[vendor]['CACHE_NAMESPACE'] = `directus-purge-recovery-${vendor}`;

			// 20 attempts at the stock 50ms..2000ms backoff take ~30s to give up on a
			// queued command; this brings the whole outage inside a test's patience,
			// and reconnects within one poll of the proxy returning.
			env[vendor]['REDIS_RETRY_BASE_DELAY'] = '10';
			env[vendor]['REDIS_RETRY_MAX_DELAY'] = '50';

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			instance.stdout?.on('data', (chunk) => instanceLog.push(String(chunk)));
			instance.stderr?.on('data', (chunk) => instanceLog.push(String(chunk)));

			instance.on('exit', (code) => {
				instanceLog.push(`=== instance exited with ${code} ===`);
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();
			// The proxy is a listening server, so it keeps the port and its sockets for
			// the rest of the run unless it is closed here.
			await proxy.cut();
			await db(PENDING).delete();
			await db.destroy();
			await DeleteCollection(vendor, { collection: NOTE });
		});

		// A supertest ECONNRESET means the server is gone, and the useful evidence is
		// in its log rather than in the socket error. Fail with the log instead.
		//
		// Waits first: the socket dies before the child is reaped, so reading
		// `exitCode` the moment the request rejects still reports a live process and
		// rethrows the useless error.
		async function assertInstanceAlive() {
			await new Promise((resolve) => setTimeout(resolve, 1000));

			if (instance.exitCode === null) {
				return;
			}

			const tail = instanceLog.join('').slice(-4000);

			throw new Error(
				`the Directus instance exited with ${instance.exitCode}:\n${tail}`,
			);
		}

		function get(key: number) {
			return request(getUrl(vendor, env))
				.get(`/items/${NOTE}/${key}`)
				.set('Authorization', auth);
		}

		// Per CASE, never per read: the first case warms two entries and needs both,
		// so `cachedRead` cannot clear. And a case cannot inherit the cache either —
		// the recovery poll re-fills on the very MISS it waits for, so whatever ran
		// before leaves its entry warm.
		function emptyCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		async function cachedRead(key: number) {
			const miss = await get(key);
			const hit = await get(key);

			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');
		}

		it(oneLine`
			the write succeeds while Redis is down, its purge is recorded, and reconnecting
			drops the entry it could not — leaving every other slice warm
		`, async () => {
			await emptyCache();
			await db(PENDING).delete();

			await cachedRead(readNote);
			await cachedRead(siblingNote);

			await proxy.cut();

			// The write lands and answers 2xx. A 500 here is the failure mode the whole
			// design refuses: the row is already committed, so a retrying client would
			// duplicate it.
			const written = await request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${readNote}`)
				.send({ subject: `renamed-${Date.now()}` })
				.set('Authorization', auth)
				.catch(async (error: Error) => {
					await assertInstanceAlive();
					throw error;
				});

			await assertInstanceAlive();
			expect(written.status).toBe(200);

			// Recorded by its display label, so the retry can rebuild the key against
			// whatever CACHE_NAMESPACE is set to when it runs.
			const pending = await db(PENDING).select('mode', 'scoped_cache_tag');

			// Every row, not only the one asserted below: `toContainEqual` permits others,
			// and a `namespace` row drains as `cache.clear()` — which would wipe the
			// sibling this case expects to survive and leave the assertion pointing at
			// the wrong culprit.
			mark(`recorded while down: ${JSON.stringify(pending)}`);

			expect(pending).toContainEqual({
				mode: 'slices',
				scoped_cache_tag: `${NOTE}:id=${readNote}`,
			});

			await proxy.open();

			// Reconnect fires `ready`, which drains the record. Poll rather than sleep:
			// the reconnect backoff and the drain are both async.
			//
			// Waiting on the table emptying, never on a MISS: a read whose store is
			// still offline misses for free, so polling on that exits while the socket
			// is down and every assertion below then runs before the drain has done
			// anything at all.
			let drained: Array<Record<string, unknown>> = [];

			for (let attempt = 0; attempt < 80; attempt++) {
				drained = await db(PENDING).select('mode', 'scoped_cache_tag');

				if (drained.length === 0) {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 250));
			}

			const status = (await get(readNote)).headers[cacheStatusHeader];

			expect(status).toBe('MISS');

			// The recovery retried the recorded tag, not the namespace: a slice that was
			// never in doubt is still cached.
			const sibling = (await get(siblingNote)).headers[cacheStatusHeader];

			mark(`after recovery: read=${status} sibling=${sibling}`);
			mark(`left in the table: ${JSON.stringify(drained)}`);

			if (sibling !== 'HIT') {
				const tail = instanceLog.join('').slice(-6000);

				// eslint-disable-next-line no-console
				console.info(`[recovery] instance log:\n${tail}`);
			}

			expect(sibling).toBe('HIT');
			expect(drained).toEqual([]);
		}, 60_000);

		it(oneLine`
			a purge that succeeds records nothing — the table is written on failure only,
			so it stays empty on every normal write
		`, async () => {
			await emptyCache();
			await db(PENDING).delete();

			await cachedRead(readNote);

			await request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${readNote}`)
				.send({ subject: `renamed-${Date.now()}` })
				.set('Authorization', auth);

			expect((await get(readNote)).headers[cacheStatusHeader]).toBe('MISS');
			expect(await db(PENDING).select('id')).toEqual([]);
		});
	});
});
