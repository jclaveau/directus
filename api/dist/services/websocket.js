import emitter_default from "../emitter.js";
import { getWebSocketController } from "../websocket/controllers/index.js";
import { useEnv } from "@directus/env";
import { ServiceUnavailableError } from "@directus/errors";
import { toBoolean } from "@directus/utils";

//#region src/services/websocket.ts
const env = useEnv();
var WebSocketService = class {
	controller;
	constructor() {
		if (!toBoolean(env["WEBSOCKETS_ENABLED"]) || !toBoolean(env["WEBSOCKETS_REST_ENABLED"])) throw new ServiceUnavailableError({
			service: "ws",
			reason: "WebSocket server is disabled"
		});
		const controller = getWebSocketController();
		if (!controller) throw new ServiceUnavailableError({
			service: "ws",
			reason: "WebSocket server is not initialized"
		});
		this.controller = controller;
	}
	on(event, callback) {
		emitter_default.onAction("websocket." + event, callback);
	}
	off(event, callback) {
		emitter_default.offAction("websocket." + event, callback);
	}
	broadcast(message, filter) {
		this.controller.clients.forEach((client) => {
			if (filter && filter.user && filter.user !== client.accountability?.user) return;
			if (filter && filter.role && filter.role !== client.accountability?.role) return;
			client.send(typeof message === "string" ? message : JSON.stringify(message));
		});
	}
	clients() {
		return this.controller.clients;
	}
};

//#endregion
export { WebSocketService };