import { useEnv } from '@directus/env';
import { useBus } from '../../bus/index.js';
import { useLogger } from '../../logger/index.js';
import { redisConfigAvailable } from '../../redis/index.js';
import { getMilliseconds } from '../../utils/get-milliseconds.js';

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
 * The channel a process that has just subscribed asks for the reading on.
 *
 * The reading is sent when it changes and otherwise only on a long floor, so a
 * worker the pool gained after the last change would have nothing to answer
 * for until then. Asked on boot, and again whenever the bus comes back from a
 * lost connection: pub/sub keeps nothing for a subscriber that is away.
 */
const POOL_QUERY_CHANNEL = 'poolHealth:query';

let reading: PoolHealth | null = null;
let readingHeardAt = 0;
let reported: PoolHealth | null = null;
let reportedAt = 0;
let withdrawn = false;
let cameUp = false;

/**
 * How often an unchanged reading is sent again.
 *
 * The floor a lost message heals on, and what expires a reading whose reporter
 * died without taking it back. Long, because a platform that stops an idle
 * service after a stretch without traffic cannot stop one that sends on a
 * shorter one: the default sits well above Railway's ten minutes.
 */
function refreshMs(): number {
	return getMilliseconds(useEnv()['PM2_POOL_HEALTH_REFRESH'], 1_800_000);
}

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

function record(health: PoolHealth | null): void {
	reading = health;
	readingHeardAt = Date.now();

	if (health === null) {
		return;
	}

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

/**
 * What the supervisor last said about the pool, unless its reporter stopped.
 *
 * Read as nothing said once two refreshes went by without it: a reporter that
 * was killed takes nothing back, and a reading nobody repeats may describe a
 * pool that recovered since.
 */
export function poolHealthReading(): PoolHealth | null {
	if (reading === null || Date.now() - readingHeardAt > 2 * refreshMs()) {
		return null;
	}

	return {
		failedWorkers: reading.failedWorkers,
		onlineWorkers: reading.onlineWorkers,
		targetWorkers: reading.targetWorkers,
	};
}

/** Resolves whether the bus took the reading, and never rejects. */
async function publishPoolHealth(health: PoolHealth | null): Promise<boolean> {
	try {
		await useBus().publish<PoolHealth | null>(POOL_CHANNEL, health);

		return true;
	}
	catch (error: unknown) {
		useLogger().warn(error, '[pool-health] could not report the pool');

		return false;
	}
}

/**
 * Tell the deployment what the supervisor says about its pool.
 *
 * Sent when it changes, and otherwise once a refresh: pub/sub reaches every
 * node of the deployment, and a pool that holds still has little new to say.
 * A worker that boots after the last change asks for it instead, see
 * `answerPoolHealthQueries`.
 */
export function reportPoolHealth(health: PoolHealth): void {
	// A tick that was already running when the reporter stopped would otherwise
	// send the reading again after it was taken back.
	if (withdrawn) {
		return;
	}

	if (
		reported !== null
		&& reported.failedWorkers === health.failedWorkers
		&& reported.onlineWorkers === health.onlineWorkers
		&& reported.targetWorkers === health.targetWorkers
		&& Date.now() - reportedAt < refreshMs()
	) {
		return;
	}

	reported = { ...health };
	reportedAt = Date.now();

	// Kept locally as well as sent: the process that reports is a process of the
	// deployment like any other, and an unreachable bus should not leave it
	// knowing less about the pool than it just measured.
	record(reported);

	const sent = reported;

	// Forgotten when the bus refused it, so the next tick sends it again: an
	// unchanged reading is not sent twice, and this one never arrived.
	void publishPoolHealth(sent).then((delivered) => {
		if (delivered === false && reported === sent) {
			reported = null;
		}
	});
}

/**
 * Send the last reading again to whichever process asks for it.
 *
 * Run by the process that reports, so a worker that booted after the last
 * change hears the pool it serves in without waiting for the next one.
 */
export async function answerPoolHealthQueries(): Promise<void> {
	await useBus().subscribe(POOL_QUERY_CHANNEL, () => {
		if (reported !== null) {
			void publishPoolHealth(reported);
		}
	});
}

/**
 * Take the reading back, on the reporter's way out.
 *
 * A reading expires on its own only after two refreshes, and a pool that
 * recovered while the reporter was down would leave every worker answering for
 * the failure that was true when it stopped until then. A reporter that
 * crashes is restarted by its supervisor, and its first tick sends a reading
 * again.
 */
export async function withdrawPoolHealth(): Promise<void> {
	withdrawn = true;
	reported = null;
	await publishPoolHealth(null);
}

/**
 * Keep this process's picture of the pool current.
 *
 * A bus that cannot be reached leaves the picture empty rather than ending the
 * process: health says nothing about the pool on a deployment with no Redis,
 * which is what it says today everywhere.
 */
export function initPoolHealthMirror(): void {
	const askForReading = async () => {
		await useBus().publish(POOL_QUERY_CHANNEL, {});
	};

	const subscribed = useBus()
		.subscribe<PoolHealth | null>(POOL_CHANNEL, (health) => {
			record(health);
		});

	// Whatever changed while the connection was down never reached this process.
	useBus().onResubscribe(() => {
		askForReading().catch((error: unknown) => {
			useLogger().warn(error, '[pool-health] could not ask for the reading');
		});
	});

	// Asked once subscribed, so the answer is not sent before anything listens.
	const asked = subscribed.then(askForReading);

	asked.catch((error: unknown) => {
		useLogger().warn(
			error,
			'[pool-health] no readings will be heard; '
				+ 'health will not answer for the pool',
		);
	});
}
