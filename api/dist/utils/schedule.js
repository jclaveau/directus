import { SynchronizedClock } from "../synchronization.js";
import cron from "cron-parser";
import schedule from "node-schedule";

//#region src/utils/schedule.ts
function validateCron(rule) {
	try {
		cron.parseExpression(rule);
	} catch {
		return false;
	}
	return true;
}
function scheduleSynchronizedJob(id, rule, cb) {
	const clock = new SynchronizedClock(`${id}:${rule}`);
	const job = schedule.scheduleJob(rule, async (fireDate) => {
		const nextTimestamp = job.nextInvocation().getTime();
		if (await clock.set(nextTimestamp)) await cb(fireDate);
	});
	const stop = async () => {
		job.cancel();
		await clock.reset();
	};
	return { stop };
}

//#endregion
export { scheduleSynchronizedJob, validateCron };