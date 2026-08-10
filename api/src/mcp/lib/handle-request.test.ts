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
	run: tool.run,
};

vi.mock('./tools.js', () => {
	return {
		exposedMcpTools: () => [TOOL],
		findMcpTool: (name: unknown) => {
			return name === 'list_processes'
				? TOOL
				: undefined;
		},
	};
});

import { handleMcpRequest, MCP_PROTOCOL_VERSION } from './handle-request.js';

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

const call = (body: unknown) => handleMcpRequest(body, context);

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
			serverInfo: { name: 'directus-diagnostics', version: '11.10.1' },
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

	expect(response?.result).toEqual({
		content: [{ type: 'text', text: '{"services":[]}' }],
	});
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
	['an array', ['jsonrpc', '2.0']],
	['a string', 'jsonrpc'],
	['null', null],
])('A body that is %s cannot be parsed', async (_case, body) => {
	const response = await call(body);

	expect(response?.error?.code).toBe(-32700);
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
