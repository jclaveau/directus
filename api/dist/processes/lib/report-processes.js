import { nodeId } from "../../utils/node-id.js";
import { useLogger } from "../../logger/index.js";
import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { PROCESSES_QUERY_CHANNEL, PROCESSES_REPORT_CHANNEL } from "../types/messages.js";
import { processesReplicaId, processesReportEnabled, processesServiceName, reportedProcessDetails } from "./processes-config.js";
import { resolveReportedEnv } from "./redact-env.js";
import { readSupervisedProcesses, supervisorAvailable } from "./supervisor-snapshot.js";
import { hostname } from "node:os";

//#region src/processes/lib/report-processes.ts
function instanceNumber() {
	const parsed = Number(process.env["NODE_APP_INSTANCE"]);
	return Number.isInteger(parsed) ? parsed : null;
}
function runtimeStats() {
	const memory = process.memoryUsage();
	return {
		rssBytes: memory.rss,
		heapUsedBytes: memory.heapUsed,
		heapTotalBytes: memory.heapTotal,
		externalBytes: memory.external,
		uptimeMs: Math.round(process.uptime() * 1e3),
		nodeVersion: process.version
	};
}
/**
* One process per replica attaches the container-wide `pm2 list`; the others would
* only publish a copy of it. Instance 0 is the deterministic choice, and when it
* is the one that is down the collector falls back to the self-reports rather
* than claiming the replica has no supervisor.
*/
function shouldReportSupervisor() {
	return supervisorAvailable() && instanceNumber() === 0;
}
async function reportSelf(query) {
	const allowed = reportedProcessDetails();
	const details = query.details.filter((detail) => allowed.includes(detail));
	const carries = (detail) => details.includes(detail);
	const message = {
		requestId: query.requestId,
		service: processesServiceName(),
		replicaId: processesReplicaId(),
		hostname: hostname(),
		supervised: supervisorAvailable(),
		self: {
			nodeId,
			pid: process.pid,
			pmId: Number.isInteger(Number(process.env["pm_id"])) ? Number(process.env["pm_id"]) : null,
			instance: instanceNumber(),
			name: process.env["name"] ?? "directus",
			runtime: carries("stats") ? runtimeStats() : null,
			env: carries("env") ? resolveReportedEnv() : null
		},
		supervisor: carries("stats") && shouldReportSupervisor() ? await readSupervisedProcesses() : null
	};
	await useBus().publish(PROCESSES_REPORT_CHANNEL, message);
}
/**
* Answer processes queries for the lifetime of this process. Every node
* subscribes, so a collector on any one of them reaches all of them — as far as
* the bus reaches, which without Redis is this process alone.
*/
async function initProcessReports() {
	if (processesReportEnabled() === false) return;
	const logger = useLogger();
	const onQuery = (query) => {
		reportSelf(query).catch((error) => {
			logger.warn(error, "Could not report this process to a processes query");
		});
	};
	await useBus().subscribe(PROCESSES_QUERY_CHANNEL, onQuery);
}

//#endregion
export { initProcessReports };