import async_handler_default from "../utils/async-handler.js";
import { isAdmin } from "../utils/is-admin.js";
import { ForbiddenError } from "@directus/errors";

//#region src/middleware/is-admin.ts
/**
* Require the request to have been  made by an admin
*/
const handler = async (req, _res, next) => {
	if (!isAdmin(req.accountability)) throw new ForbiddenError();
	return next();
};
var is_admin_default = async_handler_default(handler);

//#endregion
export { is_admin_default as default, handler };