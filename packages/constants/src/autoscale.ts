/**
 * The most workers the autoscaler will scale a pool to, whatever it is asked
 * for.
 *
 * A blunt guard against a typed zero, not a capacity calculation: the pool that
 * can actually be afforded comes from the cgroup limit divided by measured
 * per-worker RSS. Until then a `maxWorkers` of 10000 has to fail as a clamp and
 * a log line rather than as a dead container.
 */
export const MAX_SUPPORTED_WORKERS = 64;

/**
 * How many samples the `legacy` strategy averages a worker over, which is the
 * module's own number and so the depth of the ring both strategies read: no
 * window can be asked for past it.
 */
export const LEGACY_SAMPLE_WINDOW = 30;

/**
 * The longest any of the pacing fields may be asked for, in seconds.
 *
 * A day, which no cooldown is: past it the number is a duration typed in
 * milliseconds, and a cooldown of `300000` freezes the pool for three and a
 * half days without ever looking wrong in a list of numbers.
 */
export const MAX_PACING_SECONDS = 86_400;

/** The range a numeric field accepts, and what the number counts. */
export interface AutoscaleBound {
	low: number;
	high: number;
	/** What the number counts, so a message reads as the field does. */
	unit: string;
}

/**
 * What each field of the autoscale configuration accepts.
 *
 * Here rather than beside any one of its readers because three of them need
 * the same numbers and disagreeing is the failure: the write refuses what sits
 * outside these, the loop clamps to them, and the panel's inputs offer them.
 */
export const AUTOSCALE_BOUNDS = {
	sampleWindow: { low: 1, high: LEGACY_SAMPLE_WINDOW, unit: 'samples' },
	scaleCpuThreshold: { low: 1, high: 100, unit: '%' },
	releaseCpuThreshold: { low: 0, high: 99, unit: '%' },
	minWorkers: { low: 1, high: MAX_SUPPORTED_WORKERS, unit: 'workers' },
	maxWorkers: { low: 1, high: MAX_SUPPORTED_WORKERS, unit: 'workers' },
	prewarmWorkers: { low: 0, high: MAX_SUPPORTED_WORKERS, unit: 'workers' },
	minSecondsToScaleUp: { low: 0, high: MAX_PACING_SECONDS, unit: 'seconds' },
	minSecondsToScaleDown: { low: 0, high: MAX_PACING_SECONDS, unit: 'seconds' },
	warmupSeconds: { low: 0, high: MAX_PACING_SECONDS, unit: 'seconds' },
} satisfies Record<string, AutoscaleBound>;

/**
 * What each pm2 option a rolling restart can carry accepts.
 *
 * Refused outside these rather than clamped: nothing downstream corrects them,
 * so a value out of range would be handed to the supervisor as typed — a
 * `kill_timeout` of zero drops every request a released worker was serving.
 */
export const SUPERVISOR_BOUNDS = {
	listenTimeout: { low: 1000, high: 600_000, unit: 'ms' },
	killTimeout: { low: 100, high: 600_000, unit: 'ms' },
	minUptime: { low: 100, high: 600_000, unit: 'ms' },
	restartDelay: { low: 0, high: 600_000, unit: 'ms' },
	maxRestarts: { low: 0, high: 1000, unit: '' },
	maxMemoryRestartMegabytes: { low: 64, high: 65_536, unit: 'MB' },
} satisfies Record<string, AutoscaleBound>;
