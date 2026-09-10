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

		if (env?.status === 'launching') {
			pendingWorkers += 1;
		}
		else if (env?.status === 'online') {
			const mature = (env.pm_uptime ?? 0) <= matureSince;

			onlineWorkers.push({
				pid: worker.pid ?? 0,
				cpuPercent: worker.monit?.cpu ?? 0,
				memoryBytes: worker.monit?.memory ?? 0,
				mature,
			});

			if (mature === false) {
				warmingWorkers += 1;
			}
		}
	}

	return {
		pendingWorkers,
		warmingWorkers,
		onlineWorkers,
		restartsByWorker,
		supervisor,
	};
}
