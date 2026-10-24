import jwt from "jsonwebtoken";

//#region src/utils/is-directus-jwt.ts
/**
* Check if a given string conforms to the structure of a JWT
* and whether it is issued by Directus.
*/
function isDirectusJWT(string) {
	try {
		if (jwt.decode(string, { json: true })?.iss !== "directus") return false;
		return true;
	} catch {
		return false;
	}
}

//#endregion
export { isDirectusJWT as default };