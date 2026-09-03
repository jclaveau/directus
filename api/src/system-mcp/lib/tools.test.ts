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
		readCacheEntry: vi.fn(),
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
			readCacheEntry = service.readCacheEntry;
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
	return { details: vi.fn(), reportEnabled: vi.fn() };
});

vi.mock('../../processes/lib/processes-config.js', () => {
	return {
		reportedProcessDetails: processes.details,
		processesReportEnabled: processes.reportEnabled,
	};
});

import {
	CACHE_TIMESERIES_MAX_BUCKETS,
	CACHE_TIMESERIES_MIN_BUCKETS,
	type CacheAnomalyRecord,
	type CacheEntryRecord,
	type CacheGroupLatencyRecord,
	type CacheStatsState,
} from '../../cache-events.js';
// Type-only, so the mock above still stands in for the module at runtime.
import type { UtilsService as GuardedUtils } from '../../services/utils.js';
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

beforeEach(() => {
	config.groups.mockReturnValue(['processes', 'cache']);
	processes.details.mockReturnValue(['stats', 'env']);
	processes.reportEnabled.mockReturnValue(true);
	service.constructed.length = 0;

	Object.values(service).forEach((value) => {
		if (typeof value === 'function' && 'mockReset' in value) {
			value.mockReset();
		}
	});
});

// The fields a tool definition carries — name, title, description,
// inputSchema, optional outputSchema and annotations.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool
test('Every tool is described well enough for a model to choose it', () => {
	expect(allSystemMcpTools().map((tool) => tool.name)).toEqual([
		'list_processes',
		'list_cache_entries',
		'read_cache_entry',
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

// The entries and latency listings aggregate every event in their window and so
// default shorter than the other reads; an agent picks its window off this text.
test('Each windowed read documents the default it actually takes', () => {
	const documented = new Map(
		allSystemMcpTools()
			.filter((tool) => 'window' in tool.inputSchema.properties)
			.map((tool) => {
				return [tool.name, tool.inputSchema.properties['window']!.description];
			}),
	);

	const defaultsTo24h = 'How far back to look, as a duration such as "15m", "6h" '
		+ 'or "7d". Defaults to 24h, and is clamped to what telemetry retention holds.';

	const defaultsTo10m = 'How far back to look, as a duration such as "15m", "6h" '
		+ 'or "7d". Defaults to 10m, and is clamped to what telemetry retention holds.';

	expect([...documented]).toEqual([
		['list_cache_entries', defaultsTo10m],
		['list_cache_anomalies', defaultsTo24h],
		['list_cache_latencies', defaultsTo10m],
		['read_cache_timeseries', defaultsTo24h],
	]);
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

test('A deployment that reports no processes offers no tool for them', () => {
	// `PROCESSES_REPORT_ENABLED` off takes every responder with it, so the read
	// behind this tool would wait out its window and answer an empty tree. The
	// REST route is absent in that deployment; the tool has to be too.
	processes.reportEnabled.mockReturnValue(false);

	expect(systemMcpTools().map((tool) => tool.name))
		.toEqual([
			'list_cache_entries',
			'read_cache_entry',
			'list_cache_anomalies',
			'list_cache_latencies',
			'read_cache_timeseries',
			'read_cache_stats_state',
		]);

	// Not merely unlisted: it cannot be called either.
	expect(findSystemMcpTool('list_processes')).toBeUndefined();

	// And the cache tools are untouched by it.
	expect(findSystemMcpTool('list_cache_entries')).toBeDefined();
});

// "Servers MUST: validate all tool inputs."
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#security-considerations
//
// Both arguments are handed over unread: `UtilsService` refuses a window or a
// bucket count it cannot take, so this tool and `GET /utils/cache/timeseries`
// judge the same value the same way rather than each keeping its own opinion of
// it. What the guards accept and refuse is tabled with them, in
// `services/utils.test.ts`; what this file owes is that nothing is lost, coerced
// or defaulted on the way there.
test.each([
	['a duration', '15m'],
	['one it cannot read', 'yesterday'],
	// Falsy and a valid parse, so a tool reading it as absent would answer the
	// default window instead.
	['zero', '0'],
	// `null` is what an agent sends for "no window in particular", and it is a
	// different thing from sending none at all.
	['null', null],
	['a boolean', true],
	['a list', []],
	['an object', {}],
	['empty', ''],
])('A window that is %s reaches the service as it was given', async (
	_case,
	window,
) => {
	await findSystemMcpTool('list_cache_entries')!.run({ window }, context);

	expect(service.getCacheEntries).toHaveBeenCalledWith(window);
});

test('The bucket count reaches the service as it was given', async () => {
	await findSystemMcpTool('read_cache_timeseries')!
		.run({ buckets: 'five' }, context);

	expect(service.getCacheTimeseries).toHaveBeenCalledWith(undefined, 'five');
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
		'cache',
	]);
});

test('An unknown name resolves to no tool', () => {
	expect(findSystemMcpTool('drop_everything')).toBeUndefined();
	expect(findSystemMcpTool(undefined)).toBeUndefined();
});

test('Every read is made as the caller, through the guarded service', async () => {
	service.readProcesses.mockResolvedValue({ services: [] });

	await findSystemMcpTool('list_processes')!.run({}, context);

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
	await findSystemMcpTool(tool)!.run({ window: '15m' }, context);
	expect(service[method]).toHaveBeenCalledWith('15m');

	// Absent stays absent rather than becoming a window of its own.
	await findSystemMcpTool(tool)!.run({}, context);
	expect(service[method]).toHaveBeenLastCalledWith(undefined);
});

test('The entry read reads the one key it was given', async () => {
	service.readCacheEntry.mockResolvedValue({ exists: true });

	// The REDIS key, which is the string the service reads Redis by. The
	// listing's `key` is the stats identity, and the two differ wherever
	// CACHE_KEY_HASH_ENABLED is off.
	await findSystemMcpTool('read_cache_entry')!
		.run({ redisKey: 'abcd' }, context);

	expect(service.readCacheEntry).toHaveBeenCalledWith('abcd');
});

// "Servers MUST provide structured results that conform to this schema", and
// this one deliberately does not name the payload.
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema
test('The entry read never answers with the response inside it', async () => {
	// The cache key carries the user, so a cached body is one person's
	// permission-filtered view. A tool answer is read by a model and travels
	// wherever that context travels, which is not where it belongs — the REST
	// endpoint still answers it to an administrator who asks for it.
	service.readCacheEntry.mockResolvedValue({
		exists: true,
		value: { data: [{ id: 1, email: 'ann@corp.io' }] },
		tags: ['collection:articles'],
		tagCounts: { 'collection:articles': 2 },
		expiry: { exp: 3, createdAt: 1, ttlMs: 60_000 },
		sizes: { uncompressed: 100, compressed: 40 },
		tombstone: null,
		filledAt: 1,
		purgesSinceFilled: [],
	});

	const answer = await findSystemMcpTool('read_cache_entry')!
		.run({ redisKey: 'abcd' }, context);

	expect(answer).toEqual({
		exists: true,
		tags: ['collection:articles'],
		tagCounts: { 'collection:articles': 2 },
		expiry: { exp: 3, createdAt: 1, ttlMs: 60_000 },
		sizes: { uncompressed: 100, compressed: 40 },
		tombstone: null,
		filledAt: 1,
		purgesSinceFilled: [],
	});

	// Not merely absent from the schema: absent from the answer, and from the
	// text block the answer is mirrored into.
	expect(JSON.stringify(answer)).not.toContain('ann@corp.io');

	const declared = findSystemMcpTool('read_cache_entry')!
		.outputSchema
		.properties;

	expect(declared).not.toHaveProperty('value');
});

// A tool "MAY declare which of its arguments are required".
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool
test.each([
	['absent', {}],
	['null', { redisKey: null }],
	['a number', { redisKey: 42 }],
	['empty', { redisKey: '' }],
	['blank', { redisKey: '   ' }],
	['under the listing\u2019s other name', { key: 'abcd' }],
])('The entry read refuses a key that is %s', async (_case, args) => {
	// The key names the one entry to read; without it there is nothing to read
	// rather than a default to fall back on.
	await expect(findSystemMcpTool('read_cache_entry')!.run(args, context))
		.rejects
		.toThrow(/redisKey/);

	expect(service.readCacheEntry).not.toHaveBeenCalled();
});

test('The entry read publishes its key as required', () => {
	const tool = findSystemMcpTool('read_cache_entry')!;

	expect(tool.inputSchema.properties).toHaveProperty('redisKey');
	expect(tool.inputSchema.required).toEqual(['redisKey']);

	// And not under the listing's other name, which reads the same and is a
	// different string wherever CACHE_KEY_HASH_ENABLED is off.
	expect(tool.inputSchema.properties).not.toHaveProperty('key');

	// It reads one named entry, so no window applies to it.
	expect(tool.inputSchema.properties).not.toHaveProperty('window');
});

test('The timeseries takes both the window and the bucket count', async () => {
	await findSystemMcpTool('read_cache_timeseries')!
		.run({ window: '1h', buckets: 12 }, context);

	expect(service.getCacheTimeseries).toHaveBeenCalledWith('1h', 12);

	await findSystemMcpTool('read_cache_timeseries')!.run({}, context);

	expect(service.getCacheTimeseries)
		.toHaveBeenLastCalledWith(undefined, undefined);
});

test('The timeseries declares the bounds the read clamps to', () => {
	// The inputSchema is what a client validates arguments against, so a bound the
	// read enforces and the schema omits is one the caller learns by surprise.
	const buckets = findSystemMcpTool('read_cache_timeseries')!
		.inputSchema
		.properties['buckets'];

	expect(buckets).toMatchObject({
		type: 'number',
		minimum: CACHE_TIMESERIES_MIN_BUCKETS,
		maximum: CACHE_TIMESERIES_MAX_BUCKETS,
	});
});

test('The telemetry state takes no argument', async () => {
	service.getCacheStatsState.mockResolvedValue({ enabled: true });

	await expect(findSystemMcpTool('read_cache_stats_state')!.run({}, context))
		.resolves
		.toEqual({ enabled: true });

	expect(service.getCacheStatsState).toHaveBeenCalledOnce();
});

// "Servers MUST provide structured results that conform to this schema."
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema
test('Every declared output property is one the tool actually answers', () => {
	/**
	 * The answers the services really give — typed as the services declare them,
	 * so the compiler maintains them. A field added to `CacheStatsState` or a
	 * metric added to `CACHE_LATENCY_METRICS` fails to compile here until it is
	 * recorded, which is what keeps the schemas honest as the types move.
	 *
	 * Nested rows are filled rather than left as empty arrays: an empty array
	 * type-checks against any element type, so it would track nothing.
	 */
	const answers: {
		list_processes: ProcessesReport;
		list_cache_entries: CacheEntryRecord[];
		// Everything the service answers except the cached response itself, which
		// this tool deliberately drops. A field added to the service lands here
		// and fails to compile until it is declared or explicitly omitted too.
		read_cache_entry: Omit<
			Awaited<ReturnType<GuardedUtils['readCacheEntry']>>,
			'value'
		>;
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
				purges: 0,
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
		read_cache_entry: {
			exists: true,
			tags: ['collection:articles'],
			tagCounts: { 'collection:articles': 2 },
			expiry: { exp: 3, createdAt: 1, ttlMs: 60_000 },
			sizes: { uncompressed: 100, compressed: 40 },
			tombstone: null,
			filledAt: 1,
			purgesSinceFilled: [
				{
					time: 4,
					mode: 'slices',
					collection: 'articles',
					scopedCacheTag: 'articles:id=5',
					evicted: 2,
				},
			],
		},
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
				response: { p50: 1, p95: 2, p99: 3 },
				miss: { p50: 1, p95: 2, p99: 3 },
				anomaly: { p50: 1, p95: 2, p99: 3 },
				fill: { p50: 1, p95: 2, p99: 3 },
				hit: { p50: 1, p95: 2, p99: 3 },
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
					purges: 0,
					coarsePurges: 0,
					purgedEntries: 0,
					purgeP50: null,
					purgeP95: null,
					purgeP99: null,
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
			budgetAlert: null,
			bufferLength: 0,
			droppedEvents: 0,
		},
	};

	for (const tool of allSystemMcpTools()) {
		const answer = answers[tool.name as keyof typeof answers];

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

test('The process tool describes the halves this deployment reports', () => {
	// The description is rebuilt on every listing, so it can name what is on.
	processes.details.mockReturnValue(['stats', 'env']);

	const both = systemMcpTools()
		.find((tool) => tool.name === 'list_processes')!
		.description;

	expect(both).toContain('what its supervisor observed');
	expect(both).toContain('the environment it resolved');

	// With a half turned off, the description stops promising it rather than
	// promising it and answering null.
	processes.details.mockReturnValue(['stats']);

	const statsOnly = systemMcpTools()
		.find((tool) => tool.name === 'list_processes')!
		.description;

	expect(statsOnly).toContain('what its supervisor observed');
	expect(statsOnly).not.toContain('the environment it resolved');

	processes.details.mockReturnValue(['env']);

	const envOnly = systemMcpTools()
		.find((tool) => tool.name === 'list_processes')!
		.description;

	expect(envOnly).toContain('the environment it resolved');
	expect(envOnly).not.toContain('what its supervisor observed');

	processes.details.mockReturnValue([]);

	const neither = systemMcpTools()
		.find((tool) => tool.name === 'list_processes')!
		.description;

	expect(neither).toContain('Only the identity of each process is reported');
});
