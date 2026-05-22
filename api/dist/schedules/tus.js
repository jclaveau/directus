import { RESUMABLE_UPLOADS } from "../constants.js";
import { getSchema } from "../utils/get-schema.js";
import { scheduleSynchronizedJob, validateCron } from "../utils/schedule.js";
import { createTusServer } from "../services/tus/server.js";
import "../services/tus/index.js";

//#region src/schedules/tus.ts
/**
* Schedule the tus cleanup
*
* @returns Whether or not tus cleanup has been initialized
*/
async function schedule() {
	if (!RESUMABLE_UPLOADS.ENABLED) return false;
	if (validateCron(RESUMABLE_UPLOADS.SCHEDULE)) scheduleSynchronizedJob("tus-cleanup", RESUMABLE_UPLOADS.SCHEDULE, async () => {
		const [tusServer, cleanupServer] = await createTusServer({ schema: await getSchema() });
		await tusServer.cleanUpExpiredUploads();
		cleanupServer();
	});
	return true;
}

//#endregion
export { schedule as default };