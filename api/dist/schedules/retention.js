import { useLogger } from "../logger/index.js";
import { getMilliseconds } from "../utils/get-milliseconds.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import { scheduleSynchronizedJob, validateCron } from "../utils/schedule.js";
import { useLock } from "../lock/lib/use-lock.js";
import "../lock/index.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";
import { Action } from "@directus/constants";

//#region src/schedules/retention.ts
const env = useEnv();
const retentionLockKey = "schedule--data-retention";
const retentionLockTimeout = 600 * 1e3;
const ACTIVITY_RETENTION_TIMEFRAME = getMilliseconds(env["ACTIVITY_RETENTION"]);
const FLOW_LOGS_RETENTION_TIMEFRAME = getMilliseconds(env["FLOW_LOGS_RETENTION"]);
const REVISIONS_RETENTION_TIMEFRAME = getMilliseconds(env["REVISIONS_RETENTION"]);
const retentionTasks = [{
	collection: "directus_activity",
	where: [
		"action",
		"!=",
		Action.RUN
	],
	timeframe: ACTIVITY_RETENTION_TIMEFRAME
}, {
	collection: "directus_activity",
	where: [
		"action",
		"=",
		Action.RUN
	],
	timeframe: FLOW_LOGS_RETENTION_TIMEFRAME
}];
async function handleRetentionJob() {
	const database = database_default();
	const logger = useLogger();
	const lock = useLock();
	const batch = Number(env["RETENTION_BATCH"]);
	const lockTime = await lock.get(retentionLockKey);
	const now = Date.now();
	const helpers = getHelpers(database);
	if (lockTime && Number(lockTime) > now - retentionLockTimeout) return;
	await lock.set(retentionLockKey, Date.now());
	for (const task of retentionTasks) {
		let count = 0;
		if (task.timeframe === void 0) continue;
		do {
			const subquery = database.queryBuilder().select(`${task.collection}.id`).from(task.collection).where("timestamp", "<", helpers.date.parse(new Date(Date.now() - task.timeframe))).limit(batch);
			if (task.where) subquery.where(...task.where);
			if (task.join) subquery.join(...task.join);
			try {
				let records = [];
				const isMySQL = helpers.schema.isOneOfClients(["mysql"]);
				if (isMySQL) {
					records = await subquery.then((r) => r.map((r$1) => r$1.id));
					if (records.length === 0) break;
				}
				count = await database(task.collection).whereIn("id", isMySQL ? records : subquery).delete();
			} catch (error) {
				logger.error(error, `Retention failed for Collection ${task.collection}`);
				break;
			}
			await lock.set(retentionLockKey, Date.now());
		} while (count >= batch);
	}
	await lock.delete(retentionLockKey);
}
/**
* Schedule the retention tracking
*
* @returns Whether or not retention has been initialized
*/
async function schedule() {
	const env$1 = useEnv();
	if (!toBoolean(env$1["RETENTION_ENABLED"])) return false;
	if (!validateCron(String(env$1["RETENTION_SCHEDULE"]))) return false;
	if (!ACTIVITY_RETENTION_TIMEFRAME || ACTIVITY_RETENTION_TIMEFRAME && REVISIONS_RETENTION_TIMEFRAME && ACTIVITY_RETENTION_TIMEFRAME > REVISIONS_RETENTION_TIMEFRAME) retentionTasks.push({
		collection: "directus_revisions",
		join: [
			"directus_activity",
			"directus_revisions.activity",
			"directus_activity.id"
		],
		timeframe: REVISIONS_RETENTION_TIMEFRAME
	});
	scheduleSynchronizedJob("retention", String(env$1["RETENTION_SCHEDULE"]), handleRetentionJob);
	return true;
}

//#endregion
export { schedule as default, handleRetentionJob };