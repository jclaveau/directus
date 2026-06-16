import { DEFAULT_AUTH_PROVIDER } from "../constants.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { createDefaultAccountability } from "../permissions/utils/create-default-accountability.js";
import { getSchema } from "../utils/get-schema.js";
import { AuthenticationService } from "../services/authentication.js";
import { getAccountabilityForToken } from "../utils/get-accountability-for-token.js";
import { WebSocketError } from "./errors.js";
import { getExpiresAtForToken } from "./utils/get-expires-at-for-token.js";
import "../services/index.js";
import { isEqual } from "lodash-es";

//#region src/websocket/authenticate.ts
async function authenticateConnection(message, accountabilityOverrides) {
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
		const defaultAccountability = createDefaultAccountability(accountabilityOverrides);
		const authenticationState = {
			accountability: defaultAccountability,
			expires_at: getExpiresAtForToken(access_token),
			refresh_token
		};
		const customAccountability = await emitter_default.emitFilter("websocket.authenticate", defaultAccountability, { message }, {
			database: database_default(),
			schema: null,
			accountability: null
		});
		if (customAccountability && isEqual(customAccountability, defaultAccountability) === false) authenticationState.accountability = customAccountability;
		else authenticationState.accountability = await getAccountabilityForToken(access_token, defaultAccountability);
		if (authenticationState.accountability.oauth) throw new Error("OAuth sessions are not allowed on WebSocket connections");
		return authenticationState;
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