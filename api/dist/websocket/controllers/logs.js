import { useLogger } from "../../logger/index.js";
import emitter_default from "../../emitter.js";
import { WebSocketError, handleWebSocketError } from "../errors.js";
import "../messages.js";
import SocketController from "./base.js";
import { useEnv } from "@directus/env";

//#region src/websocket/controllers/logs.ts
const logger = useLogger();
var LogsController = class extends SocketController {
	constructor(httpServer) {
		super(httpServer, "WEBSOCKETS_LOGS");
		const env = useEnv();
		this.server.on("connection", (ws, auth) => {
			this.bindEvents(this.createClient(ws, auth));
		});
		logger.info(`Logs WebSocket Server started at ws://${env["HOST"]}:${env["PORT"]}${this.endpoint}`);
	}
	getEnvironmentConfig(configPrefix) {
		const env = useEnv();
		return {
			endpoint: String(env[`${configPrefix}_PATH`]),
			maxConnections: `${configPrefix}_CONN_LIMIT` in env ? Number(env[`${configPrefix}_CONN_LIMIT`]) : Number.POSITIVE_INFINITY,
			authentication: {
				mode: "strict",
				timeout: 0
			}
		};
	}
	bindEvents(client) {
		client.on("parsed-message", async (message) => {
			try {
				emitter_default.emitAction("websocket.logs", {
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
	checkUserRequirements(accountability) {
		if (!accountability?.admin) throw new WebSocketError("auth", "AUTH_FAILED", "Unauthorized access.");
	}
};

//#endregion
export { LogsController };