import { GRACE_PERIOD_MS, getCoreGraceExpiresAt } from "./get-core-grace-expires-at.js";

//#region src/license/utils/is-in-core-grace-period.ts
async function isInCoreGracePeriod() {
	const expiresAtSec = await getCoreGraceExpiresAt();
	if (expiresAtSec === null) return false;
	return Date.now() - expiresAtSec * 1e3 < GRACE_PERIOD_MS;
}

//#endregion
export { isInCoreGracePeriod };