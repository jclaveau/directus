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
	'list_cache_anomalies',
	'list_cache_latencies',
	'read_cache_timeseries',
	'read_cache_stats_state',
];

describe('Diagnostics MCP Tests', () => {
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };

	const envKeys = [
		'envMcp',
		'envMcpProcessesOnly',
		'envMcpOff',
	] as const;

	type EnvTypes = Record<(typeof envKeys)[number], Env>;

	const envs = {} as Record<Vendor, EnvTypes>;

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			// Redis-backed cache with telemetry on, so the cache tools answer about
			// something live rather than about a disabled subsystem.
			const envMcp = cloneDeep(config.envs);
			envMcp[vendor]['DIAGNOSTICS_MCP_ENABLED'] = 'true';
			envMcp[vendor]['DIAGNOSTICS_MCP_ALLOWED_ORIGINS'] = allowedOrigin;
			envMcp[vendor]['CACHE_ENABLED'] = 'true';
			envMcp[vendor]['CACHE_STORE'] = 'redis';
			envMcp[vendor]['REDIS_HOST'] = 'localhost';
			envMcp[vendor]['REDIS_PORT'] = '6108';
			envMcp[vendor]['CACHE_NAMESPACE'] = `blackbox-mcp-${vendor}`;
			envMcp[vendor]['CACHE_STATS_ENABLED'] = 'true';

			// One subsystem only: the cache tools must be neither listed nor callable.
			const envMcpProcessesOnly = cloneDeep(envMcp);
			envMcpProcessesOnly[vendor]['DIAGNOSTICS_MCP_TOOLS'] = 'processes';

			const envMcpOff = cloneDeep(envMcp);
			envMcpOff[vendor]['DIAGNOSTICS_MCP_ENABLED'] = 'false';

			const ports = await Promise.all(envKeys.map(() => getPort()));

			envs[vendor] = {
				envMcp,
				envMcpProcessesOnly,
				envMcpOff,
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
			.post('/diagnostics/mcp')
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

	describe('Serves no endpoint where the MCP is turned off', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await post(vendor, 'envMcpOff', {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
			}).set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(404);
		});
	});

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

	describe('Accepts the browser origin it was given', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await post(vendor, 'envMcp', {
				jsonrpc: '2.0',
				id: 3,
				method: 'ping',
			})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
				.set('Origin', allowedOrigin);

			expect(response.statusCode).toBe(200);
		});
	});

	describe('Answers GET with 405, not 404', () => {
		it.each(vendors)('%s', async (vendor) => {
			// The transport reserves GET for an SSE stream this server does not
			// offer; 404 would read as a terminated session instead.
			const response = await request(getUrl(vendor, envs[vendor]['envMcp']))
				.get('/diagnostics/mcp')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(405);
		});
	});

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

			// The revision this server implements, and the one the spec says to
			// assume when the header is absent, both pass.
			for (const version of ['2025-06-18', '2025-03-26']) {
				const accepted = await post(vendor, 'envMcp', {
					jsonrpc: '2.0',
					id: 1,
					method: 'ping',
				})
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
					.set('MCP-Protocol-Version', version);

				expect(accepted.statusCode).toBe(200);
			}
		});
	});

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

			expect(response.body.result.serverInfo.name).toBe('directus-diagnostics');
			expect(response.body.result.serverInfo.version).toBeTruthy();
			// Live state must never be served from a store in front of it.
			expect(response.headers['cache-control']).toBe('no-store');
		});
	});

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
				// The description is what a model chooses on, so it has to say what
				// the tool answers, not just name it.
				expect(tool.description.length).toBeGreaterThan(60);
				expect(tool.inputSchema.type).toBe('object');
				expect(tool.inputSchema.properties).toBeDefined();
			}

			const windowed = tools.filter((tool: { name: string }) => {
				return tool.name !== 'list_processes'
					&& tool.name !== 'read_cache_stats_state';
			});

			for (const tool of windowed) {
				expect(tool.inputSchema.properties.window.type).toBe('string');
			}
		});
	});

	describe('Answers the processes tool with the tree', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await callTool(vendor, 'list_processes');

			expect(response.statusCode).toBe(200);
			expect(response.body.result.isError).toBeUndefined();

			const content = response.body.result.content;

			expect(content[0].type).toBe('text');

			const report = JSON.parse(content[0].text);

			expect(report.services.length).toBeGreaterThan(0);
			expect(report.details).toEqual(['stats', 'env']);
			expect(report.degraded).toBeDefined();

			// The tool inherits the endpoint's redaction: this instance sets SECRET.
			expect(content[0].text).not.toContain('directus-test');
		});
	});

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

				expect(Array.isArray(JSON.parse(response.body.result.content[0].text)))
					.toBe(true);
			}

			const timeseries = await callTool(vendor, 'read_cache_timeseries', {
				window: '15m',
				buckets: 5,
			});

			expect(JSON.parse(timeseries.body.result.content[0].text))
				.toBeInstanceOf(Object);

			// Non-vacuous: telemetry is on for this instance, so the tool reporting
			// the collection state must say so.
			const state = await callTool(vendor, 'read_cache_stats_state');

			expect(JSON.parse(state.body.result.content[0].text).enabled).toBe(true);
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

	describe('Reports an unknown tool as a bad parameter', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await callTool(vendor, 'drop_everything');

			expect(response.statusCode).toBe(200);
			expect(response.body.error.code).toBe(-32602);
			expect(response.body.error.message).toContain('drop_everything');
		});
	});

	describe('Reports a malformed message', () => {
		it.each(vendors)('%s', async (vendor) => {
			const notAnObject = await call(vendor, ['jsonrpc', '2.0']);

			expect(notAnObject.body.error.code).toBe(-32700);

			const noMethod = await call(vendor, { jsonrpc: '2.0', id: 5 });

			expect(noMethod.body.error.code).toBe(-32600);
			expect(noMethod.body.id).toBe(5);
		});
	});

	describe('Publishes the diagnostic reads in the OpenAPI spec', () => {
		it.each(vendors)('%s', async (vendor) => {
			const response = await request(getUrl(vendor, envs[vendor]['envMcp']))
				.get('/server/specs/oas')
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(200);

			const paths = response.body.paths;

			expect(paths['/diagnostics/mcp'].post.operationId).toBe('call-mcp');
			expect(paths['/utils/processes'].get.operationId).toBe('list-processes');
			expect(paths['/utils/cache'].get.operationId).toBe('list-cache-entries');
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
});
