import { getCache } from "../cache.js";
import { scheduleSynchronizedJob } from "../utils/schedule.js";
import { track } from "../telemetry/lib/track.js";
import "../telemetry/index.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/schedules/telemetry.ts
/**
* Exported to be able to test the anonymous callback function
*/
const jobCallback = () => {
	track();
};
/**
* Schedule the telemetry tracking. Will generate a report on start, and set a schedule to report
* every 6 hours
*
* @returns Whether or not telemetry has been initialized
*/
async function schedule() {
	if (toBoolean(useEnv()["TELEMETRY"]) === false) return false;
	scheduleSynchronizedJob("telemetry", "0 */6 * * *", jobCallback);
	const { lockCache } = getCache();
	if (!await lockCache.get("telemetry-lock")) {
		await lockCache.set("telemetry-lock", true, 3e4);
		track({ wait: false });
	}
	return true;
}

//#endregion
export { schedule as default, jobCallback };