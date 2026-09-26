import database_default from "../database/index.js";
import { InvalidCredentialsError } from "@directus/errors";

//#region src/utils/verify-session-jwt.ts
/**
* Verifies the associated session is still available and valid.
*
* @throws If session not found.
*/
async function verifySessionJWT(payload) {
	if (!await database_default().select(1).from("directus_sessions").where({
		token: payload["session"],
		user: payload["id"] || null,
		share: payload["share"] || null
	}).andWhere("expires", ">=", /* @__PURE__ */ new Date()).first()) throw new InvalidCredentialsError();
}

//#endregion
export { verifySessionJWT };