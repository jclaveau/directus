import { useLogger } from "../logger/index.js";
import { migrationsAreOutstanding } from "../outstanding-migrations.js";
import { SynchronizedClock } from "../synchronization.js";
import { CronExpressionParser } from "cron-parser";
import schedule from "node-schedule";

//#region src/utils/schedule.ts
function validateCron(rule) {
	try {
		CronExpressionParser.parse(rule);
	} catch {
		return false;
	}
	return true;
}
function scheduleSynchronizedJob(id, rule, cb) {
	const clock = new SynchronizedClock(`${id}:${rule}`);
	let heldForMigrations = false;
	const job = schedule.scheduleJob(rule, async (fireDate) => {
		if (migrationsAreOutstanding()) {
			if (!heldForMigrations) {
				heldForMigrations = true;
				useLogger().warn(`[schedule] holding job "${id}" until the database has recorded every migration this build ships`);
			}
			return;
		}
		if (heldForMigrations) {
			heldForMigrations = false;
			useLogger().info(`[schedule] resuming job "${id}"`);
		}
		const nextInvocation = job.nextInvocation();
		if (!nextInvocation) return;
		const nextTimestamp = nextInvocation.getTime();
		try {
			if (await clock.set(nextTimestamp)) await cb(fireDate);
		} catch (error) {
			useLogger().warn(error, `[schedule] job "${id}" failed: ${error}`);
		}
	});
	const stop = async () => {
		job.cancel();
		await clock.reset();
	};
	return { stop };
}

//#endregion
export { scheduleSynchronizedJob, validateCron };