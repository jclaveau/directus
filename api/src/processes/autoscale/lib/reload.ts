import type {
	AutoscaleReload,
	AutoscaleRunner,
} from '@directus/types';
import { useBus } from '../../../bus/index.js';
import { useLogger } from '../../../logger/index.js';
import { reloadApp } from '../../supervisor/index.js';
import {
	readSupervisorSharedConfig,
	reloadDeclaration,
} from './supervisor-shared-config.js';

/**
 * The channel a rolling restart is asked for on.
 *
 * Asked for rather than done: the worker serving the request is a member of
 * the pool being restarted, so a restart it ran itself would retire it partway
 * through and the request would never be answered. The process that scales the
 * pool is not in it, and it already holds the supervisor connection.
 */
const RELOAD_CHANNEL = 'autoscaleReload';

/** What the supervisor gets on top of what replacing the workers can cost. */
const RELOAD_SLACK_MS = 30_000;

interface ReloadRequest {
	/** Milliseconds since the epoch, as the asking worker read its clock. */
	at: number;
}

let askedAt: number | null = null;
let pending = false;
let running = false;
let finishedAt: number | null = null;
let error: string | null = null;

/** Where the pool's last rolling restart got to, as this process knows it. */
export function reloadState(): AutoscaleReload {
	return { askedAt, running, finishedAt, error };
}

/**
 * Whether the pool is mid-restart, which is when the loop holds still.
 *
 * A restart puts a replacement beside every worker it retires, so the pool
 * reads larger than it was asked to hold and every replacement reads as a
 * worker that restarted. Both are the loop's own signals for a pool in
 * trouble, and acting on either during a restart is how a deploy turns into a
 * scaling incident.
 */
export function reloading(): boolean {
	return running || pending;
}

/**
 * How long the supervisor gets for the whole restart.
 *
 * Derived rather than fixed: each worker costs at most the time it has to come
 * up plus the time the one it replaces has to go, and a pool at its ceiling
 * under a generous declaration is minutes of legitimate work. A fixed bound
 * would either cut that short or leave a supervisor that stopped answering
 * holding the loop still for an hour. The supervisor replaces a couple at a
 * time, so counting them one after another is the slowest it can honestly be.
 */
export function reloadBudgetMs(
	workers: number,
	declaration: Record<string, number>,
): number {
	const perWorker = (declaration['listen_timeout'] ?? 3000)
		+ (declaration['kill_timeout'] ?? 1600);

	return Math.max(1, workers) * perWorker + RELOAD_SLACK_MS;
}

/**
 * Why the pool cannot be given a rolling restart, or `null` where it can.
 *
 * Refused at the asking end as well as reported here, so a request that would
 * take the pool down rather than roll it is answered with the reason instead
 * of with a restart.
 */
export function reloadRefusal(runners: AutoscaleRunner[]): string | null {
	const runner = runners[0];

	if (runner === undefined) {
		return 'no process reported that it is scaling a pool, so nothing '
			+ 'would hear this';
	}

	if (runner.state.reload.running) {
		return 'the pool is already being restarted';
	}

	const supervisor = runner.state.supervisor;

	if (supervisor === null) {
		return 'the supervisor reported no worker of this pool to restart';
	}

	// Overlapping a replacement with the worker it replaces is something only a
	// cluster can do. Outside one the supervisor stops the worker and starts it
	// again, which is the downtime this exists to avoid.
	if (supervisor.execMode !== 'cluster_mode') {
		return `the pool runs in ${supervisor.execMode}, where a worker is `
			+ 'stopped before its replacement starts';
	}

	return null;
}

/**
 * Listen for restart requests.
 *
 * Only the process that scales the pool subscribes: a worker of the pool would
 * be acting on its own retirement.
 */
export function initAutoscaleReload(): void {
	useBus().subscribe<ReloadRequest>(RELOAD_CHANNEL, ({ at }) => {
		if (reloading()) {
			useLogger().info(
				'[autoscale] a rolling restart is already under way',
			);

			return;
		}

		askedAt = Number.isFinite(at)
			? at
			: Date.now();

		pending = true;
	});
}

/**
 * Ask the pool to restart itself.
 *
 * Answered with what the asking worker can honestly say: the request is out,
 * and nothing has started yet. Where it got to afterwards comes back on the
 * process report, from the process actually doing it.
 */
export function askForReload(): AutoscaleReload {
	const at = Date.now();

	useBus().publish<ReloadRequest>(RELOAD_CHANNEL, { at });

	return { askedAt: at, running: false, finishedAt: null, error: null };
}

/**
 * Start the restart that was asked for, if one was.
 *
 * Started beside the loop rather than inside it: replacing a pool takes as
 * long as the pool is large, and a tick awaiting that would stop sampling and
 * stop reporting for the whole of it — leaving the page that asked for the
 * restart unable to say whether it is happening.
 */
export function beginAskedReload(appName: string, workers: number): void {
	if (pending === false || running) {
		return;
	}

	const logger = useLogger();

	pending = false;
	running = true;
	error = null;

	logger.info(`[autoscale] restarting the ${appName} pool, worker by worker`);

	// The options an operator changed are pushed by the restart that carries
	// them, so the read that finds them belongs to the restart rather than to
	// the tick: a pool nobody is restarting never asks Redis for them.
	readSupervisorSharedConfig()
		.then((sharedConfig) => {
			const declaration = reloadDeclaration(sharedConfig);

			return reloadApp(
				appName,
				reloadBudgetMs(workers, declaration),
				declaration,
			);
		})
		.then(() => {
			logger.info(`[autoscale] the ${appName} pool finished restarting`);
		})
		.catch((failure: unknown) => {
			error = failure instanceof Error
				? failure.message
				: String(failure);

			logger.error(failure, '[autoscale] a rolling restart failed');
		})
		.finally(() => {
			running = false;
			finishedAt = Date.now();
		});
}
