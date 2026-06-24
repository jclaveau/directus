import { useLogger } from "../logger/index.js";
import { isDirectusError } from "@directus/errors";
import { fromZodError } from "zod-validation-error";
import { ZodError } from "zod";

//#region src/websocket/errors.ts
var WebSocketError = class WebSocketError extends Error {
	type;
	code;
	uid;
	constructor(type, code, message, uid) {
		super(message);
		this.type = type;
		this.code = code;
		this.uid = uid;
	}
	toJSON() {
		const message = {
			type: this.type,
			status: "error",
			error: {
				code: this.code,
				message: this.message
			}
		};
		if (this.uid !== void 0) message.uid = this.uid;
		return message;
	}
	toMessage() {
		return JSON.stringify(this.toJSON());
	}
	static fromError(error, type = "unknown") {
		return new WebSocketError(type, error.code, error.message);
	}
	static fromZodError(error, type = "unknown") {
		return new WebSocketError(type, "INVALID_PAYLOAD", fromZodError(error).message);
	}
};
function handleWebSocketError(client, error, type) {
	const logger = useLogger();
	if (isDirectusError(error)) {
		client.send(WebSocketError.fromError(error, type).toMessage());
		return;
	}
	if (error instanceof WebSocketError) {
		client.send(error.toMessage());
		return;
	}
	if (error instanceof ZodError) {
		client.send(WebSocketError.fromZodError(error, type).toMessage());
		return;
	}
	logger.error(`WebSocket unhandled exception ${JSON.stringify({
		type,
		error
	})}`);
}

//#endregion
export { WebSocketError, handleWebSocketError };