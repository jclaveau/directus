import { useLogger } from "../logger/index.js";
import { scheduleSynchronizedJob, validateCron } from "../utils/schedule.js";
import { getSchema } from "../utils/get-schema.js";
import { McpOAuthService } from "../services/mcp-oauth/index.js";
import { useEnv } from "@directus/env";

//#region src/schedules/oauth-cleanup.ts
async function scheduleOAuthCleanup() {
	const env = useEnv();
	const schedule = String(env["MCP_OAUTH_CLEANUP_SCHEDULE"]);
	if (!validateCron(schedule)) {
		useLogger().error(`Invalid MCP_OAUTH_CLEANUP_SCHEDULE: "${schedule}". OAuth cleanup disabled.`);
		return false;
	}
	scheduleSynchronizedJob("oauth-cleanup", schedule, async () => {
		try {
			await new McpOAuthService({ schema: await getSchema() }).cleanup();
		} catch (error) {
			useLogger().error(error, "MCP OAuth cleanup failed");
		}
	});
	return true;
}

//#endregion
export { scheduleOAuthCleanup as default };