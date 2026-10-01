/**
 * The configuration and its two enums live in `@directus/types`, where the
 * admin page reading them off a process report resolves the same shapes the
 * loop decides on.
 */
export type {
	AutoscaleConfig,
	AutoscaleSignal,
	AutoscaleStrategy,
} from '@directus/types';

/** One online worker, averaged over the window the legacy rule reads. */
export interface LegacyWorkerSample {
	cpuPercent: number;
	memoryMegabytes: number;
}

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
	/**
	 * Every online worker, unfiltered by warm-up and averaged over the last
	 * thirty samples, which is what the `legacy` strategy reads instead of
	 * `cpuPercents`. Collected on every tick whichever strategy is running, so
	 * a switch to `legacy` mid-incident decides on a full window rather than
	 * on its first reading.
	 */
	legacyWorkers: LegacyWorkerSample[];
	/** Free memory of the host, which is the `legacy` strategy's brake on adding. */
	freeMemoryMegabytes: number;
}

export interface Decision {
	workers: number | null;
	reason: string;
}
