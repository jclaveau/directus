import type { AutoscaleSupervisor } from '@directus/types';
import { promisify } from 'node:util';
import pm2 from 'pm2';
import { type DeclaredWorkerEnv, declaredBy } from './supervisor.js';

const connect = promisify(pm2.connect.bind(pm2));
const list = promisify(pm2.list.bind(pm2));

/**
 * How long the supervisor has to answer one call.
 *
 * Its client sends over a socket that reconnects on its own, and a call whose
 * daemon dies between the send and the reply is neither answered nor failed:
 * the callback is held against a reply nothing will send. Awaited bare that is
 * the end of the autoscaler, and a silent one — the loop stops between two log
 * lines, the pool stays at whatever size the daemon went down at, and the next
 * thing anyone learns is the incident. `pm2 update`, an OOM and a supervisor
 * restarted under a running autoscaler all produce exactly that.
 *
 * Above pm2's own `listen_timeout`, since `wait_ready` holds a scale open until
 * the new worker reports ready or that runs out. A deployment that raises
 * `PM2_LISTEN_TIMEOUT` past this costs a log line and a reissue rather than a
 * wrong pool: a scale names an absolute size, so the tick after sends the same
 * one and the supervisor answers the second with the first still in flight.
 */
const SUPERVISOR_TIMEOUT_MS = 15_000;

export async function connectToSupervisor(): Promise<void> {
	await connect();
}

export function disconnectFromSupervisor(): void {
	pm2.disconnect();
}

/** What the race resolves with when the supervisor is the one that lost it. */
const OUT_OF_TIME = Symbol('out of time');

/**
 * `call`, failed rather than awaited forever once the supervisor is out of
 * time.
 *
 * A call that fails on its own passes straight through: pm2 refusing a scale
 * is an answer, and the connection that carried it is fine.
 */
async function answeredInTime<T>(
	what: string,
	call: Promise<T>,
	timeoutMs: number = SUPERVISOR_TIMEOUT_MS,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const outOfTime = new Promise<typeof OUT_OF_TIME>((resolve) => {
		timer = setTimeout(() => resolve(OUT_OF_TIME), timeoutMs);
	});

	let answer: T | typeof OUT_OF_TIME;

	try {
		answer = await Promise.race([call, outOfTime]);
	}
	finally {
		clearTimeout(timer);
	}

	if (answer !== OUT_OF_TIME) {
		return answer;
	}

	// The client is still holding the callback the daemon owed it, so this is a
	// skipped tick only if the tick after it reaches a supervisor at all. The
	// abandoned call is caught on the way out, so that a reply arriving late is
	// a result nobody wants rather than an unhandled rejection.
	call.catch(() => undefined);
	pm2.disconnect();
	await connect();

	throw new Error(
		`the supervisor did not answer ${what} in ${timeoutMs}ms`,
	);
}

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

/**
 * PM2's published typings stop at a documented subset of `pm2_env`; the
 * restart counter and the start time are on the runtime object and absent
 * from them.
 */
interface SupervisedWorkerEnv extends DeclaredWorkerEnv {
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
	const workers = (await answeredInTime('a process list', list()))
		.filter((app) => app.name === appName);

	const matureSince = Date.now() - warmupSeconds * 1000;
	const onlineWorkers: OnlineWorker[] = [];
	const restartsByWorker = new Map<number, number>();
	let pendingWorkers = 0;
	let warmingWorkers = 0;
	let supervisor: AutoscaleSupervisor | null = null;

	for (const worker of workers) {
		const env = worker.pm2_env as SupervisedWorkerEnv | undefined;

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

	const scaled = new Promise<void>((resolve, reject) => {
		supervisor.scale(appName, workers, (error) => {
			if (error && /same process number/i.test(error.message) === false) {
				reject(error);
			}
			else {
				resolve();
			}
		});
	});

	await answeredInTime(`a scale to ${workers}`, scaled);
}

/**
 * Replaces every worker of the app, one batch at a time.
 *
 * The supervisor starts a replacement, waits for it to report ready, and only
 * then retires the worker it replaces — so the pool holds its size throughout
 * and no request lands on a worker that is going away. What bounds that wait is
 * the declaration's `listen_timeout`; under the time a worker takes to boot,
 * the supervisor gives up waiting and retires the old one anyway, which is the
 * one way this stops being seamless.
 *
 * Each worker keeps the environment it already has: pm2 puts a worker's own
 * identity in there, and refreshing it from this process would hand every
 * replacement the identity of the process that asked for the restart.
 */
export async function reloadPool(
	appName: string,
	timeoutMs: number,
	declaration: Record<string, number>,
): Promise<void> {
	const reloaded = new Promise<void>((resolve, reject) => {
		// pm2 checks the options of a reload against its command-line schema,
		// which names none of these, and drops whatever it does not find there.
		// `PM2_JSON_PROCESSING` is how it is told they are a declaration that
		// has been checked already. It is process-wide and read while `reload`
		// is still on the stack, so it goes back as soon as that returns.
		const processing = process.env['PM2_JSON_PROCESSING'];
		process.env['PM2_JSON_PROCESSING'] = 'true';

		try {
			pm2.reload(appName, { current_conf: declaration } as never, (error) => {
				if (error) {
					reject(error);
				}
				else {
					resolve();
				}
			});
		}
		finally {
			if (processing === undefined) {
				delete process.env['PM2_JSON_PROCESSING'];
			}
			else {
				process.env['PM2_JSON_PROCESSING'] = processing;
			}
		}
	});

	await answeredInTime(`a reload of ${appName}`, reloaded, timeoutMs);
}
