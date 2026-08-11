import type {
	CacheTimeseries,
	ProcessesReport,
	SchemaOverview,
} from '@directus/types';
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

vi.mock('./config.js', () => {
	return { systemMcpToolGroups: config.groups };
});

const processes = vi.hoisted(() => {
	return { details: vi.fn() };
});

vi.mock('../../processes/lib/processes-config.js', () => {
	return { reportedProcessDetails: processes.details };
});

import type {
	CacheAnomalyRecord,
	CacheEntryRecord,
	CacheGroupLatencyRecord,
	CacheLatencyPercentiles,
	CacheStatsState,
} from '../../cache-events.js';
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
 * The answers the services really give — typed as the services declare them, so
 * the compiler maintains this fixture. A field added to `CacheStatsState` or a
 * metric added to `CACHE_LATENCY_METRICS` fails to compile here until it is
 * recorded, which is what keeps the schemas below honest as the types move.
 *
 * Nested rows are filled rather than left as empty arrays: an empty array
 * type-checks against any element type, so it would track nothing.
 */
const percentiles: CacheLatencyPercentiles = { p50: 1, p95: 2, p99: 3 };

const ANSWERS: {
	list_processes: ProcessesReport;
	list_cache_entries: CacheEntryRecord[];
	list_cache_anomalies: CacheAnomalyRecord[];
	list_cache_latencies: CacheGroupLatencyRecord[];
	read_cache_timeseries: CacheTimeseries;
	read_cache_stats_state: CacheStatsState;
} = {
	list_processes: {
		collectedAt: 1_700_000_000_000,
		collectedForMs: 750,
		details: ['stats', 'env'],
		degraded: { crossReplica: false, supervisor: false },
		services: [
			{
				service: 'api',
				replicas: [
					{
						replicaId: 'replica-a',
						hostname: 'host-a',
						supervisor: 'pm2',
						processes: [
							{
								nodeId: 'node-1',
								pid: 100,
								pmId: 0,
								name: 'directus',
								instance: 0,
								responding: true,
								runtime: {
									rssBytes: 1,
									heapUsedBytes: 2,
									heapTotalBytes: 3,
									externalBytes: 4,
									uptimeMs: 5,
									nodeVersion: 'v22.0.0',
								},
								supervisor: {
									status: 'online',
									restarts: 0,
									unstableRestarts: 0,
									uptimeMs: 6,
									memoryBytes: 7,
									cpuPercent: 8,
									maxMemoryRestartBytes: 9,
									execMode: 'cluster_mode',
									configuredInstances: 2,
								},
								env: [
									{
										key: 'DB_CLIENT',
										value: 'pg',
										redacted: false,
										isSet: true,
										source: 'process',
									},
								],
							},
						],
					},
				],
			},
		],
	},
	list_cache_entries: [
		{
			key: 'hash',
			redisKey: 'scalabus:key',
			coarse: false,
			method: 'GET',
			path: '/items/articles',
			collection: 'articles',
			user: { id: 'u1', email: 'ann@corp.io' },
			query: '{"limit":5}',
			url: '/items/articles?limit=5',
			size: 2048,
			hits: 7,
			misses: 2,
			fills: 3,
			fillMs: 240,
			hitMs: 2,
			ttlMs: 60_000,
			recommendedTtlMs: 90_000,
			createdAt: 1,
			expiresAt: 2,
			lastHitAt: 3,
		},
	],
	list_cache_anomalies: [
		{
			cacheKey: 'hash',
			reason: 'value_too_large',
			path: '/items/big',
			method: 'GET',
			query: '{}',
			url: '/items/big',
			count: 4,
			sample: null,
			lastSeen: 5,
		},
	],
	list_cache_latencies: [
		{
			path: '/items/articles',
			method: null,
			query: null,
			response: percentiles,
			miss: percentiles,
			anomaly: percentiles,
			fill: percentiles,
			hit: percentiles,
		},
	],
	read_cache_timeseries: {
		buckets: [
			{
				t: 1,
				hits: 2,
				misses: 3,
				fills: 4,
				anomalies: 5,
				ttlMs: 6,
				effectiveTtlMs: 7,
				hitP50: 1, hitP95: 2, hitP99: 3,
				fillP50: 1, fillP95: 2, fillP99: 3,
				anomalyP50: 1, anomalyP95: 2, anomalyP99: 3,
				missP50: 1, missP95: 2, missP99: 3,
				bothP50: 1, bothP95: 2, bothP99: 3,
			},
		],
		markers: [{ time: 1, kind: 'flush', detail: 'response' }],
		effectiveTtl: '5m',
	},
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
		const answer = ANSWERS[tool.name as keyof typeof ANSWERS];

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
