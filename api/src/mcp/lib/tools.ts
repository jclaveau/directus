import { requestedWindowMs } from '../../utils/requested-window-ms.js';
import { UtilsService } from '../../services/utils.js';
import type { McpTool, McpToolContext } from '../types/tool.js';

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

/** The lookback every cache read takes, described once. */
const windowProperty = {
	window: {
		type: 'string',
		description:
			'How far back to look, as a duration such as "15m", "6h" or "7d". '
			+ 'Defaults to 24h, and is clamped to what telemetry retention holds.',
	},
};

export const MCP_TOOLS: McpTool[] = [
	{
		name: 'list_processes',
		title: 'List running processes',
		description:
			'The running processes of this deployment as a service → replica → '
			+ 'process tree. Each process reports what its supervisor observed '
			+ '(status, restarts, memory against the cap it is recycled at, uptime, '
			+ 'exec mode) and the environment it resolved, redacted, with the layer '
			+ 'each value came from. Use it to explain restart loops, memory '
			+ 'pressure, or why two replicas behave differently.',
		inputSchema: { type: 'object', properties: {} },
		run: async (_args, context) => utils(context).readProcesses(),
	},
	{
		name: 'list_cache_entries',
		title: 'List cache entries',
		description:
			'The response-cache entries seen in the window, grouped by endpoint and '
			+ 'query, with hit counts, size, age and remaining TTL. Use it to find '
			+ 'what is filling the cache and what is never read back.',
		inputSchema: { type: 'object', properties: windowProperty },
		run: async (args, context) => {
			return utils(context).getCacheEntries(requestedWindowMs(args['window']));
		},
	},
	{
		name: 'list_cache_anomalies',
		title: 'List cache anomalies',
		description:
			'Responses the cache declined to keep in the window, and why — a value '
			+ 'over the size cap, a read with no collection to purge it by, a scope '
			+ 'too coarse to pin. Use it to explain a low hit ratio.',
		inputSchema: { type: 'object', properties: windowProperty },
		run: async (args, context) => {
			return utils(context).getCacheAnomalies(requestedWindowMs(args['window']));
		},
	},
	{
		name: 'list_cache_latencies',
		title: 'List cache latencies',
		description:
			'Response-time percentiles per endpoint group in the window, split by '
			+ 'outcome (served from cache, filled, declined). Use it to say what the '
			+ 'cache is actually saving.',
		inputSchema: { type: 'object', properties: windowProperty },
		run: async (args, context) => {
			const window = requestedWindowMs(args['window']);

			return utils(context).getCacheGroupLatencies(window);
		},
	},
	{
		name: 'read_cache_timeseries',
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
		title: 'Read the cache telemetry state',
		description:
			'Whether cache telemetry is being collected, and what stopped it if it '
			+ 'was disabled automatically. Read this first when the other cache '
			+ 'tools come back empty.',
		inputSchema: { type: 'object', properties: {} },
		run: async (_args, context) => utils(context).getCacheStatsState(),
	},
];

export function findMcpTool(name: unknown): McpTool | undefined {
	return MCP_TOOLS.find((tool) => tool.name === name);
}
