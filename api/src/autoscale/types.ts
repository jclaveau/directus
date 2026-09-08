/** What the pool looked like when the sample was taken. */
export interface PoolSample {
	/** CPU percent per worker of the managed app that has reported ready. */
	cpuPercents: number[];
	/**
	 * Workers the supervisor has started that have not reported ready yet.
	 *
	 * With `wait_ready`, pm2 holds a worker at `launching` until it sends
	 * `ready` — which the API does from inside its `listen` callback — so the
	 * pool's own status answers "is the last one up" that a timer can only
	 * approximate.
	 */
	pendingWorkers: number;
	/**
	 * Workers serving, but young enough that their CPU is still their own
	 * startup: a cold schema cache and an unJITted hot path. Counted in the
	 * pool, kept out of the statistic.
	 */
	warmingWorkers: number;
	/**
	 * Seconds since a worker of this app last restarted, or `null` if none has
	 * since the autoscaler started.
	 */
	secondsSinceRestart: number | null;
	/** Milliseconds since the epoch, passed in so the decision stays pure. */
	now: number;
	lastScaleUpAt: number;
	lastScaleDownAt: number;
}

/**
 * `signal` picks the statistic both thresholds read.
 *
 * `average` converges: adding a worker lowers it, so the pool grows until the
 * band is met and then stops. `max` does not — adding a worker does not cool the
 * hottest one, so a threshold inside the normal spread of a healthy worker is
 * satisfied permanently and the pool grows to its ceiling on no real demand.
 * That is what took the planner's Api down on 2026-09-08, so `average` is the
 * default and `max` is kept only for a workload that genuinely needs it.
 */
export type AutoscaleSignal = 'average' | 'max';

export interface AutoscaleConfig {
	enabled: boolean;
	/** The pm2 app this scales. Anything else the daemon runs is left alone. */
	appName: string;
	signal: AutoscaleSignal;
	scaleCpuThreshold: number;
	releaseCpuThreshold: number;
	minWorkers: number;
	maxWorkers: number;
	/**
	 * Workers to start with, which is not the floor: the pool may fall back to
	 * `minWorkers` once the load that justified them is gone.
	 */
	prewarmWorkers: number;
	minSecondsToScaleUp: number;
	minSecondsToScaleDown: number;
	/**
	 * How long a worker's numbers are its own startup rather than the load.
	 *
	 * Also how long the whole pool's numbers are untrusted after a restart. A
	 * worker that died and came back reads exactly like a busy one through a
	 * CPU average, and the two call for opposite reactions: on 2026-09-08 a
	 * heap cap crash-looped the planner's Api, and every restart's boot CPU
	 * bought another worker that crashed the same way.
	 */
	warmupSeconds: number;
}

export interface Decision {
	workers: number | null;
	reason: string;
}
