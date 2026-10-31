import { InvalidTokenError, ServiceUnavailableError, TokenExpiredError } from "@directus/errors";
import jwt from "jsonwebtoken";

//#region src/utils/jwt.ts
function verifyJWT(token, secret) {
	let payload;
	try {
		payload = jwt.verify(token, secret, { issuer: "directus" });
	} catch (err) {
		if (err instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
		else if (err instanceof jwt.JsonWebTokenError) throw new InvalidTokenError();
		else throw new ServiceUnavailableError({
			service: "jwt",
			reason: `Couldn't verify token.`
		});
	}
	return payload;
}
function verifyAccessJWT(token, secret) {
	const payload = verifyJWT(token, secret);
	if (payload.role === void 0 || payload.app_access === void 0 || payload.admin_access === void 0) throw new InvalidTokenError();
	return payload;
}

//#endregion
export { verifyAccessJWT, verifyJWT };