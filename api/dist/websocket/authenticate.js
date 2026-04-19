import { DEFAULT_AUTH_PROVIDER } from "../constants.js";
import { AuthenticationService } from "../services/authentication.js";
import { getSchema } from "../utils/get-schema.js";
import { getAccountabilityForToken } from "../utils/get-accountability-for-token.js";
import { WebSocketError } from "./errors.js";
import { getExpiresAtForToken } from "./utils/get-expires-at-for-token.js";
import "../services/index.js";

//#region src/websocket/authenticate.ts
async function authenticateConnection(message) {
	let access_token, refresh_token;
	try {
		if ("email" in message && "password" in message) {
			const { accessToken, refreshToken } = await new AuthenticationService({ schema: await getSchema() }).login(DEFAULT_AUTH_PROVIDER, message);
			access_token = accessToken;
			refresh_token = refreshToken;
		}
		if ("refresh_token" in message) {
			const { accessToken, refreshToken } = await new AuthenticationService({ schema: await getSchema() }).refresh(message.refresh_token);
			access_token = accessToken;
			refresh_token = refreshToken;
		}
		if ("access_token" in message) access_token = message.access_token;
		if (!access_token) throw new Error();
		return {
			accountability: await getAccountabilityForToken(access_token),
			expires_at: getExpiresAtForToken(access_token),
			refresh_token
		};
	} catch {
		throw new WebSocketError("auth", "AUTH_FAILED", "Authentication failed.", message["uid"]);
	}
}
function authenticationSuccess(uid, refresh_token) {
	const message = {
		type: "auth",
		status: "ok"
	};
	if (uid !== void 0) message.uid = uid;
	if (refresh_token !== void 0) message["refresh_token"] = refresh_token;
	return JSON.stringify(message);
}

//#endregion
export { authenticateConnection, authenticationSuccess };