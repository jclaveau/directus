import { InvalidPayloadError } from '@directus/errors';
import { version } from 'directus/version';
import type { SystemMcpToolContext } from '../types/tool.js';
import { systemMcpTools, findSystemMcpTool } from './tools.js';

/**
 * The protocol revision this server implements. A client that asks for another
 * one is answered with this — the version it gets, not the version it wanted.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

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
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION];

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: JsonRpcId;
	result?: unknown;
	error?: { code: number; message: string };
}

function fail(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

function succeed(id: JsonRpcId, result: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id, result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object'
		&& value !== null
		&& Array.isArray(value) === false;
}

async function callTool(
	id: JsonRpcId,
	params: Record<string, unknown>,
	context: SystemMcpToolContext,
): Promise<JsonRpcResponse> {
	const tool = findSystemMcpTool(params['name']);

	if (tool === undefined) {
		return fail(id, INVALID_PARAMS, `Unknown tool: ${String(params['name'])}`);
	}

	const args = isRecord(params['arguments'])
		? params['arguments']
		: {};

	try {
		const result = await tool.run(args, context);

		// Structured content has to be an object, and half these tools answer a
		// list, so a list is named rather than dropped. Every tool declares an
		// `outputSchema`, so every answer owes a `structuredContent` — anything
		// that is neither object nor list would break that promise, and there is
		// nothing sensible to name it.
		const structured = Array.isArray(result)
			? { items: result }
			: result;

		if (isRecord(structured) === false) {
			throw new TypeError(
				`Tool ${tool.name} answered ${typeof result}, which cannot be `
				+ 'structured content',
			);
		}

		// The text mirrors the structured answer exactly, for clients that read
		// only content blocks.
		return succeed(id, {
			content: [{ type: 'text', text: JSON.stringify(structured) }],
			structuredContent: structured,
		});
	}
	catch (error) {
		// A refused or failed read is the tool's answer, not a broken protocol
		// exchange: the caller is told so it can act, per the MCP tool contract.
		// `String` rather than `.message`, which is undefined on a thrown non-Error.
		return succeed(id, {
			content: [{ type: 'text', text: String((error as Error)?.message ?? error) }],
			isError: true,
		});
	}
}

/**
 * Answer one JSON-RPC message. Returns `null` for a notification — a message
 * with no `id`, which by the protocol gets no response at all.
 */
export async function handleSystemMcpRequest(
	body: unknown,
	context: SystemMcpToolContext,
): Promise<JsonRpcResponse | null> {
	// Malformed JSON never reaches here — the body parser rejects it with a 400
	// first — so anything that is not an object is well-formed JSON of the wrong
	// shape, which is an invalid request rather than a parse failure. An array
	// lands here too: this revision of the protocol removed batching.
	if (isRecord(body) === false) {
		return fail(null, INVALID_REQUEST, 'Expected a single JSON-RPC 2.0 object');
	}

	const id = (body['id'] ?? null) as JsonRpcId;
	const method = body['method'];

	// A JSON-RPC *response* is a message this server has no use for: it never
	// asks the client anything, so nothing it sent is being answered. The
	// transport wants a response it cannot accept refused with an HTTP error
	// status rather than a JSON-RPC one, which would read as an answer to a
	// request the client never made.
	if (
		typeof method !== 'string'
		&& ('result' in body || 'error' in body)
	) {
		throw new InvalidPayloadError({
			reason: 'A JSON-RPC response is not accepted at this endpoint',
		});
	}

	if (typeof method !== 'string') {
		return fail(id, INVALID_REQUEST, 'Expected a `method` string');
	}

	// Notifications carry no id and are answered with nothing.
	if (body['id'] === undefined) {
		return null;
	}

	const params = isRecord(body['params'])
		? body['params']
		: {};

	if (method === 'initialize') {
		return succeed(id, {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: 'directus-system', version },
		});
	}

	if (method === 'ping') {
		return succeed(id, {});
	}

	if (method === 'tools/list') {
		return succeed(id, {
			tools: systemMcpTools().map((tool) => {
				return {
					name: tool.name,
					title: tool.title,
					description: tool.description,
					inputSchema: tool.inputSchema,
					outputSchema: tool.outputSchema,
					annotations: tool.annotations,
				};
			}),
		});
	}

	if (method === 'tools/call') {
		return callTool(id, params, context);
	}

	return fail(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
}
