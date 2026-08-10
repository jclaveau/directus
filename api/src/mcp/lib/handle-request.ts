import { version } from 'directus/version';
import type { McpToolContext } from '../types/tool.js';
import { exposedMcpTools, findMcpTool } from './tools.js';

/**
 * The protocol revision this server implements. A client that asks for another
 * one is answered with this — the version it gets, not the version it wanted.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * Revisions this server answers on. `2025-03-26` is what the spec says to assume
 * when a client sends no version header at all, so refusing it would refuse the
 * clients that behaviour exists for.
 */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
	MCP_PROTOCOL_VERSION,
	'2025-03-26',
];

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
	context: McpToolContext,
): Promise<JsonRpcResponse> {
	const tool = findMcpTool(params['name']);

	if (tool === undefined) {
		return fail(id, INVALID_PARAMS, `Unknown tool: ${String(params['name'])}`);
	}

	const args = isRecord(params['arguments'])
		? params['arguments']
		: {};

	try {
		const result = await tool.run(args, context);

		// A tool answering `undefined` would stringify to nothing at all, and a
		// content block without its text is not a content block.
		return succeed(id, {
			content: [{ type: 'text', text: JSON.stringify(result) ?? 'null' }],
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
export async function handleMcpRequest(
	body: unknown,
	context: McpToolContext,
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
			serverInfo: { name: 'directus-diagnostics', version },
		});
	}

	if (method === 'ping') {
		return succeed(id, {});
	}

	if (method === 'tools/list') {
		return succeed(id, {
			tools: exposedMcpTools().map((tool) => {
				return {
					name: tool.name,
					title: tool.title,
					description: tool.description,
					inputSchema: tool.inputSchema,
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
