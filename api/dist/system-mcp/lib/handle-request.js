import { useLogger } from "../../logger/index.js";
import { extractDatabaseError } from "../../database/errors/translate.js";
import { findSystemMcpTool, systemMcpTools } from "./tools.js";
import { ErrorCode, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { version } from "directus/version";

//#region src/system-mcp/lib/handle-request.ts
/**
* The protocol revision this server implements. A client that asks for another
* one is answered with this — the version it gets, not the version it wanted.
*/
const MCP_PROTOCOL_VERSION = "2025-06-18";
/**
* Revisions this server answers on — this one only.
*
* `2025-03-26` is deliberately absent even though the spec says to assume it
* when no version header is sent: that revision makes batching mandatory (its
* POST body MAY be "an array batching one or more requests"), and this server
* answers a single message. Claiming it would be claiming a capability that is
* not here. A client that sends no header at all is still served, since the
* header is only checked when present.
*/
const SUPPORTED_MCP_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION];
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
function fail(id, code, message) {
	return {
		jsonrpc: "2.0",
		id,
		error: {
			code,
			message
		}
	};
}
function succeed(id, result) {
	return {
		jsonrpc: "2.0",
		id,
		result
	};
}
function isRecord(value) {
	return typeof value === "object" && value !== null && Array.isArray(value) === false;
}
async function callTool(id, params, context) {
	const tool = findSystemMcpTool(params["name"]);
	if (tool === void 0) return fail(id, INVALID_PARAMS, `Unknown tool: ${String(params["name"])}`);
	const args = isRecord(params["arguments"]) ? params["arguments"] : {};
	try {
		const result = await tool.run(args, context);
		const structured = Array.isArray(result) ? { items: result } : result;
		if (isRecord(structured) === false) throw new TypeError(`Tool ${tool.name} answered ${typeof result}, which cannot be structured content`);
		return succeed(id, {
			content: [{
				type: "text",
				text: JSON.stringify(structured)
			}],
			structuredContent: structured
		});
	} catch (rawError) {
		const error = isDirectusError(rawError) ? rawError : await extractDatabaseError(rawError, {});
		if (isDirectusError(error, ErrorCode.InvalidPayload)) return fail(id, INVALID_PARAMS, error.message);
		const logger = useLogger();
		if (isDirectusError(error)) logger.debug(error);
		else logger.error(error);
		return succeed(id, {
			content: [{
				type: "text",
				text: String(error?.message ?? error)
			}],
			isError: true
		});
	}
}
/**
* Answer one JSON-RPC message. Returns `null` for a notification — a message
* with no `id`, which by the protocol gets no response at all.
*/
async function handleSystemMcpRequest(body, context) {
	if (isRecord(body) === false) return fail(null, INVALID_REQUEST, "Expected a single JSON-RPC 2.0 object");
	const id = body["id"] ?? null;
	const method = body["method"];
	if (typeof method !== "string" && ("result" in body || "error" in body)) throw new InvalidPayloadError({ reason: "A JSON-RPC response is not accepted at this endpoint" });
	const isNotification = body["id"] === void 0;
	/**
	* A notification is owed no response object at all, so a malformed one cannot
	* be answered with a JSON-RPC error — that would be replying to a message
	* whose whole point is that no reply is coming. The transport asks for an
	* HTTP error status there instead. A request gets the JSON-RPC error, with
	* its own id carried back.
	*/
	function refuse(reason) {
		if (isNotification) throw new InvalidPayloadError({ reason });
		return fail(id, INVALID_REQUEST, reason);
	}
	if (typeof method !== "string") return refuse("Expected a `method` string");
	if (body["jsonrpc"] !== "2.0") return refuse("Expected `jsonrpc` to be \"2.0\"");
	if (isNotification) return null;
	const params = isRecord(body["params"]) ? body["params"] : {};
	if (method === "initialize") return succeed(id, {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: { tools: { listChanged: false } },
		serverInfo: {
			name: "directus-system",
			version
		}
	});
	if (method === "ping") return succeed(id, {});
	if (method === "tools/list") return succeed(id, { tools: systemMcpTools().map((tool) => {
		return {
			name: tool.name,
			title: tool.title,
			description: tool.description,
			inputSchema: tool.inputSchema,
			outputSchema: tool.outputSchema,
			annotations: tool.annotations
		};
	}) });
	if (method === "tools/call") return callTool(id, params, context);
	return fail(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
}

//#endregion
export { MCP_PROTOCOL_VERSION, SUPPORTED_MCP_PROTOCOL_VERSIONS, handleSystemMcpRequest };