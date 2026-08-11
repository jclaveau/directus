import { beforeEach, describe, expect, test, vi } from 'vitest';

const mcp = vi.hoisted(() => {
	return { handle: vi.fn(), allowedOrigin: vi.fn() };
});

vi.mock('../system-mcp/index.js', () => {
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

const { default: router } = await import('./system-mcp.js');

/**
 * `router.post(path, asyncHandler(fn))` registers one Route layer whose own stack
 * holds the handler; drive the bare handler, as the utils controller test does.
 * `router.all` registers the same way, under the `_all` method.
 */
function handlerFor(path: string, method: 'post' | '_all') {
	const layer = router.stack.find((entry: any) => {
		return entry.route?.path === path && entry.route?.methods?.[method];
	});

	return (layer as any).route.stack[0].handle as (
		req: any,
		res: any,
		next?: any,
	) => Promise<void>;
}

/** A response that records what was written to it rather than writing it. */
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
const anyOtherMethod = handlerFor('/', '_all');

beforeEach(() => {
	vi.clearAllMocks();
	mcp.allowedOrigin.mockReturnValue(true);
	mcp.handle.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} });
});

describe('the system MCP endpoint', () => {
	// For a request the server "MUST either return Content-Type:
	// text/event-stream […] or application/json, to return one JSON object".
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
	test('answers a request, uncacheably', async () => {
		const res = response();

		await post({
			headers: {},
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, res, vi.fn());

		expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
		expect(res.headers['Cache-Control']).toBe('no-store');
	});

	// "If the server accepts the input, the server MUST return HTTP status code
	// 202 Accepted with no body."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
	test('answers a notification with nothing at all', async () => {
		mcp.handle.mockResolvedValue(null);

		const res = response();

		await post({
			headers: {},
			body: { jsonrpc: '2.0', method: 'notifications/initialized' },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, res, vi.fn());

		expect(res.statusCode).toBe(202);
		expect(res.ended).toBe(true);
		expect(res.body).toBeNull();
	});

	// "Servers MUST validate the Origin header on all incoming connections to
	// prevent DNS rebinding attacks."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning
	test('refuses an origin the deployment never named', async () => {
		mcp.allowedOrigin.mockReturnValue(false);

		// `asyncHandler` hands a throw to `next` rather than rejecting, which is
		// also how express turns it into a status.
		const next = vi.fn();

		await post({
			headers: { origin: 'https://evil.example' },
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, response(), next);

		expect(next).toHaveBeenCalledOnce();
		expect(next.mock.calls[0]![0].message).toMatch(/evil.example/);

		// Refused before anything else looks at the request.
		expect(mcp.handle).not.toHaveBeenCalled();
	});

	// "Servers SHOULD implement proper authentication for all connections", and
	// the tool spec asks servers to "implement proper access controls".
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#security-considerations
	test('refuses anyone who is not an admin', async () => {
		const anonymous = vi.fn();

		await post({
			headers: {},
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: null,
			schema: {},
		}, response(), anonymous);

		expect(anonymous.mock.calls[0]![0].message).toMatch(/admin only/);

		const appUser = vi.fn();

		await post({
			headers: {},
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: { admin: false, user: 'u2', ip: '10.0.0.2' },
			schema: {},
		}, response(), appUser);

		expect(appUser.mock.calls[0]![0].message).toMatch(/admin only/);
		expect(mcp.handle).not.toHaveBeenCalled();
	});

	// "If the server receives a request with an invalid or unsupported
	// MCP-Protocol-Version, it MUST respond with 400 Bad Request."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#protocol-version-header
	test('refuses a protocol revision it does not implement', async () => {
		const next = vi.fn();

		await post({
			headers: { 'mcp-protocol-version': '2099-01-01' },
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, response(), next);

		expect(next.mock.calls[0]![0].message).toMatch(/2099-01-01/);
		expect(mcp.handle).not.toHaveBeenCalled();
	});

	// The 400 above is owed to a caller that got past the credential; ordering
	// it after authentication is this server's choice, not the spec's.
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#protocol-version-header
	test('is refused before the version is judged', async () => {
		const next = vi.fn();

		await post({
			headers: { 'mcp-protocol-version': '2099-01-01' },
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: null,
			schema: {},
		}, response(), next);

		// The credential decides first: an anonymous caller cannot tell a refused
		// revision from an accepted one.
		expect(next.mock.calls[0]![0].message).toMatch(/admin only/);
	});

	// The header is what the client "MUST include […] on all subsequent
	// requests"; its absence is met by assuming a revision, not by refusing.
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#protocol-version-header
	test('accepts the revision it implements, and no header at all', async () => {
		await post({
			headers: { 'mcp-protocol-version': '2025-06-18' },
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, response(), vi.fn());

		await post({
			headers: {},
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, response(), vi.fn());

		expect(mcp.handle).toHaveBeenCalledTimes(2);
	});

	// The tool spec expects tool usage to be logged for audit purposes.
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#security-considerations
	test('traces a tool call, and only chatters about the rest', async () => {
		await post({
			headers: {},
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'list_processes' },
			},
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, response(), vi.fn());

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

		await post({
			headers: {},
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, response(), vi.fn());

		expect(logger.debug).toHaveBeenCalledOnce();
	});

	test('traces before the work, so a read that dies still leaves one', async () => {
		mcp.handle.mockRejectedValue(new Error('redis is gone'));

		const next = vi.fn();

		await post({
			headers: {},
			body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
			accountability: { admin: true, user: 'u1', ip: '10.0.0.1' },
			schema: {},
		}, response(), next);

		expect(next.mock.calls[0]![0].message).toBe('redis is gone');
		expect(logger.info).toHaveBeenCalledOnce();
	});

	// GET is the transport's SSE stream and DELETE ends a session; this server
	// offers neither, and a 404 would tell a client its session had expired.
	// GET: the server "MUST either return Content-Type: text/event-stream […]
	// or else return HTTP 405 Method Not Allowed". DELETE ends a session, and a
	// server that does not allow that "MAY respond […] with HTTP 405".
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#listening-for-messages-from-the-server
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management
	test.each(['GET', 'DELETE'])('answers %s with 405', (method) => {
		const next = vi.fn();

		anyOtherMethod({ method } as any, response(), next);

		expect(next).toHaveBeenCalledOnce();

		// The error handler turns this into the 405 and its `Allow` header.
		expect(next.mock.calls[0]![0].extensions).toEqual({
			allowed: ['POST'],
			current: method,
		});
	});
});
