import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import net from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The one test that would have caught every listener this PR adds. Each of them is
// unit-tested where it lives, but a unit test asserts that a handler was registered
// against a mocked client — it cannot assert what this does: that a real process,
// serving real requests, is still there after its Redis goes away.
//
// It is the shape that found the bugs in the first place. An EventEmitter with no
// `error` listener rethrows and Node turns an unhandled rejection into an uncaught
// exception, so every missing handler ended the process, and a dead server answers
// ECONNRESET — which names nothing. Hence the instance's own log is captured and
// reported here instead.
//
// What it does NOT cover: `scheduleSynchronizedJob`. Its claim is a Redis write,
// so a tick landing during an outage was a fifth way to exit, but no scheduled job
// fires inside a test's patience — that one stays unit-only.

const NOTE = 'test_items_outage_note';
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

describe('the API outlives an unreachable Redis', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		let proxy: ReturnType<typeof createRedisProxy>;
		let instance: ChildProcess;
		let note: number;

		const instanceLog: string[] = [];
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: NOTE,
						fields: [{ field: 'subject', type: 'string', meta: {} }],
					},
				],
			});

			const [created] = await CreateItem(vendor, {
				collection: NOTE,
				item: [{ subject: 'read' }],
			});

			note = created.id;

			const proxyPort = await getPort();
			proxy = createRedisProxy(6108, proxyPort);
			await proxy.open();

			// Every Redis consumer at once, which is the point: the shared ioredis
			// client, the bus subscriber it duplicates, and one node-redis client per
			// Keyv store all reach the same proxy and all lose it together.
			env[vendor]['CACHE_ENABLED'] = 'true';
			env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			env[vendor]['CACHE_STORE'] = 'redis';
			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = String(proxyPort);
			env[vendor]['CACHE_NAMESPACE'] = `directus-outage-${vendor}`;

			// The stock backoff gives up on a queued command after ~30s; this brings the
			// whole outage inside a test's patience and reconnects within one poll of
			// the proxy returning.
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
			await proxy.cut();
			await DeleteCollection(vendor, { collection: NOTE });
		});

		// Waits first: the socket dies before the child is reaped, so reading `exitCode`
		// the moment a request rejects still reports a live process.
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

		function get(path: string) {
			return request(getUrl(vendor, env))
				.get(path)
				.set('Authorization', auth);
		}

		it(oneLine`
			keeps serving reads with Redis gone, then caches again once it is back — the
			cache is a dependency, so losing it must cost hit ratio and nothing else
		`, async () => {
			expect((await get(`/items/${NOTE}/${note}`)).headers[cacheStatusHeader])
				.toBe('MISS');

			expect((await get(`/items/${NOTE}/${note}`)).headers[cacheStatusHeader])
				.toBe('HIT');

			await proxy.cut();

			// The listeners are what make this reachable at all: unhandled, the errors
			// ioredis emits per failed reconnect end the process, and this request would
			// come back ECONNRESET rather than 200.
			const served = await get(`/items/${NOTE}/${note}`)
				.catch(async (error: Error) => {
					await assertInstanceAlive();
					throw error;
				});

			await assertInstanceAlive();

			expect(served.status).toBe(200);
			expect(served.body.data.subject).toBe('read');

			// A cache read fails open, so the entry that was HIT a moment ago now reads
			// as a MISS rather than serving or throwing.
			expect(served.headers[cacheStatusHeader]).toBe('MISS');

			// Nothing else went with it: a route that never touches the cache still
			// answers, which separates "the cache is degraded" from "the app is hurt".
			expect((await request(getUrl(vendor, env)).get('/server/ping')).text)
				.toBe('pong');

			await proxy.open();

			// Reconnecting restores caching rather than merely leaving the process up.
			// Polled, because the reconnect backoff is asynchronous.
			let status: string | undefined;

			for (let attempt = 0; attempt < 40; attempt++) {
				await get(`/items/${NOTE}/${note}`);
				status = (await get(`/items/${NOTE}/${note}`)).headers[cacheStatusHeader];

				if (status === 'HIT') {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 250));
			}

			expect(status).toBe('HIT');
			await assertInstanceAlive();
		}, 60_000);
	});
});
