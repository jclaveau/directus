import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const allowedOrigin = 'https://agent.example';

const toolNames = [
	'list_processes',
	'list_cache_entries',
	'read_cache_entry',
	'list_cache_anomalies',
	'list_cache_latencies',
	'read_cache_timeseries',
	'read_cache_stats_state',
];

// The reads that look back over a period, as against the ones that answer about
// right now (`list_processes`, `read_cache_stats_state`) or about a single named
// entry (`read_cache_entry`).
const windowedToolNames = [
	'list_cache_entries',
	'list_cache_anomalies',
	'list_cache_latencies',
	'read_cache_timeseries',
];

describe('System MCP Tests', () => {
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };

	const envKeys = [
		'envMcp',
		'envMcpProcessesOnly',
		'envMcpOff',
		'envMcpNoProcessesReport',
	] as const;

	type EnvTypes = Record<(typeof envKeys)[number], Env>;

	const envs = {} as Record<Vendor, EnvTypes>;

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			// Redis-backed cache with telemetry on, so the cache tools answer about
			// something live rather than about a disabled subsystem.
			const envMcp = cloneDeep(config.envs);
			envMcp[vendor]['SYSTEM_MCP_ENABLED'] = 'true';
			envMcp[vendor]['SYSTEM_MCP_ALLOWED_ORIGINS'] = allowedOrigin;
			envMcp[vendor]['CACHE_ENABLED'] = 'true';
			envMcp[vendor]['CACHE_STORE'] = 'redis';
			envMcp[vendor]['REDIS_HOST'] = 'localhost';
			envMcp[vendor]['REDIS_PORT'] = '6108';
			envMcp[vendor]['CACHE_NAMESPACE'] = `blackbox-mcp-${vendor}`;
			envMcp[vendor]['CACHE_STATS_ENABLED'] = 'true';

			// One subsystem only: the cache tools must be neither listed nor callable.
			const envMcpProcessesOnly = cloneDeep(envMcp);
			envMcpProcessesOnly[vendor]['SYSTEM_MCP_TOOLS'] = 'processes';

			const envMcpOff = cloneDeep(envMcp);
			envMcpOff[vendor]['SYSTEM_MCP_ENABLED'] = 'false';

			// The processes group is configured, but the report it reads is off:
			// the tool must follow the feature, not the group list.
			const envMcpNoProcessesReport = cloneDeep(envMcp);
			envMcpNoProcessesReport[vendor]['PROCESSES_REPORT_ENABLED'] = 'false';

			const ports = await Promise.all(envKeys.map(() => getPort()));

			envs[vendor] = {
				envMcp,
				envMcpProcessesOnly,
				envMcpOff,
				envMcpNoProcessesReport,
			};

			directusInstances[vendor] = [];

			for (const [index, key] of envKeys.entries()) {
				const env = envs[vendor][key];
				env[vendor].PORT = String(ports[index]);

				directusInstances[vendor].push(
					spawn('node', [paths.cli, 'start'], { cwd: paths.cwd, env: env[vendor] }),
				);

				promises.push(awaitDirectusConnection(ports[index]!));
			}
		}

		await Promise.all(promises);
	}, 180_000);

	afterAll(() => {
		for (const vendor of vendors) {
			for (const instance of directusInstances[vendor]!) {
				instance.kill();
			}
		}
	});

	function post(vendor: Vendor, key: keyof EnvTypes, body: unknown) {
		return request(getUrl(vendor, envs[vendor][key]))
			.post('/system-mcp')
			.send(body as object);
	}

	function call(vendor: Vendor, body: unknown) {
		return post(vendor, 'envMcp', body)
			.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);
	}

	async function callTool(vendor: Vendor, name: string, args: object = {}) {
		return call(vendor, {
			jsonrpc: '2.0',
			id: 7,
			method: 'tools/call',
			params: { name, arguments: args },
		});
	}

	describe('Serves no endpoint where the system MCP is turned off', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await post(vendor, 'envMcpOff', {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
			}).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(404);
		});
	});

	// "Servers SHOULD implement proper authentication for all connections."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning
	describe('Refuses a call with no credential', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
			});

			expect(response.statusCode).toBe(403);
		});
	});

	// The tool spec asks servers to "implement proper access controls".
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#security-considerations
	describe('Refuses a token that is not an admin', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
			}).set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

			expect(response.statusCode).toBe(403);
		});
	});

	describe('Accepts an admin static token', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 2,
				method: 'ping',
			}).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(200);
			expect(response.body).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
		});
	});

	// "Servers MUST validate the Origin header on all incoming connections to
	// prevent DNS rebinding attacks."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning
	describe('Refuses a browser origin that was never named', () => {
		it.each(vendors)('%s', async (vendor) => {
			// DNS rebinding arrives as a valid credential from an origin the
			// deployment never allowed, so the Origin is what has to be checked.
			const response = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
			})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.set('Origin', 'https://evil.example');

			expect(response.statusCode).toBe(403);
		});
	});

	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning
	describe('Accepts the browser origin it was given', () => {
		it.each(vendors)('%s', async (vendor) => {
			// The same origin in another case is the same origin: scheme and host
			// are case-insensitive.
			for (const origin of [allowedOrigin, allowedOrigin.toUpperCase()]) {
				const response = await post(vendor, 'envMcp', {
					jsonrpc: '2.0',
					id: 3,
					method: 'ping',
				})
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
					.set('Origin', origin);

				expect(response.statusCode).toBe(200);
			}
		});
	});

	// The server "MUST either return Content-Type: text/event-stream in response
	// to this HTTP GET, or else return HTTP 405 Method Not Allowed".
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#listening-for-messages-from-the-server
	describe('Answers GET with 405, not 404', () => {
		it.each(vendors)('%s', async (vendor) => {
			// The transport reserves GET for an SSE stream this server does not
			// offer; 404 would read as a terminated session instead.
			const response = await request(getUrl(vendor, envs[vendor]['envMcp']))
				.get('/system-mcp')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(405);
			// RFC 9110: a 405 MUST say what the resource does support.
			expect(response.headers['allow']).toContain('POST');
		});
	});

	// A server that does not let clients end sessions "MAY respond to this
	// request with HTTP 405 Method Not Allowed".
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management
	describe('Answers DELETE with 405 too', () => {
		it.each(vendors)('%s', async (vendor) => {
			// DELETE ends a session, and this server opens none. Answering 404
			// would send the client off to open a replacement for a session that
			// never existed.
			const response = await request(getUrl(vendor, envs[vendor]['envMcp']))
				.delete('/system-mcp')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(405);
			expect(response.headers['allow']).toContain('POST');
		});
	});

	// "If the server cannot accept the input, it MUST return an HTTP error
	// status code (e.g., 400 Bad Request)."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
	describe('Refuses a JSON-RPC response with an HTTP error', () => {
		it.each(vendors)('%s', async (vendor) => {
			// The transport allows a response or a notification only two answers:
			// 202 when the server accepts it, an HTTP error when it cannot. This
			// server never asks the client anything, so a response answers nothing
			// and is refused — as a status, not as a JSON-RPC error, which would
			// read as an answer to a request the client never sent.
			const response = await call(vendor, {
				jsonrpc: '2.0',
				id: 1,
				result: { tools: [] },
			});

			expect(response.statusCode).toBe(400);
			expect(response.body.errors[0].message).toContain('JSON-RPC response');
		});
	});

	// "If the server receives a request with an invalid or unsupported
	// MCP-Protocol-Version, it MUST respond with 400 Bad Request."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#protocol-version-header
	describe('Refuses a protocol revision it does not implement', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 1,
				method: 'ping',
			})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.set('MCP-Protocol-Version', '2099-01-01');

			expect(response.statusCode).toBe(400);

			// 2025-03-26 makes batching mandatory and this server answers a single
			// message, so it is refused rather than half-claimed.
			const older = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 1,
				method: 'ping',
			})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.set('MCP-Protocol-Version', '2025-03-26');

			expect(older.statusCode).toBe(400);

			const accepted = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 1,
				method: 'ping',
			})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.set('MCP-Protocol-Version', '2025-06-18');

			expect(accepted.statusCode).toBe(200);
		});
	});

	// "The server MUST respond with its own capabilities and information", and
	// with a protocol version it supports.
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#initialization
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#version-negotiation
	describe('Announces itself to a client that initializes', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await call(vendor, {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-06-18',
					capabilities: {},
					clientInfo: { name: 'blackbox', version: '0.0.0' },
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.body.jsonrpc).toBe('2.0');
			expect(response.body.result.protocolVersion).toBe('2025-06-18');

			expect(response.body.result.capabilities.tools)
				.toEqual({ listChanged: false });

			expect(response.body.result.serverInfo.name).toBe('directus-system');
			expect(response.body.result.serverInfo.version).toBeTruthy();
			// Live state must never be served from a store in front of it.
			expect(response.headers['cache-control']).toBe('no-store');
		});
	});

	// "If the server accepts the input, the server MUST return HTTP status code
	// 202 Accepted with no body."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
	describe('Answers a notification with no body', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await call(vendor, {
				jsonrpc: '2.0',
				method: 'notifications/initialized',
			});

			expect(response.statusCode).toBe(202);
			expect(response.text).toBe('');
		});
	});

	// The shape of a `tools/list` result, and the fields a tool carries.
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#listing-tools
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool
	describe('Lists every diagnostic tool with a callable schema', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await call(vendor, {
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/list',
			});

			expect(response.statusCode).toBe(200);

			const tools = response.body.result.tools;

			expect(tools.map((tool: { name: string }) => tool.name)).toEqual(toolNames);

			for (const tool of tools) {
				expect(tool.title).toBeTruthy();
				// Read-only is advertised, not merely true, so a client can call
				// one without asking the user to approve it.
				expect(tool.annotations.readOnlyHint).toBe(true);
				expect(tool.annotations.destructiveHint).toBe(false);
				expect(tool.outputSchema.type).toBe('object');
				// The description is what a model chooses on, so it has to say what
				// the tool answers, not just name it.
				expect(tool.description.length).toBeGreaterThan(60);
				expect(tool.inputSchema.type).toBe('object');
				expect(tool.inputSchema.properties).toBeDefined();
			}

			const windowed = tools.filter((tool: { name: string }) => {
				return windowedToolNames.includes(tool.name);
			});

			// Named rather than excluded, so a tool added later has to be placed
			// on one side or the other instead of silently dropping out.
			expect(windowed).toHaveLength(windowedToolNames.length);

			for (const tool of windowed) {
				expect(tool.inputSchema.properties.window.type).toBe('string');
			}

			const entry = tools.find((tool: { name: string }) => {
				return tool.name === 'read_cache_entry';
			});

			expect(entry.inputSchema.required).toEqual(['key']);

			// It answers about the entry, never with the response inside it, and
			// the published schema is what tells a model so before it calls.
			expect(entry.outputSchema.properties).not.toHaveProperty('value');
			expect(entry.outputSchema.properties).toHaveProperty('sizes');
		});
	});

	// "Servers MUST provide structured results that conform to this schema",
	// and SHOULD "also return the serialized JSON in a TextContent block".
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content
	describe('Answers the processes tool with the tree', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await callTool(vendor, 'list_processes');

			expect(response.statusCode).toBe(200);
			expect(response.body.result.isError).toBeUndefined();

			const content = response.body.result.content;

			expect(content[0].type).toBe('text');

			const report = JSON.parse(content[0].text);

			expect(report.services.length).toBeGreaterThan(0);

			// The structured answer is what a model reads, and it says the same
			// thing as the text block beside it.
			expect(response.body.result.structuredContent).toEqual(report);
			expect(report.details).toEqual(['stats', 'env']);
			expect(report.degraded).toBeDefined();

			// The tool inherits the endpoint's redaction: this instance sets SECRET.
			expect(content[0].text).not.toContain('directus-test');
		});
	});

	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content
	describe('Answers every cache tool', () => {
		it.each(vendors)('%s', async (vendor) => {
			const listings = [
				'list_cache_entries',
				'list_cache_anomalies',
				'list_cache_latencies',
			];

			for (const name of listings) {
				const response = await callTool(vendor, name, { window: '15m' });

				expect(response.statusCode).toBe(200);
				expect(response.body.result.isError).toBeUndefined();

				// A list arrives named, since structured content must be an object.
				const structured = response.body.result.structuredContent;

				expect(Array.isArray(structured.items)).toBe(true);

				expect(JSON.parse(response.body.result.content[0].text))
					.toEqual(structured);
			}

			const timeseries = await callTool(vendor, 'read_cache_timeseries', {
				window: '15m',
				buckets: 5,
			});

			const series = timeseries.body.result.structuredContent;

			// The bucket count is what proves the argument reached the read rather
			// than being dropped on the way.
			expect(series.buckets).toHaveLength(5);
			expect(Array.isArray(series.markers)).toBe(true);

			expect(JSON.parse(timeseries.body.result.content[0].text))
				.toEqual(series);

			// A key nothing ever wrote. The entry read goes straight to the store
			// rather than to the telemetry descriptors, so this is a real read with
			// no flush to wait on, and it must answer the whole shape a model reads
			// fields off rather than a bare "no".
			const missing = await callTool(vendor, 'read_cache_entry', {
				key: 'blackbox-never-written',
			});

			const entry = missing.body.result.structuredContent;

			expect(missing.body.result.isError).toBeUndefined();
			expect(entry.exists).toBe(false);
			expect(entry.tags).toBeNull();
			expect(entry.tagCounts).toEqual({});
			expect(entry.expiry).toBeNull();
			expect(entry.sizes).toBeNull();
			expect(entry.tombstone).toBeNull();

			// The cached response itself is never handed back: the cache key
			// carries the user, so a body is one person's view of the data, and a
			// tool answer travels wherever the model's context travels.
			expect(entry).not.toHaveProperty('value');

			// Non-vacuous: telemetry is on for this instance, so the tool reporting
			// the collection state must say so.
			const state = await callTool(vendor, 'read_cache_stats_state');

			expect(JSON.parse(state.body.result.content[0].text).enabled).toBe(true);
		});
	});

	// "Servers MUST: validate all tool inputs."
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#security-considerations
	describe('Refuses an argument it cannot read, as a protocol error', () => {
		it.each(vendors)('%s', async (vendor) => {
			// Not `isError`: the read never ran, so this is "invalid arguments",
			// which the spec lists among the protocol errors.
			const window = await callTool(vendor, 'list_cache_entries', {
				window: 'yesterday',
			});

			expect(window.body.error.code).toBe(-32602);
			expect(window.body.error.message).toContain('yesterday');
			expect(window.body.result).toBeUndefined();

			const buckets = await callTool(vendor, 'read_cache_timeseries', {
				buckets: 'five',
			});

			expect(buckets.body.error.code).toBe(-32602);
			expect(buckets.body.error.message).toContain('five');

			// `Number(null)` is 0 and `Number({})` is NaN — one finite, one not — so
			// a count that is no count at all is refused on its type, not its parse.
			// The guard itself lives in `UtilsService.getCacheTimeseries`, which is
			// what makes `GET /utils/cache/timeseries` refuse these same values.
			for (const noCount of [null, {}, true, []]) {
				const noBuckets = await callTool(vendor, 'read_cache_timeseries', {
					buckets: noCount,
				});

				expect(noBuckets.body.error.code).toBe(-32602);
				expect(noBuckets.body.error.message).toContain('is not a number');
			}

			// The entry read names one entry, so it has nothing to fall back on.
			const noKey = await callTool(vendor, 'read_cache_entry', {});

			expect(noKey.body.error.code).toBe(-32602);
			expect(noKey.body.error.message).toContain('key');
		});
	});

	// JSON-RPC 2.0: the member MUST be exactly "2.0".
	// https://www.jsonrpc.org/specification#request_object
	describe('Refuses a message that does not name the protocol', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await call(vendor, { id: 30, method: 'ping' });

			expect(response.body.error.code).toBe(-32600);
			expect(response.body.error.message).toContain('jsonrpc');
		});
	});

	describe('Offers no processes tool where the report itself is off', () => {
		it.each(vendors)('%s', async (vendor) => {
			// `PROCESSES_REPORT_ENABLED` off takes every node's responder with it,
			// so the read behind this tool would wait out its collection window and
			// answer an empty tree. The REST route is absent in that deployment.
			const rest = await request(
				getUrl(vendor, envs[vendor]['envMcpNoProcessesReport']),
			)
				.get('/utils/processes')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(rest.statusCode).toBe(404);

			const listed = await post(vendor, 'envMcpNoProcessesReport', {
				jsonrpc: '2.0',
				id: 12,
				method: 'tools/list',
			}).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			const names = listed.body.result.tools
				.map((tool: { name: string }) => tool.name);

			expect(names).not.toContain('list_processes');
			// The cache tools it was configured for are still there.
			expect(names).toContain('list_cache_entries');

			// Not merely unlisted: it cannot be called either.
			const called = await post(vendor, 'envMcpNoProcessesReport', {
				jsonrpc: '2.0',
				id: 13,
				method: 'tools/call',
				params: { name: 'list_processes' },
			}).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(called.body.error.code).toBe(-32602);
		});
	});

	describe('Exposes only the subsystems it was configured for', () => {
		it.each(vendors)('%s', async (vendor) => {
			const listed = await post(vendor, 'envMcpProcessesOnly', {
				jsonrpc: '2.0',
				id: 10,
				method: 'tools/list',
			}).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(listed.body.result.tools.map((tool: { name: string }) => tool.name))
				.toEqual(['list_processes']);

			// Not merely hidden: a cache tool cannot be called either.
			const called = await post(vendor, 'envMcpProcessesOnly', {
				jsonrpc: '2.0',
				id: 11,
				method: 'tools/call',
				params: { name: 'list_cache_entries' },
			}).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(called.body.error.code).toBe(-32602);
		});
	});

	// JSON-RPC 2.0: -32601 is "the method does not exist / is not available".
	// https://www.jsonrpc.org/specification#error_object
	describe('Reports an unknown method as a protocol error', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await call(vendor, {
				jsonrpc: '2.0',
				id: 4,
				method: 'resources/list',
			});

			expect(response.statusCode).toBe(200);
			expect(response.body.error.code).toBe(-32601);
			expect(response.body.error.message).toContain('resources/list');
		});
	});

	// An unknown tool is a protocol error; the spec's own example is -32602.
	// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling
	describe('Reports an unknown tool as a bad parameter', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await callTool(vendor, 'drop_everything');

			expect(response.statusCode).toBe(200);
			expect(response.body.error.code).toBe(-32602);
			expect(response.body.error.message).toContain('drop_everything');
		});
	});

	// "The body of the POST request MUST be a single JSON-RPC request,
	// notification, or response."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
	describe('Reports a malformed message', () => {
		it.each(vendors)('%s', async (vendor) => {
			// An array is well-formed JSON of the wrong shape — an invalid request,
			// not a parse failure, and this revision removed batching anyway.
			const notAnObject = await call(vendor, ['jsonrpc', '2.0']);

			expect(notAnObject.body.error.code).toBe(-32600);

			const noMethod = await call(vendor, { jsonrpc: '2.0', id: 5 });

			expect(noMethod.body.error.code).toBe(-32600);
			expect(noMethod.body.id).toBe(5);
		});
	});

	// "If the input consists solely of (any number of) JSON-RPC responses or
	// notifications: […] If the server cannot accept the input, it MUST return
	// an HTTP error status code (e.g., 400 Bad Request)."
	// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server
	describe('Refuses a malformed notification with a status, not a body', () => {
		it.each(vendors)('%s', async (vendor) => {
			// It carries no id, so it is owed no response object — which leaves the
			// status as the only way to say it was not accepted. Answering it with
			// a JSON-RPC error would be replying to a message whose whole point is
			// that no reply is coming.
			const response = await call(vendor, {
				method: 'notifications/initialized',
			});

			expect(response.statusCode).toBe(400);

			// And a well-formed one is still accepted with nothing at all.
			const accepted = await call(vendor, {
				jsonrpc: '2.0',
				method: 'notifications/initialized',
			});

			expect(accepted.statusCode).toBe(202);
			expect(accepted.text).toBe('');
		});
	});

	describe('Publishes the diagnostic reads in the OpenAPI spec', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await request(getUrl(vendor, envs[vendor]['envMcp']))
				.get('/server/specs/oas')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(200);

			const paths = response.body.paths;

			expect(paths['/system-mcp'].post.operationId).toBe('call-system-mcp');
			expect(paths['/utils/processes'].get.operationId).toBe('list-processes');
			expect(paths['/utils/cache'].get.operationId).toBe('list-cache-entries');
			expect(paths['/utils/cache/entry'].get.operationId).toBe('read-cache-entry');
			expect(paths['/utils/cache/anomalies']).toBeDefined();
			expect(paths['/utils/cache/latencies']).toBeDefined();
			expect(paths['/utils/cache/timeseries']).toBeDefined();
			expect(paths['/utils/cache/stats']).toBeDefined();

			// The window parameter is what makes the cache reads usable without
			// guessing, so it has to reach the published spec.
			const windowParam = paths['/utils/cache'].get.parameters
				.find((parameter: { name: string }) => parameter.name === 'window');

			expect(windowParam.schema.type).toBe('string');
		});
	});

	// A Path Item Object "MAY be extended with Specification Extensions", which
	// is how OAS says to add what it has no field for — and it has no field for
	// a path that exists only on some deployments.
	// https://spec.openapis.org/oas/v3.0.1.html#specification-extensions
	describe('Publishes only the paths this deployment actually serves', () => {
		it.each(vendors)('%s', async (vendor) => {
			const spec = async (key: keyof EnvTypes) => {
				const response = await request(getUrl(vendor, envs[vendor][key]))
					.get('/server/specs/oas')
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				return {
					paths: Object.keys(response.body.paths),
					tags: response.body.tags.map((tag: { name: string }) => tag.name),
				};
			};

			// The endpoint is a 404 on this instance, so publishing it would
			// document the 404 — `x-enabled-by` drops it instead.
			const off = await spec('envMcpOff');

			expect(off.paths).not.toContain('/system-mcp');

			// And its tag goes with it rather than staying advertised empty.
			expect(off.tags).not.toContain('System MCP');

			// Non-vacuous: everything this instance does serve is still published.
			expect(off.paths).toContain('/utils/cache');
			expect(off.paths).toContain('/utils/processes');
			expect(off.tags).toContain('System Diagnostics');

			// The other gate, on an instance where the MCP itself is on: the
			// processes read is absent, and its tag survives because the cache
			// reads underneath it are still served.
			const noReport = await spec('envMcpNoProcessesReport');

			expect(noReport.paths).not.toContain('/utils/processes');
			expect(noReport.paths).toContain('/system-mcp');
			expect(noReport.paths).toContain('/utils/cache');
			expect(noReport.tags).toContain('System Diagnostics');
		});
	});

	describe('Publishes them to nobody but an administrator', () => {
		it.each(vendors)('%s', async (vendor) => {
			const url = getUrl(vendor, envs[vendor]['envMcp']);

			// `/server/specs/oas` needs no credential at all, so the spec is where
			// an admin-only endpoint leaks its existence if its tag is not gated.
			const [anonymous, appUser] = await Promise.all([
				request(url).get('/server/specs/oas'),
				request(url)
					.get('/server/specs/oas')
					.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`),
			]);

			for (const response of [anonymous, appUser]) {
				expect(response.statusCode).toBe(200);

				expect(Object.keys(response.body.paths)).toEqual(
					expect.not.arrayContaining([
						'/system-mcp',
						'/utils/processes',
						'/utils/cache',
						'/utils/cache/entry',
						'/utils/cache/anomalies',
						'/utils/cache/latencies',
						'/utils/cache/timeseries',
						'/utils/cache/stats',
					]),
				);

				// Not a spec emptied by the credential: what they may read is there.
				expect(response.body.paths['/server/ping']).toBeDefined();
			}

			// And the tags themselves, which is what the gate really acts on.
			const tagNames = anonymous.body.tags
				.map((tag: { name: string }) => tag.name);

			expect(tagNames).toEqual(
				expect.not.arrayContaining(['System MCP', 'System Diagnostics']),
			);
		});
	});
});
