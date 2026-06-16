import { getEntitlementManager } from "../entitlements/manager.js";
import { isInCoreGracePeriod } from "./is-in-core-grace-period.js";
import "../index.js";

//#region src/license/utils/compute-license-status.ts
/**
* Compute the operational license status.
*/
async function computeLicenseStatus(license) {
	const entitlementManager = getEntitlementManager().fork(license?.entitlements ?? null);
	if (!license) {
		const isWithinLimits = await entitlementManager.checkAll();
		const isWithinCoreGracePeriod = await isInCoreGracePeriod();
		if (isWithinLimits === false && isWithinCoreGracePeriod) return "grace";
		if (isWithinLimits === false) return "locked";
		return "active";
	}
	if (await entitlementManager.checkAll() === false) return "locked";
	const now = Math.floor(Date.now() / 1e3);
	const expires = license.meta.expires_at ?? license.meta.renews_at ?? -1;
	if (expires === -1 || now < expires) return "active";
	if (expires < now && expires + license.meta.grace_period > now) return "grace";
	throw new Error("License is expired beyond grace period");
}

//#endregion
export { computeLicenseStatus };