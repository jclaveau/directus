import { WebSocketMessage } from "@directus/types";
import { z } from "zod";

//#region src/websocket/messages.ts
const zodStringOrNumber = z.union([z.string(), z.number()]);
const WebSocketResponse = z.discriminatedUnion("status", [WebSocketMessage.extend({ status: z.literal("ok") }), WebSocketMessage.extend({
	status: z.literal("error"),
	error: z.object({
		code: z.string(),
		message: z.string()
	}).passthrough()
})]);
const ConnectionParams = z.object({ access_token: z.string().optional() });
const BasicAuthMessage = z.union([
	z.object({
		email: z.string().email(),
		password: z.string()
	}),
	z.object({ access_token: z.string() }),
	z.object({ refresh_token: z.string() })
]);
const WebSocketAuthMessage = WebSocketMessage.extend({ type: z.literal("auth") }).and(BasicAuthMessage);
const WebSocketSubscribeMessage = z.discriminatedUnion("type", [WebSocketMessage.extend({
	type: z.literal("subscribe"),
	collection: z.string(),
	event: z.union([
		z.literal("create"),
		z.literal("update"),
		z.literal("delete")
	]).optional(),
	item: zodStringOrNumber.optional(),
	query: z.record(z.string(), z.any()).optional()
}), WebSocketMessage.extend({ type: z.literal("unsubscribe") })]);
const WebSocketLogsMessage = z.union([z.object({
	type: z.literal("subscribe"),
	log_level: z.string()
}), WebSocketMessage.extend({ type: z.literal("unsubscribe") })]);
const ZodItem = z.custom();
const PartialItemsMessage = z.object({
	uid: zodStringOrNumber.optional(),
	type: z.literal("items"),
	collection: z.string()
});
const WebSocketItemsMessage = z.union([
	PartialItemsMessage.extend({
		action: z.literal("create"),
		data: z.union([z.array(ZodItem), ZodItem]),
		query: z.custom().optional()
	}),
	PartialItemsMessage.extend({
		action: z.literal("read"),
		ids: z.array(zodStringOrNumber).optional(),
		id: zodStringOrNumber.optional(),
		query: z.custom().optional()
	}),
	PartialItemsMessage.extend({
		action: z.literal("update"),
		data: ZodItem,
		ids: z.array(zodStringOrNumber).optional(),
		id: zodStringOrNumber.optional(),
		query: z.custom().optional()
	}),
	PartialItemsMessage.extend({
		action: z.literal("delete"),
		ids: z.array(zodStringOrNumber).optional(),
		id: zodStringOrNumber.optional(),
		query: z.custom().optional()
	})
]);
const WebSocketEvent = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create"),
		collection: z.string(),
		payload: z.record(z.string(), z.any()).optional(),
		key: zodStringOrNumber
	}),
	z.object({
		action: z.literal("update"),
		collection: z.string(),
		payload: z.record(z.string(), z.any()).optional(),
		keys: z.array(zodStringOrNumber)
	}),
	z.object({
		action: z.literal("delete"),
		collection: z.string(),
		payload: z.record(z.string(), z.any()).optional(),
		keys: z.array(zodStringOrNumber)
	})
]);
const AuthMode = z.union([
	z.literal("public"),
	z.literal("handshake"),
	z.literal("strict")
]);

//#endregion
export { AuthMode, BasicAuthMessage, ConnectionParams, WebSocketAuthMessage, WebSocketEvent, WebSocketItemsMessage, WebSocketLogsMessage, WebSocketResponse, WebSocketSubscribeMessage };