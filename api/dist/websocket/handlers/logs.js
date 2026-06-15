import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { useLogger } from "../../logger/index.js";
import emitter_default from "../../emitter.js";
import { WebSocketError, handleWebSocketError } from "../errors.js";
import { WebSocketLogsMessage } from "../messages.js";
import { fmtMessage, getMessageType } from "../utils/message.js";
import { getLogsController } from "../controllers/index.js";
import { getAllowedLogLevels } from "../../utils/get-allowed-log-levels.js";
import { ErrorCode, ServiceUnavailableError } from "@directus/errors";

//#region src/websocket/handlers/logs.ts
const logger = useLogger();
var LogsHandler = class {
	controller;
	messenger;
	availableLogLevels;
	logLevelValueMap;
	subscriptions;
	constructor(controller) {
		controller = controller ?? getLogsController();
		if (!controller) throw new ServiceUnavailableError({
			service: "ws",
			reason: "WebSocket server is not initialized"
		});
		this.controller = controller;
		this.messenger = useBus();
		this.availableLogLevels = Object.keys(logger.levels.values);
		this.logLevelValueMap = Object.fromEntries(Object.entries(logger.levels.values).map(([key, value]) => [value, key]));
		this.subscriptions = this.availableLogLevels.reduce((acc, logLevel) => {
			acc[logLevel] = /* @__PURE__ */ new Set();
			return acc;
		}, {});
		this.bindWebSocket();
		this.messenger.subscribe("logs", (message) => {
			const { log, nodeId } = JSON.parse(message);
			const logLevel = this.logLevelValueMap[log["level"]];
			if (logLevel) this.subscriptions[logLevel]?.forEach((subscription) => subscription.send(fmtMessage("logs", { data: log }, nodeId)));
		});
	}
	/**
	* Hook into websocket client lifecycle events
	*/
	bindWebSocket() {
		emitter_default.onAction("websocket.logs", ({ client, message }) => {
			if (!["subscribe", "unsubscribe"].includes(getMessageType(message))) return;
			try {
				const parsedMessage = WebSocketLogsMessage.parse(message);
				this.onMessage(client, parsedMessage).catch((error) => {
					handleWebSocketError(client, error, "logs");
				});
			} catch (error) {
				handleWebSocketError(client, error, "logs");
			}
		});
		emitter_default.onAction("websocket.error", ({ client }) => this.unsubscribe(client));
		emitter_default.onAction("websocket.close", ({ client }) => this.unsubscribe(client));
	}
	/**
	* Register a logs subscription
	* @param logLevel
	* @param client
	*/
	subscribe(logLevel, client) {
		let allowedLogLevelNames = [];
		try {
			allowedLogLevelNames = Object.keys(getAllowedLogLevels(logLevel));
		} catch (error) {
			throw new WebSocketError("logs", ErrorCode.InvalidPayload, error.message);
		}
		for (const availableLogLevel of this.availableLogLevels) if (allowedLogLevelNames.includes(availableLogLevel)) this.subscriptions[availableLogLevel]?.add(client);
		else this.subscriptions[availableLogLevel]?.delete(client);
	}
	/**
	* Remove a logs subscription
	* @param client WebSocketClient
	*/
	unsubscribe(client) {
		for (const availableLogLevel of this.availableLogLevels) this.subscriptions[availableLogLevel]?.delete(client);
	}
	/**
	* Handle incoming (un)subscribe requests
	*/
	async onMessage(client, message) {
		if (!client.accountability?.admin) throw new WebSocketError("logs", ErrorCode.Forbidden, `You don't have permission to access this.`);
		if (message.type === "subscribe") try {
			const logLevel = message.log_level;
			this.subscribe(logLevel, client);
			client.send(fmtMessage("logs", {
				event: "subscribe",
				log_level: logLevel
			}));
		} catch (err) {
			handleWebSocketError(client, err, "subscribe");
		}
		else if (message.type === "unsubscribe") try {
			this.unsubscribe(client);
			client.send(fmtMessage("logs", { event: "unsubscribe" }));
		} catch (err) {
			handleWebSocketError(client, err, "unsubscribe");
		}
	}
};

//#endregion
export { LogsHandler };