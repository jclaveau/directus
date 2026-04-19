import { validateRemainingAdminCount } from "../permissions/modules/validate-remaining-admin/validate-remaining-admin-count.js";
import { fetchUserCount } from "./fetch-user-count/fetch-user-count.js";
import { checkUserLimits } from "../telemetry/utils/check-user-limits.js";
import { shouldCheckUserLimits } from "../telemetry/utils/should-check-user-limits.js";

//#region src/utils/validate-user-count-integrity.ts
let UserIntegrityCheckFlag = /* @__PURE__ */ function(UserIntegrityCheckFlag$1) {
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["None"] = 0] = "None";
	/** Check if the number of remaining admin users is greater than 0 */
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["RemainingAdmins"] = 1] = "RemainingAdmins";
	/** Check if the number of users is within the limits */
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["UserLimits"] = 2] = "UserLimits";
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["All"] = 3] = "All";
	return UserIntegrityCheckFlag$1;
}({});
async function validateUserCountIntegrity(options) {
	const validateUserLimits = (options.flags & UserIntegrityCheckFlag.UserLimits) !== 0;
	const validateRemainingAdminUsers = (options.flags & UserIntegrityCheckFlag.RemainingAdmins) !== 0;
	const limitCheck = validateUserLimits && shouldCheckUserLimits();
	if (!validateRemainingAdminUsers && !limitCheck) return;
	const adminOnly = validateRemainingAdminUsers && !limitCheck;
	const userCounts = await fetchUserCount({
		...options,
		adminOnly
	});
	if (limitCheck) await checkUserLimits(userCounts);
	if (validateRemainingAdminUsers) validateRemainingAdminCount(userCounts.admin);
}

//#endregion
export { UserIntegrityCheckFlag, validateUserCountIntegrity };