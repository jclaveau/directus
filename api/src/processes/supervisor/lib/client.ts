import { promisify } from 'node:util';
import pm2, { type ProcessDescription } from 'pm2';

/**
 * Whether a PM2 daemon supervises this process. `PM2_HOME` alone does not say
 * so: an image can export it and still start the server directly — the Backend
 * container does exactly that — which reported a broken supervisor where there
 * is none at all. PM2 injects `pm_id` into the processes it spawns and nothing
 * else does, so the pair is the honest probe.
 */
export function supervisorAvailable(): boolean {
	return 'PM2_HOME' in process.env
		&& /^\d+$/.test(process.env['pm_id'] ?? '');
}

/**
 * How long the supervisor has to answer one call.
 *
 * Its client sends over a socket that reconnects on its own, and a call whose
 * daemon dies between the send and the reply is neither answered nor failed:
 * the callback is held against a reply nothing will send. Awaited bare that is
 * the end of the caller, and a silent one — an autoscale loop stops between two
 * log lines, the pool stays at whatever size the daemon went down at, and the
 * next thing anyone learns is the incident. `pm2 update`, an OOM and a
 * supervisor restarted under a running process all produce exactly that.
 *
 * Above pm2's own `listen_timeout`, since `wait_ready` holds a scale open until
 * the new worker reports ready or that runs out. A deployment that raises
 * `PM2_LISTEN_TIMEOUT` past this costs a log line and a reissue rather than a
 * wrong pool: a scale names an absolute size, so the call after sends the same
 * one and the supervisor answers the second with the first still in flight.
 */
const SUPERVISOR_TIMEOUT_MS = 15_000;

function connect(): Promise<void> {
	return promisify(pm2.connect.bind(pm2))();
}

export async function connectToSupervisor(): Promise<void> {
	await connect();
}

export function disconnectFromSupervisor(): void {
	pm2.disconnect();
}

/**
 * The reconnect under way, or `null` where none is.
 *
 * Taking the client apart and building it again is not a step a second caller
 * can join halfway. pm2 finishes a connection it has already started against
 * the client it finds when the socket lands, so a disconnect issued while one
 * is in flight leaves that callback reading a client nothing holds any more —
 * and it throws from inside a socket handler, where no call is left to carry
 * the failure. An uncaught exception ends the process, which is the freeze
 * this reconnect exists to prevent arriving by the other door.
 *
 * A supervisor restarted under a running caller produces exactly that overlap:
 * every call in flight when the daemon went down runs out of time, and each of
 * them asks for the same reconnect a moment apart.
 */
let reconnecting: Promise<void> | null = null;

/** One reconnect at a time, however many callers found the supervisor gone. */
function reconnectToSupervisor(): Promise<void> {
	reconnecting ??= (async () => {
		pm2.disconnect();
		await connect();
	})()
		.finally(() => {
			reconnecting = null;
		});

	return reconnecting;
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
	// skipped call only if the call after it reaches a supervisor at all. The
	// abandoned call is caught on the way out, so that a reply arriving late is
	// a result nobody wants rather than an unhandled rejection.
	call.catch(() => undefined);

	// A reconnect that fails leaves the same skipped call as one that works,
	// and the caller asks again: what it is told either way is which call the
	// supervisor did not answer.
	await reconnectToSupervisor().catch(() => undefined);

	throw new Error(
		`the supervisor did not answer ${what} in ${timeoutMs}ms`,
	);
}

/** Every process the local daemon supervises, whatever app it belongs to. */
export async function listSupervisedApps(): Promise<ProcessDescription[]> {
	return answeredInTime('a process list', promisify(pm2.list.bind(pm2))());
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
export async function scaleApp(
	appName: string,
	workers: number,
): Promise<void> {
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
export async function reloadApp(
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

/** Hands one packet to a supervised process, bounded like every other call. */
export async function sendToSupervisedProcess(
	pmId: number,
	packet: object,
): Promise<void> {
	// pm2's own typings mis-infer this overload, so its runtime form is the one
	// the promise is built around.
	const send = pm2.sendDataToProcessId.bind(pm2) as (
		procId: number,
		packet: object,
		callback: (error: Error | null) => void,
	) => void;

	const sent = new Promise<void>((resolve, reject) => {
		send(pmId, packet, (error) => {
			if (error) {
				reject(error);
			}
			else {
				resolve();
			}
		});
	});

	await answeredInTime(`a packet to process ${pmId}`, sent);
}
