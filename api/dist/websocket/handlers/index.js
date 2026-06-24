import { CollabHandler } from "../collab/collab.js";
import { HeartbeatHandler } from "./heartbeat.js";
import { ItemsHandler } from "./items.js";
import { LogsHandler } from "./logs.js";
import { SubscribeHandler } from "./subscribe.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/websocket/handlers/index.ts
let collabHandler;
function startWebSocketHandlers() {
	const env = useEnv();
	const heartbeatEnabled = toBoolean(env["WEBSOCKETS_HEARTBEAT_ENABLED"]);
	const restEnabled = toBoolean(env["WEBSOCKETS_REST_ENABLED"]);
	const graphqlEnabled = toBoolean(env["WEBSOCKETS_GRAPHQL_ENABLED"]);
	const logsEnabled = toBoolean(env["WEBSOCKETS_LOGS_ENABLED"]);
	const collabEnabled = toBoolean(env["WEBSOCKETS_COLLAB_ENABLED"]);
	if (restEnabled && heartbeatEnabled) new HeartbeatHandler();
	if (restEnabled || graphqlEnabled) new ItemsHandler();
	if (restEnabled) new SubscribeHandler();
	if (logsEnabled) new LogsHandler();
	if (collabEnabled) collabHandler = new CollabHandler();
}
function getCollabHandler() {
	return collabHandler;
}

//#endregion
export { HeartbeatHandler, ItemsHandler, LogsHandler, SubscribeHandler, getCollabHandler, startWebSocketHandlers };