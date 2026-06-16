import { UserIntegrityCheckFlag } from "../packages/types/dist/index.js";
import { validateRemainingAdminCount } from "../permissions/modules/validate-remaining-admin/validate-remaining-admin-count.js";
import { fetchUserCount } from "./fetch-user-count/fetch-user-count.js";
import { checkUserLimits } from "../telemetry/utils/check-user-limits.js";
import { shouldCheckUserLimits } from "../telemetry/utils/should-check-user-limits.js";
import { LimitExceededError } from "@directus/errors";

//#region src/utils/validate-user-count-integrity.ts
async function validateUserCountIntegrity(options) {
	const validateUserLimits = (options.flags & UserIntegrityCheckFlag.UserLimits) !== 0;
	const validateRemainingAdminUsers = (options.flags & UserIntegrityCheckFlag.RemainingAdmins) !== 0;
	const envLimitCheck = validateUserLimits && shouldCheckUserLimits();
	if (!validateRemainingAdminUsers && !validateUserLimits) return;
	const adminOnly = validateRemainingAdminUsers && !validateUserLimits;
	const userCounts = await fetchUserCount({
		...options,
		adminOnly
	});
	if (validateUserLimits) await checkSeatsCount(userCounts, options.previousSeatCount);
	if (envLimitCheck) await checkUserLimits(userCounts);
	if (validateRemainingAdminUsers) validateRemainingAdminCount(userCounts.admin);
	if (validateUserLimits && options.previousSeatCount !== userCounts.admin + userCounts.app) {
		const { getEntitlementManager } = await import("../license/entitlements/manager.js");
		await getEntitlementManager().clearCache("seats", "sso_enabled");
	}
}
async function checkSeatsCount(userCounts, previousSeatCount) {
	const { getEntitlementManager } = await import("../license/entitlements/manager.js");
	const seatLimit = getEntitlementManager().getEntitlementLimit("seats");
	const newCount = userCounts.admin + userCounts.app;
	if (seatLimit === -1 || newCount <= seatLimit) return;
	if (previousSeatCount === void 0 || newCount > previousSeatCount) throw new LimitExceededError({ category: "seats" });
}
/**
* Must be called at the top of a mutation transaction, before any writes, using
* the transactional `knex` — that's the only way to read pre-state correctly on
* every database.
*/
async function captureSeatCount(knex, flags = UserIntegrityCheckFlag.None) {
	if ((flags & UserIntegrityCheckFlag.UserLimits) === 0) return void 0;
	const { countActiveSeats } = await import("../license/entitlements/lib/seats.js");
	return await countActiveSeats({ knex });
}

//#endregion
export { captureSeatCount, validateUserCountIntegrity };