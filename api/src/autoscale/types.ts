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
}

export interface Decision {
	workers: number | null;
	reason: string;
}
