import jwt from "jsonwebtoken";

//#region src/websocket/utils/get-expires-at-for-token.ts
function getExpiresAtForToken(token) {
	const decoded = jwt.decode(token);
	if (decoded && typeof decoded === "object" && decoded.exp) return decoded.exp;
	return null;
}

//#endregion
export { getExpiresAtForToken };