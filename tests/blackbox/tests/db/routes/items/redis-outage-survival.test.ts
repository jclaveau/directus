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
// It is the shape that found the bugs in the first place, and the shape that keeps
// the story honest. A node-redis client rethrows what nobody listens to and Node
// turns an unhandled rejection into an uncaught exception, so those two really did
// end the process — and a dead server answers ECONNRESET, which names nothing, so
// the instance's own log is captured and reported here instead. An ioredis client
// does not: it `console.error`s every failed reconnect to stderr, which is why what
// is asserted below is the shape of the log and not only that something is alive.
//
// `scheduleSynchronizedJob` is in scope too, and it is why the outage lasts as long
// as it does: its claim is a Redis write, so a tick landing mid-outage was the fifth
// way to exit. The cache-stats flush already runs on `*/10 * * * * *`, the shortest
// schedule in the codebase, so one cut held past ten seconds lands a tick — no new
// knob and no minute-long wait.
//
// Two clients reach the outage only under a setting: `SynchronizationManagerRedis`
// and the per-IP rate limiter each build a `new Redis(…)` of their own instead of
// sharing `useRedis()`, so they are invisible to a default-configured instance. The
// first is switched on below; the second gets an instance to itself, so that the
// traffic this file drives is not also spending rate-limiter tokens.

const NOTE = 'test_items_outage_note';

// Reads per outage in the repeated-outage case, deliberately unequal. The property
// under test is that the log grows with the ways a connection can fail and not with
// the number of requests that meet the failure — and two windows of the same size
// cannot tell those two apart, whatever constant they are measured against.
const READS_PER_OUTAGE = [3, 12];

// The per-IP budget the rate-limiter instance runs with. Small, because the case
// spends several times over it while Redis is down to show nothing refuses, then
// lets what Redis still holds run out once it is back.
const LIMITER_POINTS = 5;

// A timeout kills a case before any assertion runs and before the instance log is
// read, so the only way a failure names the phase that stalled is for each phase to
// say when it finished. Printed, not collected — and module-level, because both
// describes here have phases worth naming.
const startedAt = Date.now();

function mark(phase: string) {
	// eslint-disable-next-line no-console
	console.info(`[outage] ${Date.now() - startedAt}ms ${phase}`);
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

			// Brings the only sub-minute scheduled job into the test: `cache-stats`
			// flushes on `*/10 * * * * *`, and its synchronized claim is the Redis write
			// that used to take the process down when a tick met an outage.
			env[vendor]['CACHE_STATS_ENABLED'] = 'true';

			// And makes that claim a Redis write at all. The synchronization store
			// defaults to memory, where the clock writes to a plain object and cannot
			// fail — so under the default the scheduler guard is unreachable and
			// asserting on it proves nothing. It also puts a client in the outage that
			// no other setting reaches: `SynchronizationManagerRedis` builds its own
			// `new Redis(…)` instead of sharing `useRedis()`.
			env[vendor]['SYNCHRONIZATION_STORE'] = 'redis';

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
			// Awaited: the shard reuses the port range straight away, and an instance
			// still shutting down is still holding its port.
			if (instance.exitCode === null) {
				const exited = new Promise((resolve) => instance.once('exit', resolve));
				instance.kill();
				await exited;
			}

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
			keeps serving reads with Redis gone, survives a scheduled tick landing in the
			outage, and caches again once it is back — the cache is a dependency, so
			losing it must cost hit ratio and nothing else
		`, async () => {
			expect((await get(`/items/${NOTE}/${note}`)).headers[cacheStatusHeader])
				.toBe('MISS');

			expect((await get(`/items/${NOTE}/${note}`)).headers[cacheStatusHeader])
				.toBe('HIT');

			mark('warmed');

			// Everything the outage writes to the log arrives after this index, so the
			// volume assertion below cannot be fooled by a line from boot.
			const logAtCut = instanceLog.length;

			await proxy.cut();
			mark('redis cut');

			// The listeners are what make this reachable at all: unhandled, the errors
			// ioredis emits per failed reconnect end the process, and this request would
			// come back ECONNRESET rather than 200.
			const askedAt = Date.now();

			const served = await get(`/items/${NOTE}/${note}`)
				.catch(async (error: Error) => {
					await assertInstanceAlive();
					throw error;
				});

			const servedIn = Date.now() - askedAt;

			mark(`read served with redis down in ${servedIn}ms`);
			await assertInstanceAlive();

			expect(served.status).toBe(200);
			expect(served.body.data.subject).toBe('read');

			// A cache read fails open, so the entry that was HIT a moment ago now reads
			// as a MISS rather than serving, throwing, or — as it did before
			// `disableOfflineQueue` — blocking until Redis came back.
			expect(served.headers[cacheStatusHeader]).toBe('MISS');

			// Named rather than left to the case's own timeout, which reports "the test
			// took too long" for a request that answered in its own time. Without
			// `disableOfflineQueue` node-redis holds the read in a queue with no deadline
			// and this arrives when Redis does; with it, the read is one uncached query.
			expect(servedIn).toBeLessThan(5_000);

			// Nothing else went with it: a route that never touches the cache still
			// answers, which separates "the cache is degraded" from "the app is hurt".
			expect((await request(getUrl(vendor, env)).get('/server/ping')).text)
				.toBe('pong');

			mark('ping answered');

			// Hold the outage past a `*/10` boundary so a cache-stats tick lands inside
			// it. The claim rejects about a second after the cut (20 reconnect attempts
			// at the delays set above), and node-schedule drops the promise it returns —
			// so before the guard this was the last thing the process did.
			//
			// Read off the instance's log rather than from survival alone: "still alive
			// after a wait" also passes when no tick ever fired, which would make this
			// a test of nothing.
			// Matched on the unquoted prefix: the guard logs the job id in double quotes
			// and the logger emits JSON, so `"cache-stats"` reaches the log escaped and a
			// literal match on it never fires. Any job failing here is this guard.
			let tickSurvived = false;

			for (let attempt = 0; attempt < 50; attempt++) {
				if (instanceLog.join('').includes('[schedule] job')) {
					tickSurvived = true;
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			mark(`scheduled tick seen=${tickSurvived}`);

			// A tick that never fires and a tick whose log went unrecognised fail the
			// same way, and the difference is only visible in the instance's own output.
			if (tickSurvived === false) {
				// eslint-disable-next-line no-console
				console.info(`[outage] instance log:\n${instanceLog.join('').slice(-6000)}`);
			}

			expect(tickSurvived).toBe(true);
			await assertInstanceAlive();

			// Traffic, so the volume assertions below can tell an outage-sized log from a
			// traffic-sized one. Every one of these reads asks the cache and is refused.
			const READS_UNDER_OUTAGE = 12;

			for (let read = 0; read < READS_UNDER_OUTAGE; read++) {
				expect((await get(`/items/${NOTE}/${note}`)).status).toBe(200);
			}

			mark(`${READS_UNDER_OUTAGE} reads served with redis down`);

			const outageLog = instanceLog.slice(logAtCut).join('');

			// The outage is reported, and reported ONCE. At the retry delays set above
			// the client reconnects every few tens of ms, so the ~12s spent waiting for
			// a scheduled tick is a few hundred failed attempts — one warning each would
			// fill a disk over a real outage. Both bounds matter: the upper one is the
			// throttle, the lower one keeps the assertion from passing because the label
			// changed and it now counts nothing.
			const reported = outageLog.split('[redis] ').length - 1;

			mark(`redis outage warnings=${reported}`);
			expect(reported).toBeGreaterThanOrEqual(1);
			expect(reported).toBeLessThanOrEqual(5);

			// Each Keyv store reports its own failures too, and `disableOfflineQueue`
			// turned those from "never, the command waits" into "once per refused
			// command" — a log that grows with traffic instead of with the outage, which
			// is the flood the connection-level throttle exists to prevent, moved to the
			// request path. Bounded well under the reads that provoked it.
			const storeReported = outageLog.split('[response-cache]').length - 1;

			// Named, not just counted: a number over the bound says the throttle let
			// something through but not what, and the instance's log is gone by the time
			// the failure is read. One line per distinct message is what a working
			// throttle should leave behind anyway.
			const storeFailures = new Set(
				outageLog
					.split('\n')
					.filter((line) => line.includes('[response-cache]'))
					.map((line) => line.slice(line.indexOf('[response-cache]'), 160)),
			);

			mark(`response-cache warnings=${storeReported}`);

			for (const failure of storeFailures) {
				mark(`response-cache failure: ${failure}`);
			}

			expect(storeReported).toBeGreaterThanOrEqual(1);
			expect(storeReported).toBeLessThan(READS_UNDER_OUTAGE);

			// Both listeners live, and each line saying which of them raised it: a socket
			// that dropped and a command the store could not send over one are answered
			// in different places, and read identically without this.
			expect(outageLog).toContain('[response-cache] connection:');
			expect(outageLog).toContain('[response-cache] store:');

			// And under the cache's own name rather than a label the four clients share,
			// which would name none of them.
			expect(outageLog).not.toContain('[cache-store]');

			// Nothing reports around the logger. ioredis writes the stack of every
			// failed reconnect straight to stderr when nobody is listening for it —
			// unlevelled, unredacted and unthrottled — and an unlistened client is the
			// only way that happens. This outage measured 124 of them before the
			// synchronization client got its listener.
			expect(outageLog).not.toContain('[ioredis] Unhandled error event');

			await proxy.open();
			mark('redis back');

			// Reconnecting restores caching rather than merely leaving the process up.
			// Polled, because the reconnect backoff is asynchronous.
			let status: string | undefined;

			for (let attempt = 0; attempt < 24; attempt++) {
				// One request per attempt: the first fills the entry, the next reads it as
				// a HIT, so alternating attempts is what actually converges.
				status = (await get(`/items/${NOTE}/${note}`)).headers[cacheStatusHeader];

				if (status === 'HIT') {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 250));
			}

			mark(`caching again status=${status}`);
			expect(status).toBe('HIT');
			await assertInstanceAlive();
		}, 180_000);

		it(oneLine`
			hears the outages after the first one, with working calls in between — a
			throttle is per outage, and one that fills and never empties passes every
			single-outage assertion and then goes quiet for good
		`, async () => {
			// The defect this covers was a sequence, not a state: two failures that
			// alternate defeated a throttle comparing against the last one only, and no
			// amount of one steady outage would have shown it. Line coverage says the
			// handler ran; only a run of outages says what it does the second time.
			const reportedPerOutage: number[] = [];

			for (const [index, reads] of READS_PER_OUTAGE.entries()) {
				const outage = index + 1;
				const logAtCut = instanceLog.length;

				await proxy.cut();

				// Cache-eligible and cache-free requests interleaved, so failing and
				// working calls alternate through the same window rather than arriving as
				// one uniform run.
				for (let read = 0; read < reads; read++) {
					expect((await get(`/items/${NOTE}/${note}`)).status).toBe(200);

					expect((await request(getUrl(vendor, env)).get('/server/ping')).text)
						.toBe('pong');
				}

				const cycleLog = instanceLog.slice(logAtCut).join('');
				const reported = cycleLog.split('[response-cache]').length - 1;

				reportedPerOutage.push(reported);
				mark(`outage ${outage}: ${reads} reads, warnings=${reported}`);

				// A window that reports nothing and a window whose lines landed somewhere
				// else fail the same way, and the throttle only rearms on the client's own
				// `ready` — not on the proxy reopening — so a silent window is a real
				// answer and needs to say so rather than be guessed at afterwards.
				for (const line of new Set(
					cycleLog
						.split('\n')
						.filter((entry) => entry.includes('[response-cache]'))
						.map((entry) => entry.slice(entry.indexOf('[response-cache]'), 150)),
				)) {
					mark(`outage ${outage}: ${line}`);
				}

				// Nothing routed around the logger during this window either — the raw
				// stderr dump is per failed reconnect, so a second outage is where a
				// listener that was somehow dropped on recovery would show.
				expect(cycleLog).not.toContain('[ioredis] Unhandled error event');

				await proxy.open();

				let status: string | undefined;

				for (let attempt = 0; attempt < 24; attempt++) {
					status = (await get(`/items/${NOTE}/${note}`)).headers[cacheStatusHeader];

					if (status === 'HIT') {
						break;
					}

					await new Promise((resolve) => setTimeout(resolve, 250));
				}

				mark(`outage ${outage}: caching again status=${status}`);
				expect(status).toBe('HIT');
				await assertInstanceAlive();

				// A HIT proves commands work again, which is not quite the same as the
				// client having announced it: the throttle rearms on `ready`, so cutting
				// again before that lands would make the next window a continuation of
				// this outage rather than a new one, and legitimately silent.
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			const [quiet, busy] = reportedPerOutage as [number, number];
			const [quietReads, busyReads] = READS_PER_OUTAGE as [number, number];

			// Reported at all, both times. A throttle that fills and never empties goes
			// silent after the first outage, which every one-outage assertion passes.
			expect(quiet).toBeGreaterThanOrEqual(1);
			expect(busy).toBeGreaterThanOrEqual(1);

			// And the extra requests must not buy proportional lines. Stated as a slope
			// rather than a constant, because how many distinct ways a connection fails
			// is the client's business and not this test's: nine more requests may not
			// cost more than four more lines. Measured at three either way — a closed
			// socket, an offline client and a dual-stack connect — so the headroom here
			// belongs to the throttle rather than to luck. Reporting per refused command
			// lands on nine.
			expect(busy - quiet).toBeLessThan((busyReads - quietReads) / 2);
		}, 180_000);
	});
});

describe('the API outlives an unreachable Redis behind the rate limiter', () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		const instanceLog: string[] = [];

		let proxy: ReturnType<typeof createRedisProxy>;
		let instance: ChildProcess;

		beforeAll(async () => {
			const proxyPort = await getPort();
			proxy = createRedisProxy(6108, proxyPort);
			await proxy.open();

			env[vendor]['REDIS_HOST'] = 'localhost';
			env[vendor]['REDIS_PORT'] = String(proxyPort);

			env[vendor]['RATE_LIMITER_ENABLED'] = 'true';
			env[vendor]['RATE_LIMITER_STORE'] = 'redis';

			// Charged above the cache, so `/server/ping` spends a token and one request
			// is enough to make the limiter talk to Redis.
			env[vendor]['RATE_LIMITER_CHARGE'] = 'every-request';
			// Small enough to spend several times over during the outage, and to run out
			// in a few requests once Redis is counting again.
			env[vendor]['RATE_LIMITER_POINTS'] = String(LIMITER_POINTS);
			env[vendor]['RATE_LIMITER_DURATION'] = '60';

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

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			if (instance.exitCode === null) {
				const exited = new Promise((resolve) => instance.once('exit', resolve));
				instance.kill();
				await exited;
			}

			await proxy.cut();
		});

		it(oneLine`
			stops limiting rather than refusing while Redis is gone, reports the outage
			through the logger, and limits again from where Redis left off once it is back
		`, async () => {
			expect((await request(getUrl(vendor, env)).get('/server/ping')).text)
				.toBe('pong');

			const logAtCut = instanceLog.length;

			await proxy.cut();

			// Charged against a Redis that is gone. The limiter falls back to counting in
			// this process, so the request is served rather than answered 500 —
			// `rate-limiter-ip` rethrows anything that is an Error, so without the
			// fallback a Redis outage takes every charged route down with it. The count
			// is per process while the fallback is in use, which under-enforces the limit
			// for the length of the outage and is the trade being made.
			const askedAt = Date.now();

			expect((await request(getUrl(vendor, env)).get('/server/ping')).text)
				.toBe('pong');

			const servedIn = Date.now() - askedAt;

			mark(`charged request served with redis down in ${servedIn}ms`);

			// Named, rather than left to the case's own timeout to report as "too long".
			// Without `rejectIfRedisNotReady` the limiter sends the command anyway and
			// reaches its fallback only once ioredis gives up — about ten seconds at the
			// defaults its own client is built with, since `REDIS_RETRY_*` never reaches
			// it — so every charged request stalls for that. Failing open that slowly is
			// not meaningfully different from failing closed.
			expect(servedIn).toBeLessThan(5_000);

			// Well past the configured budget, and none of it refused: while the store is
			// unreachable there is no limit, rather than a per-process one. A fallback
			// that counted here would refuse around the fifth of these and would be
			// enforcing a number nobody configured — N instances each granting the whole
			// budget is not the limit that was asked for.
			const answers = [];

			for (let charged = 0; charged < LIMITER_POINTS * 3; charged++) {
				const answer = await request(getUrl(vendor, env)).get('/server/ping');

				answers.push(answer.status);
			}

			mark(`${answers.length} charged requests under the outage, none refused`);
			expect(answers).not.toContain(429);

			// Long enough for several reconnect attempts at the delays set above, which
			// is what makes the volume below mean something.
			await new Promise((resolve) => setTimeout(resolve, 2000));

			const outageLog = instanceLog.slice(logAtCut).join('');

			// Control: it degrades, it does not die. ioredis reports connection errors
			// through `silentEmit`, which does not throw at an empty listener list, so
			// this passes either way — it is here to say which failure the rest is about.
			expect(instance.exitCode, `the instance exited:\n${outageLog.slice(-4000)}`)
				.toBeNull();

			// What `silentEmit` does instead: `console.error` the stack of every failed
			// reconnect, straight to stderr, outside the logger and outside any throttle.
			expect(outageLog).not.toContain('[ioredis] Unhandled error event');

			// Reported through the logger and named for the limiter, so the line says
			// which client dropped rather than leaving four candidates.
			expect(outageLog).toContain('[rate-limiter]');

			// And the limit comes back on its own. Redis kept its counters and their TTLs
			// through the outage, so counting resumes from what it still holds rather
			// than from zero — the budget was already partly spent before the cut, and
			// what is left of it runs out here. Polled, because the limiter goes on using
			// the fallback until its client reports ready again.
			await proxy.open();

			let refusedAfterRecovery = false;

			for (let attempt = 0; attempt < 40; attempt++) {
				const answer = await request(getUrl(vendor, env)).get('/server/ping');

				if (answer.status === 429) {
					refusedAfterRecovery = true;
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, 250));
			}

			mark(`limiting again after recovery=${refusedAfterRecovery}`);
			expect(refusedAfterRecovery).toBe(true);
		}, 120_000);
	});
});
