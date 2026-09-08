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
	/** Restarts the supervisor has counted across the app's workers. */
	restarts: number;
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
	let pendingWorkers = 0;
	let warmingWorkers = 0;
	let restarts = 0;

	for (const worker of workers) {
		const env = worker.pm2_env as SupervisedWorkerEnv | undefined;
		restarts += env?.restart_time ?? 0;

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

	return { cpuPercents, pendingWorkers, warmingWorkers, restarts };
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
 * pm2 answers a scale to the size it already has with an error; the pool is
 * where it was asked to be, so it is reported as nothing to do.
 */
export async function scaleTo(appName: string, workers: number): Promise<void> {
	const supervisor = pm2 as unknown as ScalableSupervisor;

	await new Promise<void>((resolve, reject) => {
		supervisor.scale(appName, workers, (error) => {
			if (error && error.message !== 'Same process number') {
				reject(error);
			}
			else {
				resolve();
			}
		});
	});
}
