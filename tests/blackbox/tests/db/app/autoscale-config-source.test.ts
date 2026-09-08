import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import {
	heldAt,
	poolSize,
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
		});

		// The same override grows the pool in the arms below; here it is
		// unreachable, so the env threshold is the only one in play.
		expect(await heldAt(rig, 1, 20_000)).toBe(true);
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
			});

			expect(await heldAt(rig, 1, 15_000)).toBe(true);
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
			expect(await heldAt(rig, 2, 15_000)).toBe(true);
		}, 90_000);
	});
});
