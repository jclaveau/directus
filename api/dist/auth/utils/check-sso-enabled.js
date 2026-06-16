import async_handler_default from "../../utils/async-handler.js";
import { getEntitlementManager } from "../../license/entitlements/manager.js";
import { isSSOBypassAllowed } from "../../license/utils/is-sso-bypass-allowed.js";
import "../../license/index.js";
import { RouteNotFoundError } from "@directus/errors";

//#region src/auth/utils/check-sso-enabled.ts
const checkSsoEnabled = async_handler_default(async (req, _res, next) => {
	if (!(getEntitlementManager().isEntitled("sso_enabled") || await isSSOBypassAllowed())) throw new RouteNotFoundError({ path: req.path });
	return next();
});

//#endregion
export { checkSsoEnabled };