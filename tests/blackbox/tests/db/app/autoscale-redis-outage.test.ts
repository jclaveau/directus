import vendors from '@common/get-dbs-to-test';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import {
	closeSharedSettings,
	databaseEnv,
	decisionAfter,
	decisionsOf,
	neverExceeded,
	poolSize,
	reportOf,
	startAutoscaler,
	startPool,
	stopRig,
	storeSharedSettings,
	type Rig,
} from './autoscale/rig';

// Redis carries the announcement that a value an operator changes during an
// incident has moved, which is precisely when Redis is a plausible thing to
// lose. What the autoscaler owes the pool then is to keep deciding, and to keep
// deciding on the values themselves: the settings are where they live, and an
// outage of the transport must cost freshness rather than the whole layer.
const REDIS_PORT = 6108;

// One vendor: what an outage costs is the same wherever the settings are kept,
// and each rig that can tell costs a pm2 daemon and a pool under load.
const vendor = vendors[0]!;

// Nothing listens here, which is the Redis that is unreachable from the first
// tick rather than one lost part-way through.
const DEAD_PORT = 6110;

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

describe('The autoscaler decides through a Redis outage', () => {
	const rigs: Rig[] = [];
	const proxies: Proxy[] = [];

	afterAll(async () => {
		for (const rig of rigs) {
			stopRig(rig);
		}

		for (const proxy of proxies) {
			cutProxy(proxy);
		}

		await storeSharedSettings(vendor, 'autoscale_settings', null);
		await closeSharedSettings();
	});

	describe('losing the Redis its announcements come over', () => {
		let rig: Rig;
		let proxy: Proxy;

		it('grows on the settings the outage cannot reach', async () => {
			// A ceiling of three where the env chain allows one, so every size
			// above one is the stored layer still in force and nothing else.
			await storeSharedSettings(vendor, 'autoscale_settings', {
				scaleCpuThreshold: 5,
				maxWorkers: 3,
			});

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
				...databaseEnv(vendor),
				REDIS_ENABLED: 'true',
				REDIS_HOST: '127.0.0.1',
				REDIS_PORT: String(proxy.port),
				PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
				PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
				PM2_AUTOSCALE_MIN_WORKERS: '1',
				PM2_AUTOSCALE_MAX_WORKERS: '1',
				// One worker per ten seconds, so the pool is still short of the
				// stored ceiling when the connection is cut and the growth that
				// finishes the climb is decided without Redis.
				PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '10',
				// Long enough that the pool is reporting its load rather than its
				// boot: a worker's CPU percent is cumulative over its short life, so
				// one just out of a two-second warm-up still reads mostly as the
				// second it spent starting — on a loaded runner, near 100%, which
				// clears any threshold an arm like this sets out of reach.
				PM2_AUTOSCALE_WARMUP_SECONDS: '8',
			});

			expect(await poolSize(rig, 2, 60_000)).toBe(2);

			const taken = decisionsOf(rig).length;
			cutProxy(proxy);

			// A decision line is the loop reporting a tick it completed without
			// Redis; the third worker is that tick acting on the ceiling only
			// the stored layer carries.
			expect(await decisionAfter(rig, taken, 60_000)).not.toEqual([]);

			expect(await poolSize(rig, 3, 60_000)).toBe(3);
			// Three waits of a minute apiece, and a runner slow enough to need
			// them is the runner this arm has to survive.
		}, 240_000);

		// The claim the whole layer rests on: what an operator writes during an
		// incident reaches a pool whose transport is down. Nothing announces
		// this one — the connection is cut — so the re-read floor is what
		// carries it, and a node that had lost the value with Redis would hold
		// three workers here forever.
		it('takes a change written while Redis is still down', async () => {
			await storeSharedSettings(vendor, 'autoscale_settings', {
				scaleCpuThreshold: 5,
				maxWorkers: 2,
			});

			expect(await poolSize(rig, 2, 120_000)).toBe(2);
		}, 180_000);

		it('is announced to again once Redis answers', async () => {
			await restoreProxy(proxy);

			await storeSharedSettings(vendor, 'autoscale_settings', {
				scaleCpuThreshold: 5,
				minWorkers: 1,
				maxWorkers: 1,
			});

			expect(await poolSize(rig, 1, 60_000)).toBe(1);
		}, 120_000);
	});

	// A deploy that comes up while Redis is down still has every value an
	// operator stored, because none of them was ever kept there: the pool it
	// starts is the one the settings ask for rather than the one the image was
	// built with.
	it('uses the stored settings when Redis has never answered', async () => {
		// A ceiling of three where the env chain allows two, so a pool that
		// grows past two is one that read the settings without Redis.
		await storeSharedSettings(vendor, 'autoscale_settings', {
			maxWorkers: 3,
		});

		const rig = startPool({
			appName: 'autoscale-outage-cold',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			...databaseEnv(vendor),
			REDIS_ENABLED: 'true',
			REDIS_HOST: '127.0.0.1',
			REDIS_PORT: String(DEAD_PORT),
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

		expect(await poolSize(rig, 3, 60_000), reportOf(rig)).toBe(3);
		expect(await neverExceeded(rig, 3, 10_000), reportOf(rig)).toBe(3);
	}, 120_000);
});
