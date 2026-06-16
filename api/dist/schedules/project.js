import database_default from "../database/index.js";
import { scheduleSynchronizedJob } from "../utils/schedule.js";
import { sendReport } from "../telemetry/lib/send-report.js";
import "../telemetry/index.js";
import { random } from "lodash-es";
import { version } from "directus/version";

//#region src/schedules/project.ts
/**
* Schedule the project status job
*/
async function schedule() {
	const db = database_default();
	scheduleSynchronizedJob("project-status", `${random(59)} ${random(23)} * * *`, async () => {
		const { project_status,...ownerInfo } = await db.select("project_status", "project_owner", "project_usage", "org_name", "product_updates", "project_id").from("directus_settings").first();
		if (project_status !== "pending") return;
		try {
			await sendReport({
				version,
				...ownerInfo
			});
			await db.update("project_status", "").from("directus_settings");
		} catch {}
	});
}

//#endregion
export { schedule as default };