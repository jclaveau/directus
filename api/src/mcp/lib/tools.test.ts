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
	return { systemMcpToolGroups: config.groups };
});

const processes = vi.hoisted(() => {
	return { details: vi.fn() };
});

vi.mock('../../processes/lib/processes-config.js', () => {
	return { reportedProcessDetails: processes.details };
});

import { allSystemMcpTools, findSystemMcpTool, systemMcpTools } from './tools.js';

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
	return findSystemMcpTool(name)!.run(args, context);
}

beforeEach(() => {
	config.groups.mockReturnValue(['processes', 'cache']);
	processes.details.mockReturnValue(['stats', 'env']);
	service.constructed.length = 0;

	Object.values(service).forEach((value) => {
		if (typeof value === 'function' && 'mockReset' in value) {
			value.mockReset();
		}
	});
});

test('Every tool is described well enough for a model to choose it', () => {
	expect(allSystemMcpTools().map((tool) => tool.name)).toEqual([
		'list_processes',
		'list_cache_entries',
		'list_cache_anomalies',
		'list_cache_latencies',
		'read_cache_timeseries',
		'read_cache_stats_state',
	]);

	for (const tool of allSystemMcpTools()) {
		expect(tool.title).toBeTruthy();
		expect(tool.description.length).toBeGreaterThan(60);
		expect(tool.inputSchema.type).toBe('object');

		// Says what it answers, so a model reads fields rather than a blob.
		expect(tool.outputSchema.type).toBe('object');

		expect(Object.keys(tool.outputSchema.properties).length)
			.toBeGreaterThan(0);

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
	const windowed = allSystemMcpTools().filter((tool) => {
		return 'window' in tool.inputSchema.properties;
	});

	expect(windowed.map((tool) => tool.name)).toEqual([
		'list_cache_entries',
		'list_cache_anomalies',
		'list_cache_latencies',
		'read_cache_timeseries',
	]);

	expect(findSystemMcpTool('read_cache_timeseries')!.inputSchema.properties)
		.toHaveProperty('buckets');
});

test('A subsystem left out is neither listed nor callable', () => {
	config.groups.mockReturnValue(['processes']);

	expect(systemMcpTools().map((tool) => tool.name)).toEqual(['list_processes']);
	expect(findSystemMcpTool('list_cache_entries')).toBeUndefined();
	expect(findSystemMcpTool('list_processes')).toBeDefined();

	config.groups.mockReturnValue([]);
	expect(systemMcpTools()).toEqual([]);
	expect(findSystemMcpTool('list_processes')).toBeUndefined();
});

test('Every tool declares the subsystem it reads', () => {
	const groups = allSystemMcpTools().map((tool) => tool.group);

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
	expect(findSystemMcpTool('drop_everything')).toBeUndefined();
	expect(findSystemMcpTool(undefined)).toBeUndefined();
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

/**
 * The answers the services really give, keyed by the tool that returns them.
 * Shapes copied from the types the services are declared with — `CacheTimeseries`,
 * `CacheStatsState`, `ProcessesReport` — so a schema that names a field nobody
 * returns fails here instead of misleading a model.
 */
const ANSWERS: Record<string, unknown> = {
	list_processes: {
		collectedAt: 1,
		collectedForMs: 750,
		details: ['stats', 'env'],
		services: [],
		degraded: { crossReplica: false, supervisor: false },
	},
	list_cache_entries: [],
	list_cache_anomalies: [],
	list_cache_latencies: [],
	read_cache_timeseries: { buckets: [], markers: [], effectiveTtl: null },
	read_cache_stats_state: {
		configured: true,
		enabled: true,
		killedReason: null,
		bufferLength: 0,
		droppedEvents: 0,
	},
};

test('Every declared output property is one the tool actually answers', async () => {
	for (const tool of allSystemMcpTools()) {
		const answer = ANSWERS[tool.name];

		expect(answer, `no recorded answer for ${tool.name}`).toBeDefined();

		// A list is named on the way out, which is what the schema describes.
		const structured = Array.isArray(answer)
			? { items: answer }
			: answer as Record<string, unknown>;

		const declared = Object.keys(tool.outputSchema.properties);
		const answered = Object.keys(structured);

		expect(
			declared.filter((property) => answered.includes(property) === false),
			`${tool.name} declares properties it does not answer`,
		).toEqual([]);

		// And nothing the answer carries is left undocumented.
		expect(
			answered.filter((property) => declared.includes(property) === false),
			`${tool.name} answers properties it does not declare`,
		).toEqual([]);
	}
});

/** The description is rebuilt per listing, so it can name what is really on. */
function processesDescriptionWith(details: string[]): string {
	processes.details.mockReturnValue(details);

	const listed = systemMcpTools()
		.find((tool) => tool.name === 'list_processes')!;

	return listed.description;
}

test('The process tool describes the halves this deployment reports', () => {
	const both = processesDescriptionWith(['stats', 'env']);

	expect(both).toContain('what its supervisor observed');
	expect(both).toContain('the environment it resolved');

	// With a half turned off, the description stops promising it rather than
	// promising it and answering null.
	const statsOnly = processesDescriptionWith(['stats']);

	expect(statsOnly).toContain('what its supervisor observed');
	expect(statsOnly).not.toContain('the environment it resolved');

	const envOnly = processesDescriptionWith(['env']);

	expect(envOnly).toContain('the environment it resolved');
	expect(envOnly).not.toContain('what its supervisor observed');

	const neither = processesDescriptionWith([]);

	expect(neither).toContain('Only the identity of each process is reported');
});
