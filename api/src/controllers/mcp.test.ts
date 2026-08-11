import { beforeEach, describe, expect, test, vi } from 'vitest';

const mcp = vi.hoisted(() => {
	return { handle: vi.fn(), allowedOrigin: vi.fn() };
});

vi.mock('../mcp/index.js', () => {
	return {
		handleSystemMcpRequest: mcp.handle,
		systemMcpAllowsOrigin: mcp.allowedOrigin,
		SUPPORTED_MCP_PROTOCOL_VERSIONS: ['2025-06-18'],
	};
});

const logger = vi.hoisted(() => {
	return { info: vi.fn(), debug: vi.fn() };
});

vi.mock('../logger/index.js', () => {
	return { useLogger: () => logger };
});

const { default: router } = await import('./mcp.js');

/**
 * `router.post(path, asyncHandler(fn))` registers one Route layer whose own stack
 * holds the handler; drive the bare handler, as the utils controller test does.
 */
function handlerFor(path: string, method: 'post' | 'get') {
	const layer = router.stack.find((entry: any) => {
		return entry.route?.path === path && entry.route?.methods?.[method];
	});

	return layer!.route.stack[0].handle;
}

function request(overrides: Record<string, unknown> = {}) {
	return {
		headers: {},
		body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
		accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
		schema: {},
		...overrides,
	} as any;
}

function response() {
	const res: any = {
		statusCode: null,
		body: null,
		headers: {} as Record<string, string>,
		ended: false,
	};

	res.status = (code: number) => {
		res.statusCode = code;
		return res;
	};

	res.end = () => {
		res.ended = true;
		return res;
	};

	res.json = (body: unknown) => {
		res.body = body;
		return res;
	};

	res.setHeader = (name: string, value: string) => {
		res.headers[name] = value;
		return res;
	};

	res.set = (name: string, value: string) => {
		res.headers[name] = value;
		return res;
	};

	res.sendStatus = (code: number) => {
		res.statusCode = code;
		return res;
	};

	return res;
}

const post = handlerFor('/', 'post');
const get = handlerFor('/', 'get');

/**
 * `asyncHandler` hands a throw to `next` rather than rejecting, so a refusal is
 * observed there — which is also how express turns it into a status.
 */
async function refusal(req: unknown, res: unknown = response()) {
	const next = vi.fn();
	await post(req, res, next);

	expect(next).toHaveBeenCalledOnce();

	return next.mock.calls[0]![0] as Error;
}

beforeEach(() => {
	vi.clearAllMocks();
	mcp.allowedOrigin.mockReturnValue(true);
	mcp.handle.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} });
});

describe('the system MCP endpoint', () => {
	test('answers a request, uncacheably', async () => {
		const res = response();
		await post(request(), res, vi.fn());

		expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
		expect(res.headers['Cache-Control']).toBe('no-store');
	});

	test('answers a notification with nothing at all', async () => {
		mcp.handle.mockResolvedValue(null);

		const res = response();
		await post(request(), res, vi.fn());

		expect(res.statusCode).toBe(202);
		expect(res.ended).toBe(true);
		expect(res.body).toBeNull();
	});

	test('refuses an origin the deployment never named', async () => {
		mcp.allowedOrigin.mockReturnValue(false);

		const req = request({ headers: { origin: 'https://evil.example' } });

		expect((await refusal(req)).message).toMatch(/evil.example/);

		// Refused before anything else looks at the request.
		expect(mcp.handle).not.toHaveBeenCalled();
	});

	test('refuses anyone who is not an admin', async () => {
		const anonymous = await refusal(request({ accountability: null }));

		expect(anonymous.message).toMatch(/admin only/);

		const appUser = await refusal(request({ accountability: { admin: false } }));

		expect(appUser.message).toMatch(/admin only/);
		expect(mcp.handle).not.toHaveBeenCalled();
	});

	test('refuses a protocol revision it does not implement', async () => {
		const req = request({ headers: { 'mcp-protocol-version': '2099-01-01' } });

		expect((await refusal(req)).message).toMatch(/2099-01-01/);
		expect(mcp.handle).not.toHaveBeenCalled();
	});

	test('is refused before the version is judged', async () => {
		const req = request({
			accountability: null,
			headers: { 'mcp-protocol-version': '2099-01-01' },
		});

		// The credential decides first: an anonymous caller cannot tell a refused
		// revision from an accepted one.
		expect((await refusal(req)).message).toMatch(/admin only/);
	});

	test('accepts the revision it implements, and no header at all', async () => {
		const withHeader = request({
			headers: { 'mcp-protocol-version': '2025-06-18' },
		});

		await post(withHeader, response(), vi.fn());

		await post(request(), response(), vi.fn());

		expect(mcp.handle).toHaveBeenCalledTimes(2);
	});

	test('traces a tool call, and only chatters about the rest', async () => {
		const call = request({
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'list_processes' },
			},
		});

		await post(call, response(), vi.fn());

		expect(logger.info).toHaveBeenCalledWith(
			{
				ip: '10.0.0.1',
				user: 'u1',
				method: 'tools/call',
				tool: 'list_processes',
			},
			'System MCP tool call',
		);

		expect(logger.debug).not.toHaveBeenCalled();

		await post(request(), response(), vi.fn());

		expect(logger.debug).toHaveBeenCalledOnce();
	});

	test('traces before the work, so a read that dies still leaves one', async () => {
		mcp.handle.mockRejectedValue(new Error('redis is gone'));

		const call = request({
			body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
		});

		expect((await refusal(call)).message).toBe('redis is gone');
		expect(logger.info).toHaveBeenCalledOnce();
	});

	test('answers GET with 405, naming what it does support', () => {
		const res = response();
		get({} as any, res);

		expect(res.statusCode).toBe(405);
		expect(res.headers['Allow']).toBe('POST');
	});
});
