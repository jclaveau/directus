import type { SchemaOverview } from '@directus/types';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('directus/version', () => {
	return { version: '11.10.1' };
});

const tool = vi.hoisted(() => {
	return { run: vi.fn() };
});

const TOOL = {
	name: 'list_processes',
	group: 'processes',
	title: 'List running processes',
	description: 'A description long enough to choose on.',
	inputSchema: { type: 'object', properties: {} },
	outputSchema: { type: 'object', properties: { services: { type: 'array' } } },
	annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
	run: tool.run,
};

vi.mock('./tools.js', () => {
	return {
		systemMcpTools: () => [TOOL],
		findSystemMcpTool: (name: unknown) => {
			return name === 'list_processes'
				? TOOL
				: undefined;
		},
	};
});

import { InvalidPayloadError } from '@directus/errors';
import { handleSystemMcpRequest, MCP_PROTOCOL_VERSION } from './handle-request.js';

const context = {
	accountability: {
		role: null,
		roles: [],
		user: null,
		admin: true,
		app: false,
		ip: null,
	},
	schema: {} as SchemaOverview,
};

beforeEach(() => {
	tool.run.mockReset();
});

// "The server MUST respond with its own capabilities and information", and
// with a protocol version it supports.
// https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#initialization
// https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#version-negotiation
test('Announces the protocol, its capability and itself', async () => {
	const response = await handleSystemMcpRequest(
		{ jsonrpc: '2.0', id: 1, method: 'initialize' },
		context,
	);

	expect(response).toEqual({
		jsonrpc: '2.0',
		id: 1,
		result: {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: 'directus-system', version: '11.10.1' },
		},
	});
});

// "The receiver MUST respond promptly with an empty response."
// https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/ping
test('Answers a ping', async () => {
	const response = await handleSystemMcpRequest(
		{ jsonrpc: '2.0', id: 2, method: 'ping' },
		context,
	);

	expect(response).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
});

// The shape of a `tools/list` result.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#listing-tools
test('Lists the tools without the function behind them', async () => {
	const response = await handleSystemMcpRequest(
		{ jsonrpc: '2.0', id: 3, method: 'tools/list' },
		context,
	);

	expect(response?.result).toEqual({
		tools: [
			{
				name: 'list_processes',
				title: 'List running processes',
				description: 'A description long enough to choose on.',
				inputSchema: { type: 'object', properties: {} },
				outputSchema: {
					type: 'object',
					properties: { services: { type: 'array' } },
				},
				// What lets a client run one without asking the user first.
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					openWorldHint: false,
				},
			},
		],
	});
});

// "For backwards compatibility, a tool that returns structured content SHOULD
// also return the serialized JSON in a TextContent block."
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content
test('Calls a tool and returns what it answered as text', async () => {
	tool.run.mockResolvedValue({ services: [] });

	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 4,
		method: 'tools/call',
		params: { name: 'list_processes', arguments: { window: '15m' } },
	}, context);

	expect(tool.run).toHaveBeenCalledWith({ window: '15m' }, context);

	// Structured for a model that reads fields, text for a client that reads
	// only content blocks — and the two say the same thing.
	expect(response?.result).toEqual({
		content: [{ type: 'text', text: '{"services":[]}' }],
		structuredContent: { services: [] },
	});
});

// "Structured content is returned as a JSON object in the structuredContent
// field of a result" — so a list has to be named to be returned at all.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content
test('A list is named, since structured content must be an object', async () => {
	tool.run.mockResolvedValue([{ key: 'one' }, { key: 'two' }]);

	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 14,
		method: 'tools/call',
		params: { name: 'list_processes' },
	}, context);

	expect(response?.result).toEqual({
		content: [{ type: 'text', text: '{"items":[{"key":"one"},{"key":"two"}]}' }],
		structuredContent: { items: [{ key: 'one' }, { key: 'two' }] },
	});
});

// "Servers MUST provide structured results that conform to this schema."
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema
test('An answer that is neither object nor list is refused', async () => {
	tool.run.mockResolvedValue('a bare string');

	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 15,
		method: 'tools/call',
		params: { name: 'list_processes' },
	}, context);

	expect(response?.result).toMatchObject({ isError: true });
	expect((response?.result as any).content[0].text).toContain('string');
});

// `params.arguments` is an object; anything else names no argument.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#calling-tools
test('Arguments that are not an object are read as none', async () => {
	tool.run.mockResolvedValue(null);

	await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 5,
		method: 'tools/call',
		params: { name: 'list_processes', arguments: 'not-an-object' },
	}, context);

	expect(tool.run).toHaveBeenCalledWith({}, context);
});

// Every tool here declares an outputSchema, and "servers MUST provide
// structured results that conform to this schema".
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema
test('A tool answering nothing is a broken tool, and says so', async () => {
	tool.run.mockResolvedValue(undefined);

	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 12,
		method: 'tools/call',
		params: { name: 'list_processes' },
	}, context);

	// Every tool declares an outputSchema, so every answer owes structured
	// content. Nothing sensible can be built from `undefined`, and a silent
	// half-answer would be worse than saying so.
	expect(response?.result).toMatchObject({ isError: true });
	expect((response?.result as any).content[0].text).toContain('list_processes');
});

// An argument the tool would not take is a protocol error, not a tool result —
// "invalid arguments" is listed among the protocol ones.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling
test('An argument the tool refuses is a bad parameter, not a result', async () => {
	tool.run.mockRejectedValue(
		new InvalidPayloadError({ reason: "window 'yesterday' is not a duration" }),
	);

	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 16,
		method: 'tools/call',
		params: { name: 'list_processes', arguments: { window: 'yesterday' } },
	}, context);

	expect(response?.error?.code).toBe(-32602);
	expect(response?.error?.message).toContain('yesterday');

	// And not the other shape: a result carrying isError would read as a read
	// that ran and failed.
	expect(response?.result).toBeUndefined();
});

// A tool execution error is "reported in tool results with isError: true",
// not as a JSON-RPC error.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling
test('A thrown non-Error still reaches the caller as text', async () => {
	tool.run.mockRejectedValue('redis is gone');

	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 13,
		method: 'tools/call',
		params: { name: 'list_processes' },
	}, context);

	expect(response?.result).toEqual({
		content: [{ type: 'text', text: 'redis is gone' }],
		isError: true,
	});
});

// Tool execution errors — "API failures, invalid input data, business logic
// errors" — are results, not protocol errors.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling
test('A refused read is the tool answer, not a protocol failure', async () => {
	tool.run.mockRejectedValue(new Error('does not have permission'));

	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 6,
		method: 'tools/call',
		params: { name: 'list_processes' },
	}, context);

	expect(response?.result).toEqual({
		content: [{ type: 'text', text: 'does not have permission' }],
		isError: true,
	});
});

// An unknown tool is a protocol error; the spec's own example is -32602.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling
test('An unknown tool is a bad parameter', async () => {
	const response = await handleSystemMcpRequest({
		jsonrpc: '2.0',
		id: 7,
		method: 'tools/call',
		params: { name: 'drop_everything' },
	}, context);

	expect(response?.error).toEqual({
		code: -32602,
		message: 'Unknown tool: drop_everything',
	});
});

// JSON-RPC 2.0: -32601 is "the method does not exist / is not available".
// https://www.jsonrpc.org/specification#error_object
test('An unknown method is reported as such', async () => {
	const response = await handleSystemMcpRequest(
		{ jsonrpc: '2.0', id: 8, method: 'resources/list' },
		context,
	);

	expect(response?.error).toEqual({
		code: -32601,
		message: 'Unknown method: resources/list',
	});
});

test.each([
	// An array is how batching arrived, and this revision removed it.
	['an array', ['jsonrpc', '2.0']],
	['a string', 'jsonrpc'],
	['null', null],
// "The body of the POST request MUST be a single JSON-RPC request,
// notification, or response."
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
])('A body that is %s is not a single request', async (_case, body) => {
	const response = await handleSystemMcpRequest(body, context);

	expect(response?.error?.code).toBe(-32600);
	expect(response?.id).toBeNull();
});

// JSON-RPC 2.0: -32600 is "the JSON sent is not a valid Request object".
// https://www.jsonrpc.org/specification#error_object
test('A message with no method is invalid, and echoes its id', async () => {
	const response = await handleSystemMcpRequest({ jsonrpc: '2.0', id: 9 }, context);

	expect(response?.error?.code).toBe(-32600);
	expect(response?.id).toBe(9);
});

// JSON-RPC 2.0: "A String specifying the version of the JSON-RPC protocol. MUST
// be exactly \"2.0\"." The published schema for this endpoint requires it too.
// https://www.jsonrpc.org/specification#request_object
test.each([
	['absent', { id: 20, method: 'ping' }],
	['another version', { jsonrpc: '1.0', id: 21, method: 'ping' }],
])('A message whose jsonrpc member is %s is invalid', async (_case, body) => {
	const response = await handleSystemMcpRequest(body, context);

	expect(response?.error?.code).toBe(-32600);
	expect(response?.error?.message).toContain('jsonrpc');
});

test.each([
	['a result', { jsonrpc: '2.0', id: 10, result: { ok: true } }],
	['an error', { jsonrpc: '2.0', id: 11, error: { code: -1, message: 'no' } }],
// "If the server cannot accept the input, it MUST return an HTTP error status
// code (e.g., 400 Bad Request)."
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
])('A response carrying %s is refused over HTTP', async (_case, body) => {
	// The transport asks for an HTTP error status here rather than a JSON-RPC
	// one: this server never sends the client a request, so nothing it sent is
	// being answered, and a JSON-RPC error would read as though something were.
	await expect(handleSystemMcpRequest(body, context))
		.rejects
		.toThrow(/JSON-RPC response is not accepted/);
});

// JSON-RPC 2.0: "a Notification signifies the Client's lack of interest in the
// corresponding Response object", and the server MUST NOT reply to one.
// https://www.jsonrpc.org/specification#notification
test('A notification is answered with nothing at all', async () => {
	const initialized = await handleSystemMcpRequest(
		{ jsonrpc: '2.0', method: 'notifications/initialized' },
		context,
	);

	expect(initialized).toBeNull();

	// Even one naming a method that would otherwise answer.
	const ping = await handleSystemMcpRequest(
		{ jsonrpc: '2.0', method: 'ping' },
		context,
	);

	expect(ping).toBeNull();
});

// JSON-RPC 2.0 tells a notification from a request by the presence of `id`,
// and null is present.
// https://www.jsonrpc.org/specification#request_object
test('A null id is a request, not a notification', async () => {
	const response = await handleSystemMcpRequest(
		{ jsonrpc: '2.0', id: null, method: 'ping' },
		context,
	);

	expect(response).toEqual({ jsonrpc: '2.0', id: null, result: {} });
});
