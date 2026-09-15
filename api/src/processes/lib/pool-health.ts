import { useEnv } from '@directus/env';
import { useBus } from '../../bus/index.js';
import { useLogger } from '../../logger/index.js';
import { redisConfigAvailable } from '../../redis/index.js';

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
	/** Workers this pool is meant to be serving with once it is up. */
	targetWorkers: number;
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

/**
 * How often the same reading is repeated, so it stands while it is true.
 *
 * Short because a worker holds health down until it has heard the pool is up,
 * and every worker answers the probe in turn: the floor is what bounds both how
 * long a deployment waits on its last worker to hear, and how long a worker the
 * pool gained later answers for a pool it has not been told about yet.
 */
const REFRESH_MS = 10_000;

let reading: (PoolHealth & { at: number }) | null = null;
let reported: (PoolHealth & { at: number }) | null = null;
let cameUp = false;

/**
 * Whether this deployment asked for a pool bigger than the one it starts with,
 * and can be told when it gets there.
 *
 * Read off the environment because it is a property of the deployment rather
 * than of the moment: the process has to know before it has heard anything
 * whether silence means a pool still climbing or a pool nobody is watching.
 * `PM2_AUTOSCALE_ENABLED` is not the question — it defaults to on, so a
 * deployment that never named it would hold its health down forever waiting
 * for an autoscaler it does not run. A prewarm is asked for or it is not.
 *
 * The bus is the other half of the question, and it is the same question the
 * routes describing the pool ask before they will carry themselves. Without
 * Redis every process subscribes to an emitter it shares with nobody, so the
 * reading that lifts the hold is published where no worker can hear it: the
 * hold would stand for the life of the deployment, and the platform gating a
 * switchover on it would never switch over.
 */
function awaitsPrewarm(): boolean {
	const env = useEnv();

	return redisConfigAvailable()
		&& env['PM2_AUTOSCALE_ENABLED'] !== false
		&& Number(env['PM2_AUTOSCALE_PREWARM'] ?? 0) > 0;
}

function record(health: PoolHealth, at: number): void {
	reading = { ...health, at };

	if (health.failedWorkers === 0 && health.onlineWorkers >= health.targetWorkers) {
		cameUp = true;
	}
}

/**
 * Whether the pool has reached the size this deployment serves with.
 *
 * Pessimistic until it is told otherwise, the way the migration watch beside it
 * is: an instance that cannot yet tell must not report itself ready, or the
 * platform switches traffic onto a pool that is still a fraction of the one
 * that was asked for — which is the moment prewarm exists to cover.
 *
 * Latched, so this answers a question about the deployment coming up and
 * nothing else. A worker lost later is the warning this file's other half
 * carries, and answering it with an error would take a serving deployment down
 * on a restart nobody is watching for.
 */
export function poolHasComeUp(): boolean {
	return cameUp || awaitsPrewarm() === false;
}

/** What the supervisor last said about the pool, while that still stands. */
export function poolHealthReading(): PoolHealth | null {
	if (reading === null || Date.now() - reading.at > READING_STANDS_MS) {
		return null;
	}

	return {
		failedWorkers: reading.failedWorkers,
		onlineWorkers: reading.onlineWorkers,
		targetWorkers: reading.targetWorkers,
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
		&& reported.onlineWorkers === health.onlineWorkers
		&& reported.targetWorkers === health.targetWorkers;

	if (same && now - reported!.at < REFRESH_MS) {
		return;
	}

	reported = { ...health, at: now };

	// Kept locally as well as sent: the process that reports is a process of the
	// deployment like any other, and an unreachable bus should not leave it
	// knowing less about the pool than it just measured.
	record(health, now);

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
			record(health, Date.now());
		});

	subscribed.catch((error: unknown) => {
		useLogger().warn(
			error,
			'[pool-health] no readings will be heard; '
				+ 'health will not answer for the pool',
		);
	});
}
