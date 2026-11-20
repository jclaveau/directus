import { useEnv } from "@directus/env";
import { InvalidPayloadError } from "@directus/errors";

//#region src/middleware/extract-token.ts
/**
* Extract access token from
*
* - 'access_token' query parameter
* - 'Authorization' header
* - Session cookie
*
* and store it under req.token
*/
const extractToken = (req, _res, next) => {
	const env = useEnv();
	let token = null;
	if (req.query && req.query["access_token"]) token = req.query["access_token"];
	if (req.headers && req.headers.authorization) {
		const parts = req.headers.authorization.split(" ");
		if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
			if (token !== null) throw new InvalidPayloadError({ reason: "The request uses more than one method for including an access token" });
			token = parts[1];
		}
	}
	if (req.cookies && req.cookies[env["SESSION_COOKIE_NAME"]]) {
		if (token === null) token = req.cookies[env["SESSION_COOKIE_NAME"]];
	}
	req.token = token;
	next();
};
var extract_token_default = extractToken;

//#endregion
export { extract_token_default as default };