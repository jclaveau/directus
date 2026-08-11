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

const call = (body: unknown) => handleSystemMcpRequest(body, context);

beforeEach(() => {
	tool.run.mockReset();
});

test('Announces the protocol, its capability and itself', async () => {
	const response = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' });

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

test('Answers a ping', async () => {
	expect(await call({ jsonrpc: '2.0', id: 2, method: 'ping' }))
		.toEqual({ jsonrpc: '2.0', id: 2, result: {} });
});

test('Lists the tools without the function behind them', async () => {
	const response = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' });

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

test('Calls a tool and returns what it answered as text', async () => {
	tool.run.mockResolvedValue({ services: [] });

	const response = await call({
		jsonrpc: '2.0',
		id: 4,
		method: 'tools/call',
		params: { name: 'list_processes', arguments: { window: '15m' } },
	});

	expect(tool.run).toHaveBeenCalledWith({ window: '15m' }, context);

	// Structured for a model that reads fields, text for a client that reads
	// only content blocks — and the two say the same thing.
	expect(response?.result).toEqual({
		content: [{ type: 'text', text: '{"services":[]}' }],
		structuredContent: { services: [] },
	});
});

test('A list is named, since structured content must be an object', async () => {
	tool.run.mockResolvedValue([{ key: 'one' }, { key: 'two' }]);

	const response = await call({
		jsonrpc: '2.0',
		id: 14,
		method: 'tools/call',
		params: { name: 'list_processes' },
	});

	expect(response?.result).toEqual({
		content: [{ type: 'text', text: '{"items":[{"key":"one"},{"key":"two"}]}' }],
		structuredContent: { items: [{ key: 'one' }, { key: 'two' }] },
	});
});

test('An answer that is neither object nor list is refused', async () => {
	tool.run.mockResolvedValue('a bare string');

	const response = await call({
		jsonrpc: '2.0',
		id: 15,
		method: 'tools/call',
		params: { name: 'list_processes' },
	});

	expect(response?.result).toMatchObject({ isError: true });
	expect((response?.result as any).content[0].text).toContain('string');
});

test('Arguments that are not an object are read as none', async () => {
	tool.run.mockResolvedValue(null);

	await call({
		jsonrpc: '2.0',
		id: 5,
		method: 'tools/call',
		params: { name: 'list_processes', arguments: 'not-an-object' },
	});

	expect(tool.run).toHaveBeenCalledWith({}, context);
});

test('A tool answering nothing is a broken tool, and says so', async () => {
	tool.run.mockResolvedValue(undefined);

	const response = await call({
		jsonrpc: '2.0',
		id: 12,
		method: 'tools/call',
		params: { name: 'list_processes' },
	});

	// Every tool declares an outputSchema, so every answer owes structured
	// content. Nothing sensible can be built from `undefined`, and a silent
	// half-answer would be worse than saying so.
	expect(response?.result).toMatchObject({ isError: true });
	expect((response?.result as any).content[0].text).toContain('list_processes');
});

test('A thrown non-Error still reaches the caller as text', async () => {
	tool.run.mockRejectedValue('redis is gone');

	const response = await call({
		jsonrpc: '2.0',
		id: 13,
		method: 'tools/call',
		params: { name: 'list_processes' },
	});

	expect(response?.result).toEqual({
		content: [{ type: 'text', text: 'redis is gone' }],
		isError: true,
	});
});

test('A refused read is the tool answer, not a protocol failure', async () => {
	tool.run.mockRejectedValue(new Error('does not have permission'));

	const response = await call({
		jsonrpc: '2.0',
		id: 6,
		method: 'tools/call',
		params: { name: 'list_processes' },
	});

	expect(response?.result).toEqual({
		content: [{ type: 'text', text: 'does not have permission' }],
		isError: true,
	});
});

test('An unknown tool is a bad parameter', async () => {
	const response = await call({
		jsonrpc: '2.0',
		id: 7,
		method: 'tools/call',
		params: { name: 'drop_everything' },
	});

	expect(response?.error).toEqual({
		code: -32602,
		message: 'Unknown tool: drop_everything',
	});
});

test('An unknown method is reported as such', async () => {
	const response = await call({ jsonrpc: '2.0', id: 8, method: 'resources/list' });

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
])('A body that is %s is not a single request', async (_case, body) => {
	const response = await call(body);

	expect(response?.error?.code).toBe(-32600);
	expect(response?.id).toBeNull();
});

test('A message with no method is invalid, and echoes its id', async () => {
	const response = await call({ jsonrpc: '2.0', id: 9 });

	expect(response?.error?.code).toBe(-32600);
	expect(response?.id).toBe(9);
});

test('A notification is answered with nothing at all', async () => {
	expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' }))
		.toBeNull();

	// Even one naming a method that would otherwise answer.
	expect(await call({ jsonrpc: '2.0', method: 'ping' })).toBeNull();
});

test('A null id is a request, not a notification', async () => {
	const response = await call({ jsonrpc: '2.0', id: null, method: 'ping' });

	expect(response).toEqual({ jsonrpc: '2.0', id: null, result: {} });
});
