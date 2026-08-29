import { useLogger } from "../../logger/index.js";
import { promisify } from "node:util";
import pm2 from "pm2";

//#region src/processes/lib/supervisor-snapshot.ts
/**
* PM2 sets `PM2_HOME` in every process it supervises; its absence is how local
* dev and CI runs — which start the process directly — are told apart from a
* supervised deployment. Same probe the metrics aggregator uses.
*/
function supervisorAvailable() {
	return "PM2_HOME" in process.env;
}
const listApps = promisify(pm2.list.bind(pm2));
function instanceNumber(value) {
	const parsed = Number(value);
	return value !== void 0 && Number.isInteger(parsed) ? parsed : null;
}
/**
* Every process of the local PM2 daemon, including the ones too dead to answer
* for themselves — which is the whole point of asking the supervisor rather than
* only collecting self-reports.
*
* Returns `null` when there is no supervisor, or when the daemon could not be
* reached; the report says so rather than presenting a short list as complete.
*/
async function readSupervisedProcesses() {
	if (supervisorAvailable() === false) return null;
	try {
		return (await listApps()).map((app) => {
			const pm2Env = app.pm2_env ?? {};
			return {
				pid: app.pid ?? null,
				pmId: app.pm_id ?? null,
				name: app.name ?? "unknown",
				instance: instanceNumber(pm2Env.NODE_APP_INSTANCE),
				stats: {
					status: pm2Env.status ?? "unknown",
					restarts: pm2Env.restart_time ?? 0,
					unstableRestarts: pm2Env.unstable_restarts ?? 0,
					uptimeMs: pm2Env.pm_uptime ?? null,
					memoryBytes: app.monit?.memory ?? null,
					cpuPercent: app.monit?.cpu ?? null,
					maxMemoryRestartBytes: pm2Env.max_memory_restart ?? null,
					execMode: pm2Env.exec_mode ?? null,
					configuredInstances: pm2Env.instances ?? null
				}
			};
		});
	} catch (error) {
		useLogger().warn(error, "Could not read the PM2 process list");
		return null;
	}
}

//#endregion
export { readSupervisedProcesses, supervisorAvailable };