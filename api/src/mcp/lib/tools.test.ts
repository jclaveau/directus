import type { SchemaOverview } from '@directus/types';
import { beforeEach, expect, test, vi } from 'vitest';

const service = vi.hoisted(() => {
	return {
		readProcesses: vi.fn(),
		getCacheEntries: vi.fn(),
		getCacheAnomalies: vi.fn(),
		getCacheGroupLatencies: vi.fn(),
		getCacheTimeseries: vi.fn(),
		getCacheStatsState: vi.fn(),
		constructed: [] as unknown[],
	};
});

vi.mock('../../services/utils.js', () => {
	return {
		UtilsService: class {
			constructor(options: unknown) {
				service.constructed.push(options);
			}

			readProcesses = service.readProcesses;
			getCacheEntries = service.getCacheEntries;
			getCacheAnomalies = service.getCacheAnomalies;
			getCacheGroupLatencies = service.getCacheGroupLatencies;
			getCacheTimeseries = service.getCacheTimeseries;
			getCacheStatsState = service.getCacheStatsState;
		},
	};
});

const config = vi.hoisted(() => {
	return { groups: vi.fn() };
});

vi.mock('./mcp-config.js', () => {
	return { exposedMcpToolGroups: config.groups };
});

import { exposedMcpTools, findMcpTool, MCP_TOOLS } from './tools.js';

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

function run(name: string, args: Record<string, unknown> = {}) {
	return findMcpTool(name)!.run(args, context);
}

beforeEach(() => {
	config.groups.mockReturnValue(['processes', 'cache']);
	service.constructed.length = 0;

	Object.values(service).forEach((value) => {
		if (typeof value === 'function' && 'mockReset' in value) {
			value.mockReset();
		}
	});
});

test('Every tool is described well enough for a model to choose it', () => {
	expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([
		'list_processes',
		'list_cache_entries',
		'list_cache_anomalies',
		'list_cache_latencies',
		'read_cache_timeseries',
		'read_cache_stats_state',
	]);

	for (const tool of MCP_TOOLS) {
		expect(tool.title).toBeTruthy();
		expect(tool.description.length).toBeGreaterThan(60);
		expect(tool.inputSchema.type).toBe('object');

		// Every one of these reads and nothing more, and says so, which is what
		// lets a client call it without asking the user to approve it.
		expect(tool.annotations).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		});
	}
});

test('Only the windowed reads take a window', () => {
	const windowed = MCP_TOOLS.filter((tool) => {
		return 'window' in tool.inputSchema.properties;
	});

	expect(windowed.map((tool) => tool.name)).toEqual([
		'list_cache_entries',
		'list_cache_anomalies',
		'list_cache_latencies',
		'read_cache_timeseries',
	]);

	expect(findMcpTool('read_cache_timeseries')!.inputSchema.properties)
		.toHaveProperty('buckets');
});

test('A subsystem left out is neither listed nor callable', () => {
	config.groups.mockReturnValue(['processes']);

	expect(exposedMcpTools().map((tool) => tool.name)).toEqual(['list_processes']);
	expect(findMcpTool('list_cache_entries')).toBeUndefined();
	expect(findMcpTool('list_processes')).toBeDefined();

	config.groups.mockReturnValue([]);
	expect(exposedMcpTools()).toEqual([]);
	expect(findMcpTool('list_processes')).toBeUndefined();
});

test('Every tool declares the subsystem it reads', () => {
	const groups = MCP_TOOLS.map((tool) => tool.group);

	expect(groups).toEqual([
		'processes',
		'cache',
		'cache',
		'cache',
		'cache',
		'cache',
	]);
});

test('An unknown name resolves to no tool', () => {
	expect(findMcpTool('drop_everything')).toBeUndefined();
	expect(findMcpTool(undefined)).toBeUndefined();
});

test('Every read is made as the caller, through the guarded service', async () => {
	service.readProcesses.mockResolvedValue({ services: [] });

	await run('list_processes');

	expect(service.readProcesses).toHaveBeenCalledOnce();

	expect(service.constructed).toEqual([
		{ accountability: context.accountability, schema: context.schema },
	]);
});

test.each([
	['list_cache_entries', 'getCacheEntries'],
	['list_cache_anomalies', 'getCacheAnomalies'],
	['list_cache_latencies', 'getCacheGroupLatencies'],
] as const)('%s reads the window it was given', async (tool, method) => {
	await run(tool, { window: '15m' });
	expect(service[method]).toHaveBeenCalledWith(900_000);

	await run(tool);
	expect(service[method]).toHaveBeenLastCalledWith(undefined);
});

test('The timeseries takes both the window and the bucket count', async () => {
	await run('read_cache_timeseries', { window: '1h', buckets: 12 });
	expect(service.getCacheTimeseries).toHaveBeenCalledWith(3_600_000, 12);

	// A bucket count given as text still reaches the service as a number.
	await run('read_cache_timeseries', { window: '1h', buckets: '6' });
	expect(service.getCacheTimeseries).toHaveBeenLastCalledWith(3_600_000, 6);

	await run('read_cache_timeseries');
	expect(service.getCacheTimeseries).toHaveBeenLastCalledWith(undefined, undefined);
});

test('The telemetry state takes no argument', async () => {
	service.getCacheStatsState.mockResolvedValue({ enabled: true });

	await expect(run('read_cache_stats_state')).resolves.toEqual({ enabled: true });
	expect(service.getCacheStatsState).toHaveBeenCalledOnce();
});
