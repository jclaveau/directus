import type { AutoscaleSupervisor } from '@directus/types';
import {
	type SupervisedProcessEnv,
	listSupervisedApps,
} from '../../supervisor/index.js';
import { declaredBy } from './supervisor.js';

/** What one sample of the managed app's workers says about it. */
export interface PoolReading {
	/** Workers the supervisor has started that have not reported ready yet. */
	pendingWorkers: number;
	/**
	 * Workers the supervisor lists as neither starting nor serving.
	 *
	 * A worker that cannot finish `createApp` never binds and never reports
	 * ready, so it is restarted until the supervisor gives up on it and leaves
	 * it here. Nothing else in this reading counts it: the pool reads as the
	 * size it has, and a pool short of what it was asked for reads the same as
	 * a pool that was asked for less.
	 */
	failedWorkers: number;
	/** Workers serving, but still inside their warm-up. */
	warmingWorkers: number;
	/**
	 * Every serving worker, whatever its age, keyed by the pid rather than the
	 * pm id because that is what changes when a worker is replaced. Raw: what
	 * the rules decide on is these readings averaged over a window, which is
	 * `PoolSamples`.
	 */
	onlineWorkers: OnlineWorker[];
	/**
	 * Restarts the supervisor has counted, per worker.
	 *
	 * Per worker rather than summed: releasing a worker takes its restarts out
	 * of a total, so a release landing on the same tick as a restart nets flat
	 * and the restart goes unseen.
	 */
	restartsByWorker: Map<number, number>;
	/**
	 * The declaration those workers are running under, off the first one the
	 * supervisor named, or `null` for a pool with no worker to read.
	 *
	 * One worker answers for the pool: pm2 clones the declaration per worker
	 * from the app it belongs to, so they carry the same one.
	 */
	supervisor: AutoscaleSupervisor | null;
}

export interface OnlineWorker {
	pid: number;
	/**
	 * What the supervisor calls the worker, which is what a release has to
	 * name. Survives a restart where the pid does not, so the two are not
	 * interchangeable and both are carried.
	 */
	pmId: number;
	cpuPercent: number;
	memoryBytes: number;
	/** Serving for longer than the warm-up, so its numbers are its load. */
	mature: boolean;
}

/** Workers whose restart count is higher than it was in `before`. */
export function restarted(
	before: Map<number, number>,
	after: Map<number, number>,
): boolean {
	for (const [pmId, restarts] of after) {
		const previous = before.get(pmId);

		if (previous !== undefined && restarts > previous) {
			return true;
		}
	}

	return false;
}

/**
 * The workers of one app, split by whether their numbers can be trusted yet.
 *
 * An app whose name matches nothing reads as an empty pool rather than an
 * error: the autoscaler starts alongside the app it scales and may well win
 * the race.
 */
export async function readPool(
	appName: string,
	warmupSeconds: number,
): Promise<PoolReading> {
	const workers = (await listSupervisedApps())
		.filter((app) => app.name === appName);

	const matureSince = Date.now() - warmupSeconds * 1000;
	const onlineWorkers: OnlineWorker[] = [];
	const restartsByWorker = new Map<number, number>();
	let pendingWorkers = 0;
	let failedWorkers = 0;
	let warmingWorkers = 0;
	let supervisor: AutoscaleSupervisor | null = null;

	for (const worker of workers) {
		const env = worker.pm2_env as SupervisedProcessEnv | undefined;

		if (env !== undefined && supervisor === null) {
			supervisor = declaredBy(env);
		}

		if (worker.pm_id !== undefined) {
			restartsByWorker.set(worker.pm_id, env?.restart_time ?? 0);
		}

		// `waiting restart` is a worker the supervisor has already decided to
		// start again, so it belongs where a launching one does: called a
		// failure it would warn for the length of every restart, and counted
		// nowhere the pool would read short and be given a worker it is about
		// to get back.
		if (env?.status === 'launching' || env?.status === 'waiting restart') {
			pendingWorkers += 1;
		}
		else if (env?.status === 'online') {
			const mature = (env.pm_uptime ?? 0) <= matureSince;

			onlineWorkers.push({
				pid: worker.pid ?? 0,
				pmId: worker.pm_id ?? 0,
				cpuPercent: worker.monit?.cpu ?? 0,
				memoryBytes: worker.monit?.memory ?? 0,
				mature,
			});

			if (mature === false) {
				warmingWorkers += 1;
			}
		}
		// Named rather than taken as everything else, because the states left
		// over are not one thing. `stopped` and `stopping` are somebody's
		// decision, and this count is read by the deployment's health: a pool a
		// worker was deliberately taken out of would answer every probe with a
		// warning until it was put back, and one that booted that way would
		// never report itself ready at all.
		else if (env?.status === 'errored') {
			failedWorkers += 1;
		}
	}

	return {
		pendingWorkers,
		failedWorkers,
		warmingWorkers,
		onlineWorkers,
		restartsByWorker,
		supervisor,
	};
}
