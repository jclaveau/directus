import { useLogger } from "../logger/index.js";
import { useMetrics } from "../metrics/lib/use-metrics.js";
import "../metrics/index.js";
import { validateCron } from "../utils/schedule.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";
import { CronJob } from "cron";

//#region src/schedules/metrics.ts
const METRICS_LOCK_TIMEOUT = 600 * 1e3;
let lockedAt = 0;
const logger = useLogger();
const metrics = useMetrics();
async function handleMetricsJob() {
	if (lockedAt !== 0 && lockedAt > Date.now() - METRICS_LOCK_TIMEOUT) return;
	lockedAt = Date.now();
	try {
		await metrics?.generate();
	} catch (err) {
		logger.warn(`An error was thrown while attempting metric generation`);
		logger.warn(err);
	} finally {
		lockedAt = 0;
	}
}
/**
* Schedule the metric generation
*
* @returns Whether or not metrics has been initialized
*/
async function schedule() {
	const env = useEnv();
	if (!toBoolean(env["METRICS_ENABLED"])) return false;
	if (!validateCron(String(env["METRICS_SCHEDULE"]))) return false;
	CronJob.from({
		cronTime: String(env["METRICS_SCHEDULE"]),
		onTick: handleMetricsJob,
		start: true
	});
	return true;
}

//#endregion
export { schedule as default, handleMetricsJob };