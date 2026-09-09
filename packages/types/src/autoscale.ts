/**
 * What the process that resizes a PM2 pool is running on, and what it last
 * decided.
 *
 * Shared here because the autoscaler resolves this configuration in its own
 * process — beside the pool, not inside it — so the only honest answer to
 * "what is it scaling on right now" is the one that process reports.
 */

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

/**
 * Which rule decides the pool size.
 *
 * `legacy` reproduces the `pm2-autoscale` module this replaces, so a defect in
 * the fork's own rule can be reverted fleet-wide with one Redis write instead
 * of a redeploy. It reads the maximum CPU to grow and the average to shrink,
 * over a thirty-sample window, and knows nothing of warm-ups, restarts or
 * prewarming.
 */
export type AutoscaleStrategy = 'scalabus' | 'legacy';

export interface AutoscaleConfig {
	enabled: boolean;
	strategy: AutoscaleStrategy;
	/** The pm2 app this scales. Anything else the daemon runs is left alone. */
	appName: string;
	signal: AutoscaleSignal;
	/**
	 * How many of the last per-second readings a worker's CPU is averaged over.
	 *
	 * A supervisor samples processes that spend their time in bursts, so a
	 * single reading is as much sampling as load — and acted on alone it buys a
	 * worker for one busy second, or gives one back during a lull in a pool that
	 * is genuinely loaded. The `legacy` strategy is fixed at the module's own
	 * thirty; this is the same protection at a fraction of the latency.
	 */
	sampleWindow: number;
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

/**
 * Which layer supplied a field's value:
 *
 * - `default` — the shipped defaults, nothing set the variable
 * - `env` — a `PM2_AUTOSCALE_*` variable of the process that scales
 * - `override` — the live Redis override, which wins over both
 */
export type AutoscaleValueSource = 'default' | 'env' | 'override';

/** Per field, the layer its effective value came from. */
export type AutoscaleConfigSources = Record<
	keyof AutoscaleConfig,
	AutoscaleValueSource
>;

/** What one tick concluded, whether or not it resized anything. */
export interface AutoscaleDecision {
	/** Milliseconds since the epoch, as the deciding process read its clock. */
	at: number;
	/** The size asked for, or `null` where the pool was left alone. */
	workers: number | null;
	reason: string;
}

/** What the autoscaler is running on, as of its last completed tick. */
export interface AutoscaleNodeState {
	at: number;
	config: AutoscaleConfig;
	sources: AutoscaleConfigSources;
	/** Online workers of the scaled app the tick read. */
	workers: number;
	/** Started but not yet ready, so counted in the pool and not the statistic. */
	pendingWorkers: number;
	/** Online but young enough that their CPU is still their own startup. */
	warmingWorkers: number;
	/**
	 * The per-worker readings the rule that decided actually looked at.
	 *
	 * Which workers those are is the strategy's own: `legacy` reads every
	 * online worker, `scalabus` drops the ones still warming up.
	 */
	cpuPercents: number[];
	lastDecision: AutoscaleDecision | null;
	/** The last decision that actually asked for a different pool size. */
	lastScale: AutoscaleDecision | null;
}
