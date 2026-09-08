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
	/** CPU percent of each worker that has reported ready. */
	cpuPercents: number[];
	/** Workers the supervisor has started that have not reported ready yet. */
	pendingWorkers: number;
}

/**
 * The workers of one app, split by whether they are serving yet.
 *
 * An app whose name matches nothing reads as an empty pool rather than an
 * error: the autoscaler starts alongside the app it scales and may well win
 * the race.
 */
export async function readPool(appName: string): Promise<PoolReading> {
	const workers = (await list()).filter((app) => app.name === appName);
	const cpuPercents: number[] = [];
	let pendingWorkers = 0;

	for (const worker of workers) {
		const env = worker.pm2_env as { status?: string } | undefined;

		if (env?.status === 'online') {
			cpuPercents.push(worker.monit?.cpu ?? 0);
		}
		else if (env?.status === 'launching') {
			pendingWorkers += 1;
		}
	}

	return { cpuPercents, pendingWorkers };
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
