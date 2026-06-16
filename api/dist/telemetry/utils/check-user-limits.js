import "../../utils/fetch-user-count/fetch-user-count.js";
import { useEnv } from "@directus/env";
import { LimitExceededError } from "@directus/errors";

//#region src/telemetry/utils/check-user-limits.ts
const env = useEnv();
/**
* Ensure that user limits are not reached
*/
async function checkUserLimits(userCounts) {
	if (userCounts.admin > Number(env["USERS_ADMIN_ACCESS_LIMIT"])) throw new LimitExceededError({ category: "Active Admin users" });
	if (userCounts.app + userCounts.admin > Number(env["USERS_APP_ACCESS_LIMIT"])) throw new LimitExceededError({ category: "Active App users" });
	if (userCounts.api > Number(env["USERS_API_ACCESS_LIMIT"])) throw new LimitExceededError({ category: "Active API users" });
}

//#endregion
export { checkUserLimits };