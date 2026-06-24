import { scheduleSynchronizedJob, validateCron } from "../utils/schedule.js";
import { durationToCron } from "./utils/duration-to-cron.js";
import { getLicenseManager } from "../license/manager.js";

//#region src/schedules/license.ts
let job = null;
async function stopLicenseCheck() {
	await job?.stop();
}
/**
* Schedule a license check at the license's validation_interval.
*/
async function schedule() {
	await job?.stop();
	const licenseManager = getLicenseManager();
	const license = await licenseManager.getLicense();
	if (license.meta.validation_interval === -1) return false;
	const cron = durationToCron(license.meta.validation_interval);
	if (!validateCron(cron)) return false;
	job = scheduleSynchronizedJob("license-check", cron, async () => {
		const jobLicense = await licenseManager.getLicense();
		if (jobLicense.meta.validation_interval !== license.meta.validation_interval) {
			await job?.stop();
			if (jobLicense.meta.validation_interval !== -1) await schedule();
		} else await licenseManager.refresh();
	});
	return true;
}

//#endregion
export { schedule as default, stopLicenseCheck };