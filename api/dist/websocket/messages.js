import { WebSocketMessage } from "../packages/types/dist/index.js";
import { z as z$1 } from "zod";

//#region src/websocket/messages.ts
const zodStringOrNumber = z$1.union([z$1.string(), z$1.number()]);
const WebSocketResponse = z$1.discriminatedUnion("status", [WebSocketMessage.extend({ status: z$1.literal("ok") }), WebSocketMessage.extend({
	status: z$1.literal("error"),
	error: z$1.object({
		code: z$1.string(),
		message: z$1.string()
	}).passthrough()
})]);
const ConnectionParams = z$1.object({ access_token: z$1.string().optional() });
const BasicAuthMessage = z$1.union([
	z$1.object({
		email: z$1.string().email(),
		password: z$1.string()
	}),
	z$1.object({ access_token: z$1.string() }),
	z$1.object({ refresh_token: z$1.string() })
]);
const WebSocketAuthMessage = WebSocketMessage.extend({ type: z$1.literal("auth") }).and(BasicAuthMessage);
const WebSocketSubscribeMessage = z$1.discriminatedUnion("type", [WebSocketMessage.extend({
	type: z$1.literal("subscribe"),
	collection: z$1.string(),
	event: z$1.union([
		z$1.literal("create"),
		z$1.literal("update"),
		z$1.literal("delete")
	]).optional(),
	item: zodStringOrNumber.optional(),
	query: z$1.record(z$1.string(), z$1.any()).optional()
}), WebSocketMessage.extend({ type: z$1.literal("unsubscribe") })]);
const WebSocketLogsMessage = z$1.union([z$1.object({
	type: z$1.literal("subscribe"),
	log_level: z$1.string()
}), WebSocketMessage.extend({ type: z$1.literal("unsubscribe") })]);
const ZodItem = z$1.custom();
const PartialItemsMessage = z$1.object({
	uid: zodStringOrNumber.optional(),
	type: z$1.literal("items"),
	collection: z$1.string()
});
const WebSocketItemsMessage = z$1.union([
	PartialItemsMessage.extend({
		action: z$1.literal("create"),
		data: z$1.union([z$1.array(ZodItem), ZodItem]),
		query: z$1.custom().optional()
	}),
	PartialItemsMessage.extend({
		action: z$1.literal("read"),
		ids: z$1.array(zodStringOrNumber).optional(),
		id: zodStringOrNumber.optional(),
		query: z$1.custom().optional()
	}),
	PartialItemsMessage.extend({
		action: z$1.literal("update"),
		data: ZodItem,
		ids: z$1.array(zodStringOrNumber).optional(),
		id: zodStringOrNumber.optional(),
		query: z$1.custom().optional()
	}),
	PartialItemsMessage.extend({
		action: z$1.literal("delete"),
		ids: z$1.array(zodStringOrNumber).optional(),
		id: zodStringOrNumber.optional(),
		query: z$1.custom().optional()
	})
]);
const WebSocketEvent = z$1.discriminatedUnion("action", [
	z$1.object({
		action: z$1.literal("create"),
		collection: z$1.string(),
		payload: z$1.record(z$1.string(), z$1.any()).optional(),
		key: zodStringOrNumber
	}),
	z$1.object({
		action: z$1.literal("update"),
		collection: z$1.string(),
		payload: z$1.record(z$1.string(), z$1.any()).optional(),
		keys: z$1.array(zodStringOrNumber)
	}),
	z$1.object({
		action: z$1.literal("delete"),
		collection: z$1.string(),
		payload: z$1.record(z$1.string(), z$1.any()).optional(),
		keys: z$1.array(zodStringOrNumber)
	})
]);
const AuthMode = z$1.union([
	z$1.literal("public"),
	z$1.literal("handshake"),
	z$1.literal("strict")
]);

//#endregion
export { AuthMode, BasicAuthMessage, ConnectionParams, WebSocketAuthMessage, WebSocketEvent, WebSocketItemsMessage, WebSocketLogsMessage, WebSocketResponse, WebSocketSubscribeMessage };