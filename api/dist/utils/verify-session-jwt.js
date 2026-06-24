import database_default from "../database/index.js";
import { InvalidCredentialsError } from "@directus/errors";

//#region src/utils/verify-session-jwt.ts
/**
* Verifies the associated session is still available and valid.
*
* @returns The oauth_client for the session, or null for regular sessions.
* @throws If session not found.
*/
async function verifySessionJWT(payload) {
	const session = await database_default().select("oauth_client").from("directus_sessions").where({
		token: payload["session"],
		user: payload["id"] || null,
		share: payload["share"] || null
	}).andWhere("expires", ">=", /* @__PURE__ */ new Date()).first();
	if (!session) throw new InvalidCredentialsError();
	return { oauth_client: session.oauth_client ?? null };
}

//#endregion
export { verifySessionJWT };