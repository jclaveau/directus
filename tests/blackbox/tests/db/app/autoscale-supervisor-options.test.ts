import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import {
	countWorkers,
	declaredEverywhere,
	poolSize,
	reportOf,
	startAutoscaler,
	startPool,
	stopRig,
	type Rig,
} from './autoscale/rig';

// Six pm2 options are changeable from the admin panel, and every one of them
// travels the same route: stored in Redis, picked up by the rolling restart
// that carries it, pushed as a declaration the replacement worker boots under.
//
// That last step is a claim about pm2's own internals — it checks a reload's
// options against its command-line schema and drops what it does not find
// there, so the declaration only survives while it is told the options have
// been checked already. Nothing below the supervisor can falsify that, which
// is why it is asserted here against a real daemon rolling real workers.
//
// The Redis on 6108 is shared, so the rig owns a namespace and its key.
const REDIS_PORT = 6108;

// What `useBus` publishes on: the channel is namespaced by the bus rather than
// by the deployment, so it is the same one for every process on this Redis.
const RELOAD_CHANNEL = 'directus:bus:autoscaleReload';

function supervisorKey(namespace: string): string {
	return `${namespace}:config:processes:supervisor`;
}

describe('A restart carries the supervisor options stored for it', () => {
	const redis = new Redis({ host: 'localhost', port: REDIS_PORT });
	const namespace = 'bb-autoscale-supervisor-options';
	const rigs: Rig[] = [];

	afterAll(async () => {
		for (const rig of rigs) {
			stopRig(rig);
		}

		await redis.del(supervisorKey(namespace));
		redis.disconnect();
	});

	let rig: Rig;

	// A restart is asked for on the bus, and pub/sub keeps nothing for a
	// subscriber that is not there yet: an arm that published while the
	// autoscaler was still booting would lose the ask and time out against a
	// pool nobody ever restarted. The pool starts one worker under the floor so
	// that the size below can only be reached by a loop that is running, which
	// is a loop that has already subscribed.
	it('waits for a loop that has subscribed to the restarts', async () => {
		await redis.del(supervisorKey(namespace));

		// The ecosystem declares 10s and the environment asks for 12s, so the
		// three values an arm can see are all distinct: 21s is the shared settings,
		// 12s is the environment a release goes back to, and 10s is a restart
		// that pushed nothing at all.
		rig = startPool({
			appName: 'autoscale-supervisor-options',
			instances: 1,
			busyMs: 5,
			idleMs: 95,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'true',
			REDIS_HOST: 'localhost',
			REDIS_PORT: String(REDIS_PORT),
			CACHE_NAMESPACE: namespace,
			PM2_LISTEN_TIMEOUT: '12000',
			// Bounds that meet above the size the pool booted at, so the climb
			// is the floor's doing and no threshold can move it afterwards:
			// past this arm the only thing that replaces a worker here is the
			// restart each arm asks for.
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '2',
			PM2_AUTOSCALE_MAX_WORKERS: '2',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		expect(await poolSize(rig, 2, 60_000), reportOf(rig)).toBe(2);

		// What the pool started them on, which is what the arms below have to
		// move for their assertions to mean anything.
		expect(await declaredEverywhere(rig, 'listen_timeout', 10_000, 30_000))
			.toEqual([10_000, 10_000]);
	}, 90_000);

	it('pushes a stored option to every worker it replaces', async () => {
		await redis.set(
			supervisorKey(namespace),
			JSON.stringify({ listenTimeout: 21_000, setBy: 'blackbox' }),
		);

		await redis.publish(RELOAD_CHANNEL, JSON.stringify({ at: Date.now() }));

		expect(
			await declaredEverywhere(rig, 'listen_timeout', 21_000, 120_000),
			reportOf(rig),
		).toEqual([21_000, 21_000]);

		// A roll, not a scale: the pool holds two workers on the other side of
		// it, and an arm that only read the declaration could not tell a
		// restart that replaced them from one that grew the pool instead.
		expect(countWorkers(rig), reportOf(rig)).toBe(2);
	}, 150_000);

	// pm2 keeps whatever the last roll pushed, so a field taken out of the
	// shared settings reverts only because the next restart declares the environment's
	// value in its place. Without that this arm would find 21s still there.
	it('hands a released option back to the environment', async () => {
		await redis.del(supervisorKey(namespace));
		await redis.publish(RELOAD_CHANNEL, JSON.stringify({ at: Date.now() }));

		expect(
			await declaredEverywhere(rig, 'listen_timeout', 12_000, 120_000),
			reportOf(rig),
		).toEqual([12_000, 12_000]);
	}, 150_000);
});
