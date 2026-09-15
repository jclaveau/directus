import { promisify } from "node:util";
import pm2 from "pm2";

//#region src/processes/supervisor/lib/client.ts
/**
* Whether a PM2 daemon supervises this process. `PM2_HOME` alone does not say
* so: an image can export it and still start the server directly — the Backend
* container does exactly that — which reported a broken supervisor where there
* is none at all. PM2 injects `pm_id` into the processes it spawns and nothing
* else does, so the pair is the honest probe.
*/
function supervisorAvailable() {
	return "PM2_HOME" in process.env && /^\d+$/.test(process.env["pm_id"] ?? "");
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
const SUPERVISOR_TIMEOUT_MS = 15e3;
async function connect() {
	await promisify(pm2.connect.bind(pm2))();
	await listenToWorkers();
}
let onWorkerMessage = null;
/**
* Hands every message the supervised workers send to `listener`.
*
* pm2 gives the bus its own socket, which its client takes down along with the
* calling one — so this is re-armed from `connect` rather than called once, and
* a reconnect brings the reports back with the connection that carries them.
*/
function watchWorkerMessages(listener) {
	onWorkerMessage = listener;
}
function listenToWorkers() {
	const listener = onWorkerMessage;
	if (listener === null) return Promise.resolve();
	return answeredInTime("a worker bus", new Promise((resolve, reject) => {
		pm2.launchBus((error, bus) => {
			if (error) reject(error);
			else {
				bus.on("process:msg", listener);
				resolve();
			}
		});
	}));
}
/**
* The disconnect finished, rather than started.
*
* pm2 takes the client apart asynchronously and nulls whichever client it
* finds when it lands — not the one it was asked about. Started and left to
* run, it lands after the connect below has installed a fresh client and nulls
* that one instead; what reads it next is pm2's own connect handler, from
* inside a socket callback where the throw is nobody's to catch and ends the
* process.
*
* Its refusals resolve rather than reject: every one it has says the
* connection is already gone, which is the state being asked for.
*/
function disconnected() {
	const supervisor = pm2;
	return new Promise((resolve) => {
		supervisor.disconnect(() => resolve());
	});
}
async function connectToSupervisor() {
	await connect();
}
function disconnectFromSupervisor() {
	pm2.disconnect();
}
/**
* The reconnect under way, or `null` where none is.
*
* Taking the client apart and building it again is not a step a second caller
* can join halfway. pm2 finishes a connection it has already started against
* the client it finds when the socket lands, so two reconnects overlapping
* leave one of them reading a client nothing holds any more — and it throws
* from inside a socket handler, where no call is left to carry the failure. An
* uncaught exception ends the process, which is the freeze this reconnect
* exists to prevent arriving by the other door.
*
* A supervisor restarted under a running caller produces exactly that overlap:
* every call in flight when the daemon went down runs out of time, and each of
* them asks for the same reconnect a moment apart.
*
* This holds callers apart from each other. What holds the two halves of one
* reconnect apart is `disconnected()` above, which the same socket handler
* would otherwise read through.
*/
let reconnecting = null;
/** One reconnect at a time, however many callers found the supervisor gone. */
function reconnectToSupervisor() {
	reconnecting ??= (async () => {
		await disconnected();
		await connect();
	})().finally(() => {
		reconnecting = null;
	});
	return reconnecting;
}
/** What the race resolves with when the supervisor is the one that lost it. */
const OUT_OF_TIME = Symbol("out of time");
/**
* `call`, failed rather than awaited forever once the supervisor is out of
* time.
*
* A call that fails on its own passes straight through: pm2 refusing a scale
* is an answer, and the connection that carried it is fine.
*/
async function answeredInTime(what, call, timeoutMs = SUPERVISOR_TIMEOUT_MS) {
	let timer;
	const outOfTime = new Promise((resolve) => {
		timer = setTimeout(() => resolve(OUT_OF_TIME), timeoutMs);
	});
	let answer;
	try {
		answer = await Promise.race([call, outOfTime]);
	} finally {
		clearTimeout(timer);
	}
	if (answer !== OUT_OF_TIME) return answer;
	call.catch(() => void 0);
	await reconnectToSupervisor().catch(() => void 0);
	throw new Error(`the supervisor did not answer ${what} in ${timeoutMs}ms`);
}
/**
* Stops one worker by the id the supervisor knows it as.
*
* What a release uses instead of naming a size. Handed a size pm2 picks the
* victim itself, walking the app's processes from the first one — the worker
* the pool has had longest, and under keep-alive the one holding the most live
* requests. Naming the worker is the whole of the difference: `delete` and
* `scale` both reach `God.deleteProcessId`, and `delete` is the one pm2
* publishes in its typings.
*/
async function releaseWorker(pmId) {
	const deleted = promisify(pm2.delete.bind(pm2))(pmId);
	await answeredInTime(`a release of worker ${pmId}`, deleted);
}
/** Every process the local daemon supervises, whatever app it belongs to. */
async function listSupervisedApps() {
	return answeredInTime("a process list", promisify(pm2.list.bind(pm2))());
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
async function scaleApp(appName, workers) {
	const supervisor = pm2;
	const scaled = new Promise((resolve, reject) => {
		supervisor.scale(appName, workers, (error) => {
			if (error && /same process number/i.test(error.message) === false) reject(error);
			else resolve();
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
async function reloadApp(appName, timeoutMs, declaration) {
	const reloaded = new Promise((resolve, reject) => {
		const processing = process.env["PM2_JSON_PROCESSING"];
		process.env["PM2_JSON_PROCESSING"] = "true";
		try {
			pm2.reload(appName, { current_conf: declaration }, (error) => {
				if (error) reject(error);
				else resolve();
			});
		} finally {
			if (processing === void 0) delete process.env["PM2_JSON_PROCESSING"];
			else process.env["PM2_JSON_PROCESSING"] = processing;
		}
	});
	await answeredInTime(`a reload of ${appName}`, reloaded, timeoutMs);
}
/** Hands one packet to a supervised process, bounded like every other call. */
async function sendToSupervisedProcess(pmId, packet) {
	const send = pm2.sendDataToProcessId.bind(pm2);
	const sent = new Promise((resolve, reject) => {
		send(pmId, packet, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
	await answeredInTime(`a packet to process ${pmId}`, sent);
}

//#endregion
export { connectToSupervisor, disconnectFromSupervisor, listSupervisedApps, releaseWorker, reloadApp, scaleApp, sendToSupervisedProcess, supervisorAvailable, watchWorkerMessages };