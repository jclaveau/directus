import { WebSocketMessage } from "../../packages/types/dist/index.js";
import emitter_default from "../../emitter.js";
import { fmtMessage, getMessageType } from "../utils/message.js";
import { getWebSocketController } from "../controllers/index.js";
import { useEnv } from "@directus/env";
import { ServiceUnavailableError } from "@directus/errors";
import { toBoolean } from "@directus/utils";

//#region src/websocket/handlers/heartbeat.ts
const env = useEnv();
const HEARTBEAT_FREQUENCY = Number(env["WEBSOCKETS_HEARTBEAT_PERIOD"]) * 1e3;
var HeartbeatHandler = class {
	pulse;
	controller;
	constructor(controller) {
		controller = controller ?? getWebSocketController();
		if (!controller) throw new ServiceUnavailableError({
			service: "ws",
			reason: "WebSocket server is not initialized"
		});
		this.controller = controller;
		emitter_default.onAction("websocket.message", ({ client, message }) => {
			try {
				this.onMessage(client, WebSocketMessage.parse(message));
			} catch {}
		});
		if (toBoolean(env["WEBSOCKETS_HEARTBEAT_ENABLED"]) === true) {
			emitter_default.onAction("websocket.connect", () => this.checkClients());
			emitter_default.onAction("websocket.error", () => this.checkClients());
			emitter_default.onAction("websocket.close", () => this.checkClients());
		}
	}
	checkClients() {
		const hasClients = this.controller.clients.size > 0;
		if (hasClients && !this.pulse) this.pulse = setInterval(() => {
			this.pingClients();
		}, HEARTBEAT_FREQUENCY);
		if (!hasClients && this.pulse) {
			clearInterval(this.pulse);
			this.pulse = void 0;
		}
	}
	onMessage(client, message) {
		if (getMessageType(message) !== "ping") return;
		const data = "uid" in message ? { uid: message.uid } : {};
		client.send(fmtMessage("pong", data));
	}
	pingClients() {
		const pendingClients = new Set(this.controller.clients);
		const activeClients = /* @__PURE__ */ new Set();
		const timeout = setTimeout(() => {
			for (const client of pendingClients) client.close();
		}, HEARTBEAT_FREQUENCY);
		const messageWatcher = ({ client }) => {
			if (!activeClients.has(client)) {
				pendingClients.delete(client);
				activeClients.add(client);
			}
			if (pendingClients.size === 0) {
				clearTimeout(timeout);
				emitter_default.offAction("websocket.message", messageWatcher);
			}
		};
		emitter_default.onAction("websocket.message", messageWatcher);
		for (const client of pendingClients) client.send(fmtMessage("ping"));
	}
};

//#endregion
export { HeartbeatHandler };