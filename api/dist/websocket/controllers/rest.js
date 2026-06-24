import { useLogger } from "../../logger/index.js";
import { WebSocketMessage } from "../../packages/types/dist/index.js";
import emitter_default from "../../emitter.js";
import { getAddress } from "../../utils/get-address.js";
import { WebSocketError, handleWebSocketError } from "../errors.js";
import SocketController from "./base.js";
import { registerWebSocketEvents } from "./hooks.js";
import { parseJSON } from "@directus/utils";

//#region src/websocket/controllers/rest.ts
const logger = useLogger();
var WebSocketController = class extends SocketController {
	constructor(httpServer) {
		super(httpServer, "WEBSOCKETS_REST");
		registerWebSocketEvents();
		this.server.on("connection", (ws, auth) => {
			this.bindEvents(this.createClient(ws, auth));
		});
		logger.info(`WebSocket Server started at ${getAddress(httpServer)}${this.endpoint}`);
	}
	bindEvents(client) {
		client.on("parsed-message", async (message) => {
			try {
				message = WebSocketMessage.parse(await emitter_default.emitFilter("websocket.message", message, { client }));
				emitter_default.emitAction("websocket.message", {
					message,
					client
				});
			} catch (error) {
				handleWebSocketError(client, error, "server");
				return;
			}
		});
		client.on("error", (event) => {
			emitter_default.emitAction("websocket.error", {
				client,
				event
			});
		});
		client.on("close", (event) => {
			emitter_default.emitAction("websocket.close", {
				client,
				event
			});
		});
		emitter_default.emitAction("websocket.connect", { client });
	}
	parseMessage(data) {
		let message;
		try {
			message = parseJSON(data);
		} catch {
			throw new WebSocketError("server", "INVALID_PAYLOAD", "Unable to parse the incoming message.");
		}
		return message;
	}
};

//#endregion
export { WebSocketController };