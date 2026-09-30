import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { RouteNotFoundError } from "@directus/errors";

//#region src/controllers/not-found.ts
/**
* Handles not found routes.
*
* - If a hook throws an error, the error gets forwarded to the error handler.
* - If a hook returns true, the handler assumes the response has been
*   processed and won't generate a response.
*
* @param req
* @param res
* @param next
*/
const notFound = async (req, res, next) => {
	try {
		if (await emitter_default.emitFilter("request.not_found", false, {
			request: req,
			response: res
		}, {
			database: database_default(),
			schema: req.schema,
			accountability: req.accountability ?? null
		})) return next();
		next(new RouteNotFoundError({ path: req.path }));
	} catch (err) {
		next(err);
	}
};
var not_found_default = notFound;

//#endregion
export { not_found_default as default };