import async_handler_default from "../utils/async-handler.js";
import { SESSION_COOKIE_OPTIONS } from "../constants.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { createDefaultAccountability } from "../permissions/utils/create-default-accountability.js";
import { getIPFromReq } from "../utils/get-ip-from-req.js";
import { getAccountabilityForToken } from "../utils/get-accountability-for-token.js";
import { useEnv } from "@directus/env";
import { ErrorCode, isDirectusError } from "@directus/errors";
import { isEqual } from "lodash-es";

//#region src/middleware/authenticate.ts
/**
* Verify the passed JWT and assign the user ID and role to `req`
*/
const handler = async (req, res, next) => {
	const env = useEnv();
	const defaultAccountability = createDefaultAccountability({ ip: getIPFromReq(req) });
	const userAgent = req.get("user-agent")?.substring(0, 1024);
	if (userAgent) defaultAccountability.userAgent = userAgent;
	const origin = req.get("origin");
	if (origin) defaultAccountability.origin = origin;
	const database = database_default();
	const customAccountability = await emitter_default.emitFilter("authenticate", defaultAccountability, { req }, {
		database,
		schema: null,
		accountability: null
	});
	if (customAccountability && isEqual(customAccountability, defaultAccountability) === false) {
		req.accountability = customAccountability;
		return next();
	}
	try {
		req.accountability = await getAccountabilityForToken(req.token, defaultAccountability);
	} catch (err) {
		if (isDirectusError(err, ErrorCode.InvalidCredentials) || isDirectusError(err, ErrorCode.InvalidToken)) {
			if (req.cookies[env["SESSION_COOKIE_NAME"]] === req.token) res.clearCookie(env["SESSION_COOKIE_NAME"], SESSION_COOKIE_OPTIONS);
		}
		throw err;
	}
	return next();
};
var authenticate_default = async_handler_default(handler);

//#endregion
export { authenticate_default as default, handler };