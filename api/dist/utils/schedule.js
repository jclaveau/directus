import { SynchronizedClock } from "../synchronization.js";
import { CronJob, validateCronExpression } from "cron";

//#region src/utils/schedule.ts
function validateCron(rule) {
	return validateCronExpression(rule).valid;
}
function scheduleSynchronizedJob(id, rule, cb) {
	const clock = new SynchronizedClock(`${id}:${rule}`);
	const job = CronJob.from({
		cronTime: rule,
		onTick: async (fireDate) => {
			const nextTimestamp = job.nextDate().toMillis();
			if (await clock.set(nextTimestamp)) await cb(fireDate);
		},
		start: true
	});
	const stop = async () => {
		job.stop();
		await clock.reset();
	};
	return { stop };
}

//#endregion
export { scheduleSynchronizedJob, validateCron };