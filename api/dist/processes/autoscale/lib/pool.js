import { listSupervisedApps } from "../../supervisor/lib/client.js";
import "../../supervisor/index.js";
import { declaredBy } from "./supervisor.js";

//#region src/processes/autoscale/lib/pool.ts
/** Workers whose restart count is higher than it was in `before`. */
function restarted(before, after) {
	for (const [pmId, restarts] of after) {
		const previous = before.get(pmId);
		if (previous !== void 0 && restarts > previous) return true;
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
async function readPool(appName, warmupSeconds) {
	const workers = (await listSupervisedApps()).filter((app) => app.name === appName);
	const matureSince = Date.now() - warmupSeconds * 1e3;
	const onlineWorkers = [];
	const restartsByWorker = /* @__PURE__ */ new Map();
	let pendingWorkers = 0;
	let failedWorkers = 0;
	let warmingWorkers = 0;
	let supervisor = null;
	for (const worker of workers) {
		const env = worker.pm2_env;
		if (env !== void 0 && supervisor === null) supervisor = declaredBy(env);
		if (worker.pm_id !== void 0) restartsByWorker.set(worker.pm_id, env?.restart_time ?? 0);
		if (env?.status === "launching" || env?.status === "waiting restart") pendingWorkers += 1;
		else if (env?.status === "online") {
			const mature = (env.pm_uptime ?? 0) <= matureSince;
			onlineWorkers.push({
				pid: worker.pid ?? 0,
				pmId: worker.pm_id ?? 0,
				cpuPercent: worker.monit?.cpu ?? 0,
				memoryBytes: worker.monit?.memory ?? 0,
				mature
			});
			if (mature === false) warmingWorkers += 1;
		} else if (env?.status === "errored") failedWorkers += 1;
	}
	return {
		pendingWorkers,
		failedWorkers,
		warmingWorkers,
		onlineWorkers,
		restartsByWorker,
		supervisor
	};
}

//#endregion
export { readPool, restarted };