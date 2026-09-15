import { useLogger } from "../../logger/index.js";
import { getReport } from "./get-report.js";
import { sendReport } from "./send-report.js";
import { getRandomWaitTime } from "../utils/get-random-wait-time.js";
import { getNodeEnv } from "@directus/utils/node";
import { setTimeout } from "timers/promises";

//#region src/telemetry/lib/track.ts
/**
* Generate and send a report. Will log on error, but not throw. No need to be awaited
*
* @param opts Options for the tracking
* @param opts.wait Whether or not to wait a random amount of time between 0 and 30 minutes
* @returns whether or not the tracking was successful
*/
const track = async (opts = { wait: true }) => {
	const logger = useLogger();
	if (opts.wait) await setTimeout(getRandomWaitTime());
	try {
		await sendReport(await getReport());
		return true;
	} catch (err) {
		if (getNodeEnv() === "development") logger.error(err);
		return false;
	}
};

//#endregion
export { track };