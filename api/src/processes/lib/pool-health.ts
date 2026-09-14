import { useBus } from '../../bus/index.js';
import { useLogger } from '../../logger/index.js';

/**
 * The channel the process holding the supervisor connection reports the pool
 * on.
 *
 * A value rather than a signal, unlike the settings channel beside it: what it
 * carries is an observation of the supervisor, and a subscriber has no way to
 * go and read it for itself. Every worker of a pool runs without a supervisor
 * connection on purpose — one client per worker is what the processes module
 * was built to stop — so the one process that has it is the only one that can
 * answer for the others.
 */
const POOL_CHANNEL = 'poolHealth';

export interface PoolHealth {
	/**
	 * Workers the supervisor lists in neither of the states of a worker that is
	 * on its way up or serving. A worker that cannot boot ends here, and so
	 * does one the supervisor has given up restarting.
	 */
	failedWorkers: number;
	/** Workers serving, whatever their age. */
	onlineWorkers: number;
}

/**
 * How long a reading stands before it is read as nothing said.
 *
 * The reporter stops with the process that holds the supervisor connection, and
 * a deployment that runs no such process never had one. Without an expiry, a
 * pool that recovered while the reporter was down would leave every worker
 * reporting the failure that was true when the bus last worked — and the state
 * this is here to make visible would be the one state it could get stuck in.
 */
const READING_STANDS_MS = 150_000;

/** How often the same reading is repeated, so it stands while it is true. */
const REFRESH_MS = 60_000;

let reading: (PoolHealth & { at: number }) | null = null;
let reported: (PoolHealth & { at: number }) | null = null;

/** What the supervisor last said about the pool, while that still stands. */
export function poolHealthReading(): PoolHealth | null {
	if (reading === null || Date.now() - reading.at > READING_STANDS_MS) {
		return null;
	}

	return {
		failedWorkers: reading.failedWorkers,
		onlineWorkers: reading.onlineWorkers,
	};
}

/**
 * Tell the deployment what the supervisor says about its pool.
 *
 * Repeated on a floor rather than sent per tick: the reading has to keep
 * standing while it is true, and a worker that booted after it was first sent
 * has nothing to ask. Unchanged and recent, it is left alone — pub/sub reaches
 * every node of the deployment, and a tick is not a rate anybody needs this at.
 */
export function reportPoolHealth(health: PoolHealth): void {
	const now = Date.now();

	const same = reported !== null
		&& reported.failedWorkers === health.failedWorkers
		&& reported.onlineWorkers === health.onlineWorkers;

	if (same && now - reported!.at < REFRESH_MS) {
		return;
	}

	reported = { ...health, at: now };

	// Kept locally as well as sent: the process that reports is a process of the
	// deployment like any other, and an unreachable bus should not leave it
	// knowing less about the pool than it just measured.
	reading = reported;

	const published = useBus().publish<PoolHealth>(POOL_CHANNEL, health);

	published.catch((error: unknown) => {
		useLogger().warn(error, '[pool-health] could not report the pool');
	});
}

/**
 * Keep this process's picture of the pool current.
 *
 * A bus that cannot be reached leaves the picture empty rather than ending the
 * process: health says nothing about the pool on a deployment with no Redis,
 * which is what it says today everywhere.
 */
export function initPoolHealthMirror(): void {
	const subscribed = useBus()
		.subscribe<PoolHealth>(POOL_CHANNEL, (health) => {
			reading = { ...health, at: Date.now() };
		});

	subscribed.catch((error: unknown) => {
		useLogger().warn(
			error,
			'[pool-health] no readings will be heard; '
				+ 'health will not answer for the pool',
		);
	});
}
