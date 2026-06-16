import async_handler_default from "../../utils/async-handler.js";
import { getEntitlementManager } from "../../license/entitlements/manager.js";
import "../../license/index.js";
import { useEnv } from "@directus/env";
import { RouteNotFoundError } from "@directus/errors";
import { toBoolean } from "@directus/utils";

//#region src/auth/utils/check-local-disabled.ts
const checkLocalAuthDisabled = async_handler_default(async (req, _res, next) => {
	const env = useEnv();
	if (getEntitlementManager().isEntitled("sso_enabled") && toBoolean(env["AUTH_DISABLE_DEFAULT"])) throw new RouteNotFoundError({ path: req.path });
	return next();
});

//#endregion
export { checkLocalAuthDisabled };