import { useEnv } from "@directus/env";

//#region src/telemetry/utils/should-check-user-limits.ts
/**
* Confirm whether user limits needs to be checked
*/
function shouldCheckUserLimits() {
	const env = useEnv();
	if (Number(env["USERS_ADMIN_ACCESS_LIMIT"]) !== Infinity || Number(env["USERS_APP_ACCESS_LIMIT"]) !== Infinity || Number(env["USERS_API_ACCESS_LIMIT"]) !== Infinity) return true;
	return false;
}

//#endregion
export { shouldCheckUserLimits };