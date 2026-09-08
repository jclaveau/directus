import { promisify } from 'node:util';
import pm2 from 'pm2';

const connect = promisify(pm2.connect.bind(pm2));
const list = promisify(pm2.list.bind(pm2));

export async function connectToSupervisor(): Promise<void> {
	await connect();
}

export function disconnectFromSupervisor(): void {
	pm2.disconnect();
}

/** What one sample of the managed app's workers says about it. */
export interface PoolReading {
	/** CPU percent of each worker serving for longer than the warm-up. */
	cpuPercents: number[];
	/** Workers the supervisor has started that have not reported ready yet. */
	pendingWorkers: number;
	/** Workers serving, but still inside their warm-up. */
	warmingWorkers: number;
	/**
	 * Restarts the supervisor has counted, per worker.
	 *
	 * Per worker rather than summed: releasing a worker takes its restarts out
	 * of a total, so a release landing on the same tick as a restart nets flat
	 * and the restart goes unseen.
	 */
	restartsByWorker: Map<number, number>;
}

/**
 * PM2's published typings stop at a documented subset of `pm2_env`; the
 * restart counter and the start time are on the runtime object and absent
 * from them.
 */
interface SupervisedWorkerEnv {
	status?: string;
	restart_time?: number;
	pm_uptime?: number;
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
	const workers = (await list()).filter((app) => app.name === appName);
	const matureSince = Date.now() - warmupSeconds * 1000;
	const cpuPercents: number[] = [];
	const restartsByWorker = new Map<number, number>();
	let pendingWorkers = 0;
	let warmingWorkers = 0;

	for (const worker of workers) {
		const env = worker.pm2_env as SupervisedWorkerEnv | undefined;

		if (worker.pm_id !== undefined) {
			restartsByWorker.set(worker.pm_id, env?.restart_time ?? 0);
		}

		if (env?.status === 'launching') {
			pendingWorkers += 1;
		}
		else if (env?.status === 'online') {
			if ((env.pm_uptime ?? 0) > matureSince) {
				warmingWorkers += 1;
			}
			else {
				cpuPercents.push(worker.monit?.cpu ?? 0);
			}
		}
	}

	return { cpuPercents, pendingWorkers, warmingWorkers, restartsByWorker };
}

/**
 * `scale` has been on the daemon since pm2 2.x but never reached its
 * published typings, which stop at the documented subset.
 */
interface ScalableSupervisor {
	scale(
		appName: string,
		workers: number,
		callback: (error: Error | null) => void,
	): void;
}

/**
 * Resizes the app to an absolute worker count.
 *
 * pm2 answers a scale to the size it already has by calling back with an
 * error, and the only thing distinguishing it from a real failure is the
 * wording. Matched loosely: the pool is already where it was asked to be, so
 * treating it as a failure would log one a second while nothing is wrong,
 * and a reworded message should cost a stray log line rather than silence.
 */
export async function scaleTo(appName: string, workers: number): Promise<void> {
	const supervisor = pm2 as unknown as ScalableSupervisor;

	await new Promise<void>((resolve, reject) => {
		supervisor.scale(appName, workers, (error) => {
			if (error && /same process number/i.test(error.message) === false) {
				reject(error);
			}
			else {
				resolve();
			}
		});
	});
}
