import { RouteNotFoundError } from "@directus/errors";
import { getNodeEnv } from "@directus/utils/node";

//#region src/middleware/refuse-extension-change-in-production.ts
/**
* The Marketplace installs, reinstalls and uninstalls extensions on a running
* server. In production extensions change only with a deploy (#627), so it is
* open outside production only. An unset NODE_ENV counts as production.
*/
function isMarketplaceEnabled() {
	return (getNodeEnv() || "production") !== "production";
}
const refuseExtensionChangeInProduction = (req, _res, next) => {
	if (!isMarketplaceEnabled()) throw new RouteNotFoundError({ path: req.originalUrl.split("?")[0] });
	next();
};

//#endregion
export { isMarketplaceEnabled, refuseExtensionChangeInProduction };