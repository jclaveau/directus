import { requestedWindowMs } from '../../utils/requested-window-ms.js';
import { UtilsService } from '../../services/utils.js';
import type { McpTool, McpToolContext } from '../types/tool.js';
import { systemMcpToolGroups } from './mcp-config.js';
import { reportedProcessDetails } from '../../processes/lib/processes-config.js';

/**
 * Every tool reads through `UtilsService`, so the admin guard each of these
 * surfaces already carries is the one that runs — this exposes no read the REST
 * API would have refused.
 */
function utils(context: McpToolContext): UtilsService {
	return new UtilsService({
		accountability: context.accountability,
		schema: context.schema,
	});
}

/**
 * What the process tree actually carries here. `PROCESSES_REPORT_DETAILS` can
 * drop either half, so the description states what this deployment reports
 * rather than promising both and answering `null`.
 */
function processesDescription(): string {
	const details = reportedProcessDetails();

	const halves = [
		details.includes('stats')
			? 'what its supervisor observed (status, restarts, memory against the '
				+ 'cap it is recycled at, uptime, exec mode)'
			: null,
		details.includes('env')
			? 'the environment it resolved, redacted, with the layer each value '
				+ 'came from'
			: null,
	].filter((half) => half !== null);

	const carries = halves.length === 0
		? 'Only the identity of each process is reported: this deployment turned '
			+ 'both halves off.'
		: `Each process reports ${halves.join(', and ')}.`;

	return 'The running processes of this deployment as a service → replica → '
		+ `process tree. ${carries} Use it to explain restart loops, memory `
		+ 'pressure, or why two replicas behave differently.';
}

/** What a windowed listing answers: the rows, under a name. */
const LIST_OUTPUT = {
	type: 'object',
	properties: {
		items: {
			type: 'array',
			description: 'The rows, in the order the API answered them.',
			items: { type: 'object' },
		},
	},
} as const;

/**
 * Every tool here reads and nothing more, which is what lets a client call one
 * without asking the user to approve it first.
 */
const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
} as const;

/** The lookback every cache read takes, described once. */
const windowProperty = {
	window: {
		type: 'string',
		description:
			'How far back to look, as a duration such as "15m", "6h" or "7d". '
			+ 'Defaults to 24h, and is clamped to what telemetry retention holds.',
	},
};

/**
 * Every tool compiled in, built fresh: a description reads config, and config
 * outlives no request. Nothing here is evaluated at import time.
 */
export function allSystemMcpTools(): McpTool[] {
	return [
	{
		name: 'list_processes',
		group: 'processes',
		title: 'List running processes',
		description: processesDescription(),
		inputSchema: { type: 'object', properties: {} },
		outputSchema: {
			type: 'object',
			properties: {
				collectedAt: { type: 'number' },
				collectedForMs: { type: 'number' },
				details: {
					type: 'array',
					description: 'Which halves each process reported: stats, env, or both.',
					items: { type: 'string' },
				},
				services: {
					type: 'array',
					description: 'One entry per service, each holding its replicas.',
					items: { type: 'object' },
				},
				degraded: {
					type: 'object',
					description: 'What could not be answered, rather than a silent gap.',
				},
			},
		},
		annotations: READ_ONLY,
		run: async (_args, context) => utils(context).readProcesses(),
	},
	{
		name: 'list_cache_entries',
		group: 'cache',
		title: 'List cache entries',
		description:
			'The response-cache entries seen in the window, grouped by endpoint and '
			+ 'query, with hit counts, size, age and remaining TTL. Use it to find '
			+ 'what is filling the cache and what is never read back.',
		inputSchema: { type: 'object', properties: windowProperty },
		outputSchema: LIST_OUTPUT,
		annotations: READ_ONLY,
		run: async (args, context) => {
			return utils(context).getCacheEntries(requestedWindowMs(args['window']));
		},
	},
	{
		name: 'list_cache_anomalies',
		group: 'cache',
		title: 'List cache anomalies',
		description:
			'Responses the cache declined to keep in the window, and why — a value '
			+ 'over the size cap, a read with no collection to purge it by, a scope '
			+ 'too coarse to pin. Use it to explain a low hit ratio.',
		inputSchema: { type: 'object', properties: windowProperty },
		outputSchema: LIST_OUTPUT,
		annotations: READ_ONLY,
		run: async (args, context) => {
			return utils(context).getCacheAnomalies(requestedWindowMs(args['window']));
		},
	},
	{
		name: 'list_cache_latencies',
		group: 'cache',
		title: 'List cache latencies',
		description:
			'Response-time percentiles per endpoint group in the window, split by '
			+ 'outcome (served from cache, filled, declined). Use it to say what the '
			+ 'cache is actually saving.',
		inputSchema: { type: 'object', properties: windowProperty },
		outputSchema: LIST_OUTPUT,
		annotations: READ_ONLY,
		run: async (args, context) => {
			const window = requestedWindowMs(args['window']);

			return utils(context).getCacheGroupLatencies(window);
		},
	},
	{
		name: 'read_cache_timeseries',
		group: 'cache',
		title: 'Read the cache timeseries',
		description:
			'Hits, misses, fills, anomalies, TTL in force and latency percentiles '
			+ 'bucketed over the window, plus the config changes and flushes that '
			+ 'fall in it. Use it to correlate a change with what followed.',
		inputSchema: {
			type: 'object',
			properties: {
				...windowProperty,
				buckets: {
					type: 'number',
					description: 'How many buckets to split the window into.',
				},
			},
		},
		outputSchema: {
			type: 'object',
			properties: {
				buckets: { type: 'array', items: { type: 'object' } },
				markers: {
					type: 'array',
					description: 'Config changes and flushes falling in the window.',
					items: { type: 'object' },
				},
				effectiveTtl: {
					type: ['string', 'null'],
					description: 'The TTL in force over the window, where one is known.',
				},
			},
		},
		annotations: READ_ONLY,
		run: async (args, context) => {
			const buckets = args['buckets'] === undefined
				? undefined
				: Number(args['buckets']);

			return utils(context).getCacheTimeseries(
				requestedWindowMs(args['window']),
				buckets,
			);
		},
	},
	{
		name: 'read_cache_stats_state',
		group: 'cache',
		title: 'Read the cache telemetry state',
		description:
			'Whether cache telemetry is being collected, and what stopped it if it '
			+ 'was disabled automatically. Read this first when the other cache '
			+ 'tools come back empty.',
		inputSchema: { type: 'object', properties: {} },
		outputSchema: {
			type: 'object',
			properties: {
				configured: { type: 'boolean' },
				enabled: { type: 'boolean' },
				killedReason: {
					type: ['string', 'null'],
					description: 'What stopped collection, where it stopped by itself.',
				},
				bufferLength: { type: 'number' },
				droppedEvents: {
					type: 'number',
					description: 'Lifetime count; non-zero means telemetry went lossy.',
				},
			},
		},
		annotations: READ_ONLY,
		run: async (_args, context) => utils(context).getCacheStatsState(),
	},
	];
}

/**
 * The tools this deployment exposes. A tool whose group is not exposed is not
 * listed and, because lookups go through here, cannot be called either.
 */
export function systemMcpTools(): McpTool[] {
	const groups = systemMcpToolGroups();

	return allSystemMcpTools().filter((tool) => groups.includes(tool.group));
}

export function findSystemMcpTool(name: unknown): McpTool | undefined {
	return systemMcpTools().find((tool) => tool.name === name);
}
