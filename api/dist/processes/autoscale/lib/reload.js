import { useLogger } from "../../../logger/index.js";
import { useBus } from "../../../bus/lib/use-bus.js";
import "../../../bus/index.js";
import { reloadApp } from "../../supervisor/lib/client.js";
import "../../supervisor/index.js";
import { SHARED_SETTINGS_COLUMNS, readSharedSettings } from "../../lib/shared-settings.js";
import { reloadDeclaration } from "./supervisor-shared-settings.js";

//#region src/processes/autoscale/lib/reload.ts
/**
* The channel a rolling restart is asked for on.
*
* Asked for rather than done: the worker serving the request is a member of
* the pool being restarted, so a restart it ran itself would retire it partway
* through and the request would never be answered. The process that scales the
* pool is not in it, and it already holds the supervisor connection.
*/
const RELOAD_CHANNEL = "autoscaleReload";
/** What the supervisor gets on top of what replacing the workers can cost. */
const RELOAD_SLACK_MS = 3e4;
let askedAt = null;
let pending = false;
let running = false;
let finishedAt = null;
let error = null;
/** Where the pool's last rolling restart got to, as this process knows it. */
function reloadState() {
	return {
		askedAt,
		running,
		finishedAt,
		error
	};
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
function reloading() {
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
function reloadBudgetMs(workers, declaration) {
	const perWorker = (declaration["listen_timeout"] ?? 3e3) + (declaration["kill_timeout"] ?? 1600);
	return Math.max(1, workers) * perWorker + RELOAD_SLACK_MS;
}
/**
* Why the pool cannot be given a rolling restart, or `null` where it can.
*
* Refused at the asking end as well as reported here, so a request that would
* take the pool down rather than roll it is answered with the reason instead
* of with a restart.
*/
function reloadRefusal(runners) {
	const runner = runners[0];
	if (runner === void 0) return "no process reported that it is scaling a pool, so nothing would hear this";
	if (runner.state.reload.running) return "the pool is already being restarted";
	const supervisor = runner.state.supervisor;
	if (supervisor === null) return "the supervisor reported no worker of this pool to restart";
	if (supervisor.execMode !== "cluster_mode") return `the pool runs in ${supervisor.execMode}, where a worker is stopped before its replacement starts`;
	return null;
}
/**
* Listen for restart requests.
*
* Only the process that scales the pool subscribes: a worker of the pool would
* be acting on its own retirement.
*/
function initAutoscaleReload() {
	useBus().subscribe(RELOAD_CHANNEL, ({ at }) => {
		if (reloading()) {
			useLogger().info("[autoscale] a rolling restart is already under way");
			return;
		}
		askedAt = Number.isFinite(at) ? at : Date.now();
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
function askForReload() {
	const at = Date.now();
	useBus().publish(RELOAD_CHANNEL, { at });
	return {
		askedAt: at,
		running: false,
		finishedAt: null,
		error: null
	};
}
/**
* Start the restart that was asked for, if one was.
*
* Started beside the loop rather than inside it: replacing a pool takes as
* long as the pool is large, and a tick awaiting that would stop sampling and
* stop reporting for the whole of it — leaving the page that asked for the
* restart unable to say whether it is happening.
*/
function beginAskedReload(appName, workers) {
	if (pending === false || running) return;
	const logger = useLogger();
	pending = false;
	running = true;
	error = null;
	logger.info(`[autoscale] restarting the ${appName} pool, worker by worker`);
	readSharedSettings(SHARED_SETTINGS_COLUMNS.supervisor).then((sharedSettings) => {
		const declaration = reloadDeclaration(sharedSettings);
		return reloadApp(appName, reloadBudgetMs(workers, declaration), declaration);
	}).then(() => {
		logger.info(`[autoscale] the ${appName} pool finished restarting`);
	}).catch((failure) => {
		error = failure instanceof Error ? failure.message : String(failure);
		logger.error(failure, "[autoscale] a rolling restart failed");
	}).finally(() => {
		running = false;
		finishedAt = Date.now();
	});
}

//#endregion
export { askForReload, beginAskedReload, initAutoscaleReload, reloadBudgetMs, reloadRefusal, reloadState, reloading };