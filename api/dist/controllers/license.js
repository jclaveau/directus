import async_handler_default from "../utils/async-handler.js";
import { getEntitlementManager } from "../license/entitlements/manager.js";
import { respond } from "../middleware/respond.js";
import { GRACE_PERIOD_MS, getCoreGraceExpiresAt } from "../license/utils/get-core-grace-expires-at.js";
import { getLicenseManager } from "../license/manager.js";
import "../license/index.js";
import is_admin_default from "../middleware/is-admin.js";
import { InvalidPayloadError } from "@directus/errors";
import express from "express";
import { fromZodError } from "zod-validation-error";
import { ResolveInput } from "@directus/license";

//#region src/controllers/license.ts
const router = express.Router();
router.get("/", is_admin_default, async_handler_default(async (_req, res, next) => {
	const licenseManager = getLicenseManager();
	const entitlementManager = getEntitlementManager();
	const [license, status, downgradeReason, seatUsage, collectionUsage, flowUsage] = await Promise.all([
		licenseManager.getLicense(),
		licenseManager.getStatus(),
		licenseManager.getDowngradeReason(),
		entitlementManager.getUsage("seats"),
		entitlementManager.getUsage("collections"),
		entitlementManager.getUsage("flows")
	]);
	const source = licenseManager.getSource();
	let expiresAt = license.meta.expires_at;
	let gracePeriod = license.meta.grace_period;
	if (source === null && status === "grace") {
		const coreGraceExpiresAt = await getCoreGraceExpiresAt();
		if (coreGraceExpiresAt !== null) {
			expiresAt = coreGraceExpiresAt;
			gracePeriod = Math.floor(GRACE_PERIOD_MS / 1e3);
		}
	}
	const payload = {
		name: license.meta.name,
		status,
		source,
		downgrade_reason: downgradeReason,
		renews_at: license.meta.renews_at,
		expires_at: expiresAt,
		entitlements: license.entitlements,
		grace_period: gracePeriod,
		offline: license.meta.offline,
		usage: {
			seats: seatUsage,
			collections: collectionUsage,
			flows: flowUsage
		}
	};
	res.locals["payload"] = { data: payload };
	return next();
}), respond);
router.post("/", is_admin_default, async_handler_default(async (req, _res, next) => {
	if (!req.body.license_key) throw new InvalidPayloadError({ reason: "A \"license_key\" is required" });
	await getLicenseManager().activate(req.body.license_key);
	return next();
}), respond);
router.patch("/", is_admin_default, async_handler_default(async (req, _res, next) => {
	if (!req.body.license_key) throw new InvalidPayloadError({ reason: "A \"license_key\" is required" });
	await getLicenseManager().update(req.body.license_key);
	return next();
}), respond);
router.delete("/", is_admin_default, async_handler_default(async (_req, _res, next) => {
	await getLicenseManager().deactivate();
	return next();
}), respond);
router.post("/preview", async_handler_default(async (req, res, next) => {
	if (!req.body.license_key) throw new InvalidPayloadError({ reason: "A \"license_key\" is required" });
	const preview = await getLicenseManager().preview(req.body.license_key);
	const payload = {
		plan_name: preview.plan_name,
		expires_at: preview.expires_at,
		renews_at: preview.renews_at,
		production_enabled: preview.entitlements.production_enabled.override ?? preview.entitlements.production_enabled.default
	};
	res.locals["payload"] = { data: payload };
	return next();
}), respond);
router.get("/portal", is_admin_default, async_handler_default(async (_req, res) => {
	const portal = await getLicenseManager().billingPortalUrl();
	res.redirect(portal);
}));
router.get("/addons", is_admin_default, async_handler_default(async (_req, res, next) => {
	const payload = await getLicenseManager().availableAddons();
	res.locals["payload"] = { data: payload };
	return next();
}), respond);
router.patch("/addons/:id", is_admin_default, async_handler_default(async (req, _res, next) => {
	if (typeof req.body.quantity !== "number") throw new InvalidPayloadError({ reason: "A numbered \"quantity\" is required" });
	await getLicenseManager().setAddonQuantity({
		addonId: req.params["id"],
		quantity: req.body.quantity
	});
	return next();
}), respond);
router.delete("/addons/:id", is_admin_default, async_handler_default(async (req, _res, next) => {
	await getLicenseManager().removeAddon(req.params["id"]);
	return next();
}), respond);
router.post("/pending-resolution", is_admin_default, async_handler_default(async (req, res, next) => {
	const payload = await getLicenseManager().pendingResolution({
		adminId: req.accountability.user,
		licenseKey: req.body.license_key
	});
	res.locals["payload"] = { data: payload };
	return next();
}), respond);
router.post("/resolve", is_admin_default, async_handler_default(async (req, _res, next) => {
	const { error, data } = ResolveInput.safeParse(req.body);
	if (error) throw new InvalidPayloadError({ reason: fromZodError(error).message });
	await getLicenseManager().applyResolution(data, { accountability: req.accountability });
	return next();
}), respond);
var license_default = router;

//#endregion
export { license_default as default };