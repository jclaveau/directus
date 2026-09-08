import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import {
	neverExceeded,
	poolSize,
	sizesOver,
	startAutoscaler,
	startPool,
	stopRig,
	waitForRestart,
	type Rig,
} from './autoscale/rig';

// The autoscaler replaces a module that ran this pool for months, and a defect
// in the rule that replaces it lands on everyone at once. So the module's rule
// is kept as a strategy: reverting is a write to one Redis key, taking effect
// on the next tick of every replica, with no redeploy and no shell.
//
// These arms are the claim that reverting is worth doing — that the strategy
// scales the way the module scaled — and the arm that it can be reached
// without restarting anything.
//
// The Redis on 6108 is shared, so the rig owns a namespace and its key.
const REDIS_PORT = 6108;

function configKey(namespace: string): string {
	return `${namespace}:autoscale:config`;
}

describe('The autoscaler can be reverted to the module rule it replaces', () => {
	const redis = new Redis({ host: 'localhost', port: REDIS_PORT });
	const rigs: Rig[] = [];
	const namespace = 'bb-autoscale-strategy';

	afterAll(async () => {
		for (const rig of rigs) {
			stopRig(rig);
		}

		await redis.del(configKey(namespace));
		redis.disconnect();
	});

	it('ramps a loaded pool to the ceiling', async () => {
		const rig = startPool({
			appName: 'autoscale-legacy-ramp',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			PM2_AUTOSCALE_STRATEGY: 'legacy',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '5',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
		});

		expect(await poolSize(rig, 3, 60_000)).toBe(3);

		// The module reads the hottest worker to grow, so a pool at its
		// ceiling stops there rather than on the load falling away.
		expect(await sizesOver(rig, 5_000)).toEqual([3]);
	}, 90_000);

	it('holds a pool whose load is under its threshold', async () => {
		const rig = startPool({
			appName: 'autoscale-legacy-held',
			instances: 1,
			busyMs: 20,
			idleMs: 80,
		});

		rigs.push(rig);

		startAutoscaler(rig, {
			PM2_AUTOSCALE_STRATEGY: 'legacy',
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '95',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '3',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
		});

		expect(await sizesOver(rig, 20_000)).toEqual([1]);
	}, 90_000);

	// The switch, on the one pool where the two rules disagree loudest: a pool
	// whose workers keep restarting is broken rather than busy, which the
	// module cannot tell and this autoscaler freezes on. Nothing changes here
	// but the strategy — same daemon, same load, same thresholds — so a pool
	// that starts growing is the switch arriving and nothing else.
	it('starts scaling a churning pool the moment the override says so', async () => {
		const rig = startPool({
			appName: 'autoscale-legacy-switch',
			instances: 2,
			busyMs: 20,
			idleMs: 80,
			crashAfterMs: 3_000,
			crashOnlyInstance: '0',
		});

		rigs.push(rig);

		await redis.del(configKey(namespace));

		// Started beside a pool that has not crashed yet, the autoscaler sees
		// a calm pool — correctly — and acts on it before the first crash.
		expect(await waitForRestart(rig, 30_000)).toBe(true);

		startAutoscaler(rig, {
			REDIS_ENABLED: 'true',
			REDIS_HOST: 'localhost',
			REDIS_PORT: String(REDIS_PORT),
			CACHE_NAMESPACE: namespace,
			PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: '5',
			PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '0',
			PM2_AUTOSCALE_MIN_WORKERS: '1',
			PM2_AUTOSCALE_MAX_WORKERS: '4',
			PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: '0',
			// Longer than the crash interval, so each restart re-arms the
			// freeze before the last one lapses.
			PM2_AUTOSCALE_WARMUP_SECONDS: '5',
		});

		expect(await neverExceeded(rig, 2, 20_000)).toBe(2);

		await redis.set(configKey(namespace), JSON.stringify({ strategy: 'legacy' }));

		// Which is the module's answer to the same pool, and the reason the
		// rule above exists.
		expect(await poolSize(rig, 3, 60_000)).toBe(3);
	}, 180_000);
});
