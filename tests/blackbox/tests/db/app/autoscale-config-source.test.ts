import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import {
	decisionsOf,
	neverExceeded,
	poolSize,
	restartsOf,
	sizesOver,
	startAutoscaler,
	startPool,
	stopRig,
	type Rig,
} from './autoscale/rig';

// Tuning an autoscaler by redeploying restarts the pool being tuned, so the
// values have to be changeable while it runs. What that costs is a second
// source of truth, and these arms pin which one wins: the env chain alone when
// Redis is not configured, the override the moment one is written, and the env
// chain again once it is removed.
//
// The Redis on 6108 is shared, so each rig owns a namespace and its key.
const REDIS_PORT = 6108;

function configKey(namespace: string): string {
	return `${namespace}:autoscale:config`;
}

describe('The autoscaler takes live configuration from Redis', () => {
	const redis = new Redis({ host: 'localhost', port: REDIS_PORT });
	const rigs: Rig[] = [];
	const namespaces: string[] = [];

	afterAll(async () => {
		for (const rig of rigs) {
			stopRig(rig);
		}

		for (const namespace of namespaces) {
			await redis.del(configKey(namespace));
		}

		redis.disconnect();
	});

	it('ignores an override when Redis is not configured', async () => {
		const namespace = 'bb-autoscale-envonly';
		namespaces.push(namespace);

		await redis.set(
			configKey(namespace),
			JSON.stringify({ scaleCpuThreshold: 5 }),
		);

		const rig = startPool({
			appName: 'autoscale-env-only',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'false',
			CACHE_NAMESPACE: namespace,
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
			// Long enough that the pool is reporting its load rather than its
			// boot: a worker's CPU percent is cumulative over its short life, so
			// one just out of a two-second warm-up still reads mostly as the
			// second it spent starting — on a loaded runner, near 100%, which
			// clears any threshold an arm like this sets out of reach.
			PM2_AUTOSCALE_WARMUP_SECONDS: '8',
		});

		// The same override grows the pool in the arms below; here it is
		// unreachable, so the env threshold is the only one in play.
		expect({
			sizes: await sizesOver(rig, 20_000),
			decisions: decisionsOf(rig),
		}).toEqual({ sizes: [1], decisions: [] });
	}, 90_000);

	describe('with Redis configured', () => {
		const namespace = 'bb-autoscale-live';
		let rig: Rig;

		it('uses the env chain while no override is stored', async () => {
			namespaces.push(namespace);
			await redis.del(configKey(namespace));

			rig = startPool({
				appName: 'autoscale-live',
				instances: 1,
				busyMs: 20,
				idleMs: 80,
			});

			rigs.push(rig);

			startAutoscaler(rig, {
				REDIS_ENABLED: 'true',
				REDIS_HOST: 'localhost',
				REDIS_PORT: String(REDIS_PORT),
				CACHE_NAMESPACE: namespace,
				PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
				PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
				PM2_AUTOSCALE_MIN_WORKERS: '1',
				PM2_AUTOSCALE_MAX_WORKERS: '3',
				PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
				// Long enough that the pool is reporting its load rather than its
				// boot: a worker's CPU percent is cumulative over its short life, so
				// one just out of a two-second warm-up still reads mostly as the
				// second it spent starting — on a loaded runner, near 100%, which
				// clears any threshold an arm like this sets out of reach.
				PM2_AUTOSCALE_WARMUP_SECONDS: '8',
			});

			// Everything a size this arm did not expect could have come from:
			// the decision that took it, and the restarts that would explain a
			// size the autoscaler never asked for.
			expect({
				sizes: await sizesOver(rig, 20_000),
				decisions: decisionsOf(rig),
				restarts: restartsOf(rig),
			}).toEqual({ sizes: [1], decisions: [], restarts: 0 });
		}, 90_000);

		it('picks up a stored threshold without being restarted', async () => {
			await redis.set(
				configKey(namespace),
				JSON.stringify({ scaleCpuThreshold: 5 }),
			);

			expect(await poolSize(rig, 3, 60_000)).toBe(3);
		}, 90_000);

		it('applies a lowered ceiling to a pool already above it', async () => {
			// Both fields, so the pool is shrunk by the new ceiling rather
			// than by the scale threshold reverting to the env's 95 at the
			// same moment.
			await redis.set(
				configKey(namespace),
				JSON.stringify({ scaleCpuThreshold: 5, maxWorkers: 2 }),
			);

			expect(await poolSize(rig, 2, 60_000)).toBe(2);
		}, 90_000);

		it('returns to the env chain once the override is removed', async () => {
			await redis.del(configKey(namespace));

			// The env ceiling is 3 again and its threshold is 95, so a pool
			// that keeps growing would mean the override was still applied.
			expect(await sizesOver(rig, 15_000)).toEqual([2]);
		}, 90_000);

		// The override is a hand-edited JSON document written during an
		// incident, so it is exactly where a zero too many arrives. Obeyed
		// literally it would ask pm2 for more workers than the box holds —
		// the failure this autoscaler exists to stop, arriving through its
		// own configuration.
		it('clamps an override asking past the ceiling to the ceiling', async () => {
			await redis.set(
				configKey(namespace),
				JSON.stringify({ minWorkers: 10_000 }),
			);

			// Three, because the env ceiling is three: the floor was applied,
			// so the override was read, and it was read as three.
			expect(await poolSize(rig, 3, 60_000)).toBe(3);
			expect(await neverExceeded(rig, 3, 10_000)).toBe(3);
		}, 120_000);

		// The second of the three rollback levers, after the strategy: pinning
		// the pool to a size somebody chose. The pool is at three and the load
		// clears the threshold, so both directions are witnessed at once — it
		// comes down to the pin, and stays there rather than climbing back.
		it('pins the pool where the floor and the ceiling meet', async () => {
			await redis.set(
				configKey(namespace),
				JSON.stringify({
					scaleCpuThreshold: 5,
					minWorkers: 2,
					maxWorkers: 2,
				}),
			);

			expect(await poolSize(rig, 2, 60_000)).toBe(2);
			expect(await neverExceeded(rig, 2, 15_000)).toBe(2);
		}, 120_000);

		// The last lever, and the bluntest: stop deciding. What it is for is an
		// autoscaler misreading a pool badly enough that no size it picks can be
		// trusted — so the test of it is a configuration it would obey, ignored.
		it('holds the pool where it is while autoscaling is disabled', async () => {
			await redis.set(
				configKey(namespace),
				JSON.stringify({
					enabled: false,
					scaleCpuThreshold: 5,
					minWorkers: 1,
					maxWorkers: 1,
				}),
			);

			expect(await sizesOver(rig, 20_000)).toEqual([2]);
		}, 90_000);

		// And the freeze is the flag, not the pool having run out of reasons to
		// move: the same override with the flag turned back on empties it to the
		// ceiling it was carrying all along.
		it('acts on that same override once it is enabled again', async () => {
			await redis.set(
				configKey(namespace),
				JSON.stringify({
					enabled: true,
					scaleCpuThreshold: 5,
					minWorkers: 1,
					maxWorkers: 1,
				}),
			);

			expect(await poolSize(rig, 1, 60_000)).toBe(1);
		}, 90_000);
	});
});
