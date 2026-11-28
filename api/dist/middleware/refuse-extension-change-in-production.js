import { useEnv } from "@directus/env";
import { RouteNotFoundError } from "@directus/errors";

//#region src/middleware/refuse-extension-change-in-production.ts
/**
* The Marketplace installs, reinstalls and uninstalls extensions on a running
* server, so it is open only when `MARKETPLACE_ENABLED` is true, which the boot
* refuses in production: there extensions change only with a deploy (#627).
*/
function isMarketplaceEnabled() {
	return useEnv()["MARKETPLACE_ENABLED"] === true;
}
const refuseExtensionChangeInProduction = (req, _res, next) => {
	if (!isMarketplaceEnabled()) throw new RouteNotFoundError({ path: req.originalUrl.split("?")[0] });
	next();
};

//#endregion
export { isMarketplaceEnabled, refuseExtensionChangeInProduction };