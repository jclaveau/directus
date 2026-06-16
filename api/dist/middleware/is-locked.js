import async_handler_default from "../utils/async-handler.js";
import { getLicenseManager } from "../license/manager.js";
import { ResourceRestrictedError } from "@directus/errors";

//#region src/middleware/is-locked.ts
/**
* Throws an error if the license is in a locked state
*/
const handler = (resource) => async_handler_default(async (_req, _res, next) => {
	if (await getLicenseManager().isLocked()) throw new ResourceRestrictedError({ category: resource });
	return next();
});
var is_locked_default = handler;

//#endregion
export { is_locked_default as default, handler };