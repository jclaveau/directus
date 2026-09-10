import type {
	AutoscaleRunner,
	CacheTimeseries,
	ProcessesReport,
	SchemaOverview,
} from '@directus/types';
import { beforeEach, expect, test, vi } from 'vitest';

const service = vi.hoisted(() => {
	return {
		readProcesses: vi.fn(),
		readAutoscaleConfig: vi.fn(),
		readAutoscaleRunners: vi.fn(),
		updateAutoscaleConfig: vi.fn(),
		clearAutoscaleConfig: vi.fn(),
		updateSupervisorConfig: vi.fn(),
		startAutoscaleReload: vi.fn(),
		readAutoscaleDrill: vi.fn(),
		startAutoscaleDrill: vi.fn(),
		stopAutoscaleDrill: vi.fn(),
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
			readAutoscaleConfig = service.readAutoscaleConfig;
			readAutoscaleRunners = service.readAutoscaleRunners;
			updateAutoscaleConfig = service.updateAutoscaleConfig;
			clearAutoscaleConfig = service.clearAutoscaleConfig;
			updateSupervisorConfig = service.updateSupervisorConfig;
			startAutoscaleReload = service.startAutoscaleReload;
			readAutoscaleDrill = service.readAutoscaleDrill;
			startAutoscaleDrill = service.startAutoscaleDrill;
			stopAutoscaleDrill = service.stopAutoscaleDrill;
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

const redis = vi.hoisted(() => {
	return { available: vi.fn() };
});

vi.mock('../../redis/index.js', async (importOriginal) => {
	return {
		...await importOriginal<object>(),
		redisConfigAvailable: redis.available,
	};
});

const drill = vi.hoisted(() => {
	return { enabled: vi.fn() };
});

// Spread rather than replaced: the drill's bounds are read here to build the
// tool's own description, and a mock that dropped them would advertise
// `undefined-undefined` while every assertion still passed.
vi.mock('../../processes/autoscale/lib/drill.js', async (importOriginal) => {
	return {
		...await importOriginal<object>(),
		autoscaleDrillEnabled: drill.enabled,
	};
});

const processes = vi.hoisted(() => {
	return { details: vi.fn(), reportEnabled: vi.fn(), requested: vi.fn() };
});

vi.mock('../../processes/lib/processes-config.js', () => {
	return {
		reportedProcessDetails: processes.details,
		processesReportEnabled: processes.reportEnabled,
		requestedProcessDetails: processes.requested,
	};
});

import {
	MAX_DRILL_PERCENT,
	MAX_DRILL_SECONDS,
	MIN_DRILL_PERCENT,
} from '../../processes/autoscale/lib/drill.js';
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
	config.groups.mockReturnValue([
		'processes',
		'autoscale',
		'autoscale_drill',
		'cache',
	]);

	redis.available.mockReturnValue(true);
	drill.enabled.mockReturnValue(true);
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
		'read_autoscale_config',
		'write_autoscale_config',
		'write_supervisor_config',
		'restart_autoscale_pool',
		'read_autoscale_drill',
		'run_autoscale_drill',
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

		// Nothing here reaches outside this deployment, whether it reads, writes
		// or restarts.
		expect(tool.annotations.openWorldHint).toBe(false);
	}
});

// A client runs a read without asking and puts a write in front of the user
// first, so every tool that changes how the deployment runs has to say so.
test('Only the reads declare themselves reads', () => {
	const writes = allSystemMcpTools()
		.filter((tool) => tool.annotations.readOnlyHint === false)
		.map((tool) => tool.name);

	expect(writes).toEqual([
		'write_autoscale_config',
		'write_supervisor_config',
		'restart_autoscale_pool',
		'run_autoscale_drill',
	]);
});

// Storing a value is reversible by storing another, and the same patch written
// twice leaves the same shared settings behind. Holding real workers on the
// processor is neither: a second call is a second restart, and a second drill.
test('Only what disturbs serving workers is called destructive', () => {
	const disturbing = allSystemMcpTools()
		.filter((tool) => tool.annotations.destructiveHint)
		.map((tool) => tool.name);

	expect(disturbing).toEqual([
		'restart_autoscale_pool',
		'run_autoscale_drill',
	]);

	expect(findSystemMcpTool('restart_autoscale_pool')!.annotations).toEqual({
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	});

	// The supervisor options are stored and nothing more: what carries them to
	// the pool is the restart above, which is the tool that says so.
	expect(findSystemMcpTool('write_supervisor_config')!.annotations).toEqual({
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	});
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
			'read_autoscale_config',
			'write_autoscale_config',
			'write_supervisor_config',
			'restart_autoscale_pool',
			'read_autoscale_drill',
			'run_autoscale_drill',
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
		'autoscale',
		'autoscale',
		'autoscale',
		'autoscale',
		'autoscale_drill',
		'autoscale_drill',
		'cache',
		'cache',
		'cache',
		'cache',
		'cache',
		'cache',
	]);
});

// The shared settings live in Redis, and a tool that could only ever fail is worse
// than one a model never sees.
test('A deployment without Redis offers no autoscale tools', () => {
	redis.available.mockReturnValue(false);

	expect(systemMcpTools().map((tool) => tool.name))
		.not.toContain('write_autoscale_config');

	expect(findSystemMcpTool('read_autoscale_config')).toBeUndefined();
});

// The drill loads a production pool on purpose, so a deployment that never
// asked for the lever must not be handed it by naming the group alone.
test('A deployment that did not ask for the drill offers no drill', () => {
	drill.enabled.mockReturnValue(false);

	expect(systemMcpTools().map((tool) => tool.name))
		.not.toContain('run_autoscale_drill');

	expect(findSystemMcpTool('read_autoscale_drill')).toBeUndefined();

	// And the configuration levers beside it are untouched: the drill is its
	// own group so that one can be opened without the other.
	expect(findSystemMcpTool('write_autoscale_config')).toBeDefined();
});

// It reaches the workers over the bus, which without Redis is an emitter this
// worker shares with nobody — the same reason the REST route is absent there.
test('A deployment without Redis offers no drill either', () => {
	redis.available.mockReturnValue(false);

	expect(findSystemMcpTool('run_autoscale_drill')).toBeUndefined();
});

// Naming one group must not carry the other in with it, in either direction:
// an agent given the drill has no way to change what the pool scales on.
test('The two autoscale groups are opened separately', () => {
	config.groups.mockReturnValue(['autoscale_drill']);

	expect(systemMcpTools().map((tool) => tool.name)).toEqual([
		'read_autoscale_drill',
		'run_autoscale_drill',
	]);

	config.groups.mockReturnValue(['autoscale']);

	expect(systemMcpTools().map((tool) => tool.name)).toEqual([
		'read_autoscale_config',
		'write_autoscale_config',
		'write_supervisor_config',
		'restart_autoscale_pool',
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

test('The configuration write sends the note down with the patch', async () => {
	service.updateAutoscaleConfig
		.mockResolvedValue({ key: 'k', sharedSettings: {}, setByEmail: null });

	await findSystemMcpTool('write_autoscale_config')!.run(
		{ config: { maxWorkers: 8 }, note: 'spike on the planner' },
		context,
	);

	// Named as an MCP write, which is what tells shared settings an agent left from
	// one a person typed into the admin.
	expect(service.updateAutoscaleConfig).toHaveBeenCalledWith(
		{ maxWorkers: 8, note: 'spike on the planner' },
		'mcp',
	);
});

test('the configuration write drops the whole shared settings', async () => {
	service.readAutoscaleConfig
		.mockResolvedValue({ key: 'k', sharedSettings: null, setByEmail: null });

	await findSystemMcpTool('write_autoscale_config')!
		.run({ clear: true, note: 'incident over' }, context);

	expect(service.clearAutoscaleConfig).toHaveBeenCalledOnce();
	expect(service.updateAutoscaleConfig).not.toHaveBeenCalled();
});

// A model that sends the fields at the top level instead of under `config` gets
// told so, rather than having a note stored and nothing else.
test('The configuration write refuses a patch that is not an object', async () => {
	await expect(
		findSystemMcpTool('write_autoscale_config')!
			.run({ config: 'maxWorkers=8', note: 'why' }, context),
	).rejects.toThrowError('`config` has to be an object of configuration fields');
});

test('The supervisor write sends the note down with the options', async () => {
	service.updateSupervisorConfig
		.mockResolvedValue({ key: 'k', sharedSettings: {}, setByEmail: null });

	await findSystemMcpTool('write_supervisor_config')!.run(
		{ supervisor: { listenTimeout: 21_000 }, note: 'boot got slower' },
		context,
	);

	expect(service.updateSupervisorConfig).toHaveBeenCalledWith(
		{ listenTimeout: 21_000, note: 'boot got slower' },
		'mcp',
	);
});

// The same mistake the configuration write refuses, and for the same reason: a
// model that sends the options at the top level would otherwise store a note
// and nothing else.
test('The supervisor write refuses options that are not an object', async () => {
	await expect(
		findSystemMcpTool('write_supervisor_config')!
			.run({ supervisor: 'listenTimeout=21000', note: 'why' }, context),
	).rejects.toThrowError('`supervisor` has to be an object of pm2 options');

	expect(service.updateSupervisorConfig).not.toHaveBeenCalled();
});

// It takes no arguments at all: what a restart may do is decided by the state
// of the pool, which the service reads, and never by what the caller passed.
test('The restart asks the service and hands it nothing', async () => {
	service.startAutoscaleReload.mockResolvedValue({
		askedAt: 1,
		running: true,
		finishedAt: null,
		error: null,
	});

	const answer = await findSystemMcpTool('restart_autoscale_pool')!
		.run({ appName: 'something-else' }, context);

	expect(service.startAutoscaleReload).toHaveBeenCalledWith();
	expect(answer).toMatchObject({ running: true });
});

test('The drill hands both bounds to the service as they were given', async () => {
	service.startAutoscaleDrill.mockResolvedValue({ until: 2, percent: 20 });

	await findSystemMcpTool('run_autoscale_drill')!
		.run({ seconds: 30, percent: 20 }, context);

	// Unread on the way through, so this tool and `POST /utils/autoscale/drill`
	// judge the same value the same way rather than each keeping an opinion of
	// it. A drill an agent asks 600 seconds for is refused, not shortened.
	expect(service.startAutoscaleDrill).toHaveBeenCalledWith(30, 20);
});

test('The drill leaves a missing bound missing', async () => {
	service.startAutoscaleDrill.mockResolvedValue({ until: null, percent: 10 });

	await findSystemMcpTool('run_autoscale_drill')!.run({}, context);

	expect(service.startAutoscaleDrill).toHaveBeenCalledWith(undefined, undefined);
});

test('The drill is called off rather than started when asked to stop', async () => {
	service.stopAutoscaleDrill.mockResolvedValue({ until: null, percent: 20 });

	await findSystemMcpTool('run_autoscale_drill')!
		.run({ stop: true, seconds: 30, percent: 20 }, context);

	expect(service.stopAutoscaleDrill).toHaveBeenCalledOnce();
	expect(service.startAutoscaleDrill).not.toHaveBeenCalled();
});

// The bounds are the service's, and a description naming different ones sends
// an agent to a refusal it was told to expect to work.
test('The drill advertises the bounds the service enforces', () => {
	const properties = findSystemMcpTool('run_autoscale_drill')!
		.inputSchema
		.properties;

	expect(properties['seconds']!.description)
		.toContain(`1-${MAX_DRILL_SECONDS}`);

	expect(properties['percent']!.description)
		.toContain(`${MIN_DRILL_PERCENT}-${MAX_DRILL_PERCENT}`);
});

test('The configuration read asks the running processes by default', async () => {
	service.readAutoscaleConfig
		.mockResolvedValue({ key: 'k', sharedSettings: null, setByEmail: null });

	service.readAutoscaleRunners.mockResolvedValue([]);

	await findSystemMcpTool('read_autoscale_config')!.run({}, context);
	expect(service.readAutoscaleRunners).toHaveBeenCalledOnce();

	// Asking them costs about a second, so a caller that only wants the stored
	// shared settings can say so.
	await findSystemMcpTool('read_autoscale_config')!.run({ live: false }, context);
	expect(service.readAutoscaleRunners).toHaveBeenCalledOnce();
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
		read_autoscale_config:
			Awaited<ReturnType<GuardedUtils['readAutoscaleConfig']>>
			& { running: AutoscaleRunner[] };
		write_autoscale_config:
			Awaited<ReturnType<GuardedUtils['updateAutoscaleConfig']>>;
		write_supervisor_config:
			Awaited<ReturnType<GuardedUtils['updateSupervisorConfig']>>;
		restart_autoscale_pool:
			Awaited<ReturnType<GuardedUtils['startAutoscaleReload']>>;
		read_autoscale_drill:
			Awaited<ReturnType<GuardedUtils['readAutoscaleDrill']>>;
		run_autoscale_drill:
			Awaited<ReturnType<GuardedUtils['startAutoscaleDrill']>>;
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
		read_autoscale_config: {
			key: 'scalabus:config:processes:autoscale',
			sharedSettings: {
				maxWorkers: 8,
				setBy: 'jean',
				setAt: '2026-09-09T00:00:00Z',
				setFrom: 'mcp',
			},
			setByEmail: 'jean@example.com',
			supervisor: {
				key: 'scalabus:config:processes:supervisor',
				sharedSettings: { listenTimeout: 20_000 },
				setByEmail: 'jean@example.com',
			},
			running: [
				{
					service: 'api',
					replicaId: 'replica-a',
					nodeId: 'node-1',
					name: 'autoscale',
					state: {
						at: 1_700_000_000_000,
						config: {
						enabled: true,
						strategy: 'scalabus',
						appName: 'api',
						signal: 'average',
						sampleWindow: 5,
						scaleCpuThreshold: 60,
						releaseCpuThreshold: 40,
						minWorkers: 1,
						maxWorkers: 4,
						prewarmWorkers: 0,
						minSecondsToScaleUp: 10,
						minSecondsToScaleDown: 300,
						warmupSeconds: 30,
					},
						withoutSharedSettings: {
						enabled: true,
						strategy: 'scalabus',
						appName: 'api',
						signal: 'average',
						sampleWindow: 5,
						scaleCpuThreshold: 60,
						releaseCpuThreshold: 40,
						minWorkers: 1,
						maxWorkers: 2,
						prewarmWorkers: 0,
						minSecondsToScaleUp: 10,
						minSecondsToScaleDown: 300,
						warmupSeconds: 30,
					},
						sources: {
						enabled: 'default',
						strategy: 'default',
						appName: 'env',
						signal: 'default',
						sampleWindow: 'default',
						scaleCpuThreshold: 'default',
						releaseCpuThreshold: 'default',
						minWorkers: 'env',
						maxWorkers: 'sharedSettings',
						prewarmWorkers: 'default',
						minSecondsToScaleUp: 'default',
						minSecondsToScaleDown: 'default',
						warmupSeconds: 'default',
					},
						workers: 2,
						pendingWorkers: 0,
						warmingWorkers: 0,
						reload: {
							askedAt: null,
							running: false,
							finishedAt: null,
							error: null,
						},
						supervisor: null,
						cpuPercents: [20, 24],
						lastDecision: { at: 1, workers: null, reason: 'within the band' },
						lastScale: { at: 1, workers: 2, reason: 'average cpu 70% is high' },
					},
				},
			],
		},
		write_autoscale_config: {
			key: 'scalabus:config:processes:autoscale',
			sharedSettings: { maxWorkers: 8 },
			setByEmail: 'jean@example.com',
			supervisor: {
				key: 'scalabus:config:processes:supervisor',
				sharedSettings: null,
				setByEmail: null,
			},
		},
		write_supervisor_config: {
			key: 'scalabus:config:processes:supervisor',
			sharedSettings: { listenTimeout: 21_000 },
			setByEmail: 'jean@example.com',
		},
		restart_autoscale_pool: {
			askedAt: 1_700_000_000_000,
			running: true,
			finishedAt: null,
			error: null,
		},
		read_autoscale_drill: { until: null, percent: 10 },
		run_autoscale_drill: { until: 1_700_000_000_000, percent: 20 },
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
							capacity: { memoryBytes: 2_147_483_648, cpuCores: 2 },
							supervisor: 'pm2',
							processes: [
								{
									nodeId: 'node-1',
									pid: 100,
									pmId: 0,
									name: 'directus',
									instance: 0,
									responding: true,
									autoscale: null,
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

test('list_processes passes the halves asked for down to the service', async () => {
	service.readProcesses.mockResolvedValue({ services: [] });
	processes.requested.mockReturnValue(['stats']);

	await findSystemMcpTool('list_processes')!.run({ details: ['stats'] }, context);

	// Through the narrowing parser, never straight from the arguments: an agent
	// must not be able to ask for a half the deployment does not report.
	expect(processes.requested).toHaveBeenCalledWith(['stats']);
	expect(service.readProcesses).toHaveBeenCalledWith(['stats']);
});

test('list_processes with no argument still asks the parser', async () => {
	service.readProcesses.mockResolvedValue({ services: [] });
	processes.requested.mockReturnValue(['stats', 'env']);

	await findSystemMcpTool('list_processes')!.run({}, context);

	expect(processes.requested).toHaveBeenCalledWith(undefined);
	expect(service.readProcesses).toHaveBeenCalledWith(['stats', 'env']);
});

// A deployment reporting one half advertising both invites a call that answers
// with strictly less than asking for nothing at all, and says nothing about why.
test('list_processes advertises only the halves this node reports', () => {
	processes.details.mockReturnValue(['stats']);

	const details = findSystemMcpTool('list_processes')!
		.inputSchema
		.properties['details'];

	expect(details?.['items']).toEqual({ type: 'string', enum: ['stats'] });
});

test('list_processes advertises the halves as an enum, not free text', () => {
	const details = findSystemMcpTool('list_processes')!
		.inputSchema
		.properties['details'];

	// An enum, so a model cannot invent a third half and have it silently ignored.
	expect(details?.['items']).toEqual({ type: 'string', enum: ['stats', 'env'] });
});
