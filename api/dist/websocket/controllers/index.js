import { GraphQLSubscriptionController } from "./graphql.js";
import { LogsController } from "./logs.js";
import { WebSocketController } from "./rest.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/websocket/controllers/index.ts
let websocketController;
let subscriptionController;
let logsController;
function createWebSocketController(server) {
	if (toBoolean(useEnv()["WEBSOCKETS_REST_ENABLED"])) websocketController = new WebSocketController(server);
}
function getWebSocketController() {
	return websocketController;
}
function createSubscriptionController(server) {
	if (toBoolean(useEnv()["WEBSOCKETS_GRAPHQL_ENABLED"])) subscriptionController = new GraphQLSubscriptionController(server);
}
function getSubscriptionController() {
	return subscriptionController;
}
function createLogsController(server) {
	if (toBoolean(useEnv()["WEBSOCKETS_LOGS_ENABLED"])) logsController = new LogsController(server);
}
function getLogsController() {
	return logsController;
}

//#endregion
export { GraphQLSubscriptionController, LogsController, WebSocketController, createLogsController, createSubscriptionController, createWebSocketController, getLogsController, getSubscriptionController, getWebSocketController };