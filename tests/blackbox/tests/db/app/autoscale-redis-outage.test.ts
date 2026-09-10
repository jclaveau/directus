import Redis from 'ioredis';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import {
	neverExceeded,
	poolSize,
	startAutoscaler,
	startPool,
	stopRig,
	type Rig,
} from './autoscale/rig';

// Redis holds the values an operator changes during an incident, which is
// precisely when Redis is a plausible thing to lose. What the autoscaler owes
// the pool then is to keep deciding: an outage that only cost it the freshest
// configuration is survivable, one that stops it deciding at all leaves the
// pool frozen at the size the incident caught it at.
const REDIS_PORT = 6108;

// Nothing listens here, which is the Redis that is unreachable from the first
// tick rather than one lost part-way through.
const DEAD_PORT = 6110;

function configKey(namespace: string): string {
	return `${namespace}:config:pm2`;
}

interface Proxy {
	server: Server;
	live: Set<Socket>;
	/** The port the hop took, which the autoscaler is pointed at. */
	port: number;
}

/**
 * A TCP hop of this suite's own in front of the shared Redis, so one
 * autoscaler's connection can be cut without touching the instance the other
 * suites are using.
 *
 * On a port the kernel picks rather than one this file chose: a runner is a
 * shared machine, and a hop that cannot take the port it wanted is a suite that
 * fails for a reason that has nothing to do with autoscaling.
 */
function startProxy(): Promise<Proxy> {
	const live = new Set<Socket>();

	const server = createServer((client) => {
		const upstream = connect(REDIS_PORT, '127.0.0.1');

		live.add(client);
		live.add(upstream);

		client.pipe(upstream);
		upstream.pipe(client);

		for (const socket of [client, upstream]) {
			socket.on('error', () => socket.destroy());
			socket.on('close', () => live.delete(socket));
		}
	});

	return new Promise((resolve, reject) => {
		// Listening is what fails when the port is taken, and it fails by event:
		// unhandled, the promise never settles and the arm dies of its timeout
		// with nothing to say.
		server.once('error', reject);

		server.listen(0, '127.0.0.1', () => {
			const address = server.address();

			if (address === null || typeof address === 'string') {
				reject(new Error('the hop did not take a TCP port'));

				return;
			}

			resolve({ server, live, port: address.port });
		});
	});
}

/** Drops what is connected and refuses what tries to connect after. */
function cutProxy(proxy: Proxy): void {
	// `close` stops the server accepting as it is called, which is the whole of
	// what a cut needs; its callback waits out the connections still open, and
	// waiting on that is a way for this to hang rather than fail.
	proxy.server.close();

	for (const socket of proxy.live) {
		socket.destroy();
	}

	proxy.live.clear();
}

function restoreProxy(proxy: Proxy): Promise<void> {
	return new Promise((resolve, reject) => {
		proxy.server.once('error', reject);

		proxy.server.listen(proxy.port, '127.0.0.1', () => {
			resolve();
		});
	});
}

/**
 * Waits for a line the autoscaler logs, which is what says it took a tick at
 * all — a pool at the size an arm expects says nothing about whether the loop
 * is still running or stopped there.
 */
async function loggedLine(
	rig: Rig,
	fragment: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (rig.logs.join('').includes(fragment)) {
			return true;
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 250);
		});
	}

	return false;
}

describe('The autoscaler decides through a Redis outage', () => {
	const redis = new Redis({ host: 'localhost', port: REDIS_PORT });
	const rigs: Rig[] = [];
	const namespaces: string[] = [];
	const proxies: Proxy[] = [];

	afterAll(async () => {
		for (const rig of rigs) {
			stopRig(rig);
		}

		for (const namespace of namespaces) {
			await redis.del(configKey(namespace));
		}

		for (const proxy of proxies) {
			cutProxy(proxy);
		}

		redis.disconnect();
	});

	describe('losing a Redis it had already read', () => {
		const namespace = 'bb-autoscale-outage';
		let rig: Rig;
		let proxy: Proxy;

		it('grows on the shared config read before the connection dropped', async () => {
			namespaces.push(namespace);

			// A ceiling of three where the env chain allows one, so every size
			// above one is the shared config still in force and nothing else.
			await redis.set(
				configKey(namespace),
				JSON.stringify({ scaleCpuThreshold: 5, maxWorkers: 3 }),
			);

			proxy = await startProxy();
			proxies.push(proxy);

			rig = startPool({
				appName: 'autoscale-outage',
				instances: 1,
				busyMs: 20,
				idleMs: 80,
			});

			rigs.push(rig);

			startAutoscaler(rig, {
				REDIS_ENABLED: 'true',
				REDIS_HOST: '127.0.0.1',
				REDIS_PORT: String(proxy.port),
				CACHE_NAMESPACE: namespace,
				PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
				PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
				PM2_AUTOSCALE_MIN_WORKERS: '1',
				PM2_AUTOSCALE_MAX_WORKERS: '1',
				// One worker per ten seconds, so the pool is still short of the
				// shared config's ceiling when the connection is cut and the growth
				// that finishes the climb is decided without Redis.
				PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '10',
				// Long enough that the pool is reporting its load rather than its
				// boot: a worker's CPU percent is cumulative over its short life, so
				// one just out of a two-second warm-up still reads mostly as the
				// second it spent starting — on a loaded runner, near 100%, which
				// clears any threshold an arm like this sets out of reach.
				PM2_AUTOSCALE_WARMUP_SECONDS: '8',
			});

			expect(await poolSize(rig, 2, 60_000)).toBe(2);

			cutProxy(proxy);

			// The warning is the loop reporting a tick it completed without
			// Redis; the third worker is that tick acting on the ceiling only
			// the shared config carries.
			expect(await loggedLine(rig, 'holding the last configuration', 30_000))
				.toBe(true);

			expect(await poolSize(rig, 3, 60_000)).toBe(3);
			// Three waits of a minute apiece, and a runner slow enough to need
			// them is the runner this arm has to survive.
		}, 240_000);

		it('takes a new shared config once Redis answers again', async () => {
			await redis.set(
				configKey(namespace),
				JSON.stringify({ scaleCpuThreshold: 5, maxWorkers: 2 }),
			);

			await restoreProxy(proxy);

			expect(await poolSize(rig, 2, 90_000)).toBe(2);
		}, 120_000);
	});

	// The outage the env chain is the fallback for: a deploy that comes up
	// while Redis is down has no configuration to hold, and a pool with no
	// autoscaler at all is the worst of the outcomes available.
	it('uses the env chain when Redis has never answered', async () => {
		const namespace = 'bb-autoscale-outage-cold';
		namespaces.push(namespace);

		// Reachable only to this suite, so a pool that grows past two is one
		// that read it.
		await redis.set(
			configKey(namespace),
			JSON.stringify({ maxWorkers: 3 }),
		);

		const rig = startPool({
			appName: 'autoscale-outage-cold',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'true',
			REDIS_HOST: '127.0.0.1',
			REDIS_PORT: String(DEAD_PORT),
			CACHE_NAMESPACE: namespace,
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '5',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
			// Long enough that the pool is reporting its load rather than its
			// boot: a worker's CPU percent is cumulative over its short life, so
			// one just out of a two-second warm-up still reads mostly as the
			// second it spent starting — on a loaded runner, near 100%, which
			// clears any threshold an arm like this sets out of reach.
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		expect(await poolSize(rig, 2, 60_000)).toBe(2);
		expect(await neverExceeded(rig, 2, 10_000)).toBe(2);
	}, 120_000);
});
