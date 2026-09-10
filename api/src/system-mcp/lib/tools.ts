import { InvalidPayloadError } from '@directus/errors';
import {
	CACHE_TIMESERIES_MAX_BUCKETS,
	CACHE_TIMESERIES_MIN_BUCKETS,
} from '../../cache-events.js';
import {
	autoscaleDrillEnabled,
	MAX_DRILL_PERCENT,
	MAX_DRILL_SECONDS,
	MIN_DRILL_PERCENT,
} from '../../processes/autoscale/lib/drill.js';
import { redisConfigAvailable } from '../../redis/index.js';
import { UtilsService } from '../../services/utils.js';
import {
	defineSystemMcpTool,
	type SystemMcpTool,
	type SystemMcpToolContext,
} from '../types/tool.js';
import { systemMcpToolGroups } from './config.js';
import {
	processesReportEnabled,
	reportedProcessDetails,
	requestedProcessDetails,
} from '../../processes/lib/processes-config.js';

/**
 * Every tool reads through `UtilsService`, so the admin guard each of these
 * surfaces already carries is the one that runs — this exposes no read the REST
 * API would have refused.
 */
function utils(context: SystemMcpToolContext): UtilsService {
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
 * A tool that reads and nothing more, which is what lets a client call one
 * without asking the user to approve it first.
 */
const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
} as const;

/**
 * A tool that changes how this deployment runs.
 *
 * Not destructive — it stores values, and each of them is reversible by storing
 * another — but a client is expected to put the call in front of the user
 * before making it, which is what `readOnlyHint: false` buys. Idempotent: the
 * same patch written twice leaves the same shared settings.
 */
const CHANGES_CONFIG = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

/**
 * A tool that disturbs the workers currently serving.
 *
 * The pool comes back either way — a roll starts each replacement before it
 * retires the worker it replaces, and a drill runs out on a deadline the
 * worker holds — but both spend a live deployment to do it, and neither
 * leaves it where it found it: a second call is a second restart, and a
 * second drill.
 */
const DISTURBS_POOL = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
} as const;

/** The lookback a cache read takes, described once for every default. */
function windowProperty(fallbackWindow: string) {
	return {
		window: {
			type: 'string',
			description:
				'How far back to look, as a duration such as "15m", "6h" or "7d". '
				+ `Defaults to ${fallbackWindow}, and is clamped to what telemetry `
				+ 'retention holds.',
		},
	};
}

/**
 * Every tool compiled in, built fresh: a description reads config, and config
 * outlives no request. Nothing here is evaluated at import time.
 */
export function allSystemMcpTools(): SystemMcpTool[] {
	return [
		defineSystemMcpTool({
			name: 'list_processes',
			group: 'processes',
			title: 'List running processes',
			description: processesDescription(),
			inputSchema: {
				type: 'object',
				properties: {
					details: {
						type: 'array',
						description: 'Which halves to report: "stats", "env", or both.'
							+ ' Defaults to everything this deployment reports. Asking for'
							+ ' "stats" alone leaves out the resolved environment, which is'
							+ ' most of the answer by size and is worth reading only when'
							+ ' comparing configuration between replicas.',
						// The halves this deployment reports, not both by rote: an enum
						// naming one it does not would invite a call that answers with
						// strictly less than asking for nothing at all.
						items: { type: 'string', enum: reportedProcessDetails() },
					},
				},
			},
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
			run: async (args, context) => {
				// The deployment's own list still bounds this: a node configured
				// without env never reports env, however it was asked.
				const details = requestedProcessDetails(args['details']);

				return utils(context).readProcesses(details);
			},
		}),
		defineSystemMcpTool({
			name: 'read_autoscale_config',
			group: 'autoscale',
			title: 'Read the autoscale configuration',
			description:
				'What every process scaling a PM2 pool is running on: the values it '
				+ 'resolved, which layer supplied each one, the pool it last read and '
				+ 'the last decision it took — plus the live shared settings those values '
				+ 'resolved through. Use it before changing anything, and to explain a '
				+ 'pool that is not the size it should be.',
			inputSchema: {
				type: 'object',
				properties: {
					live: {
						type: 'boolean',
						description: 'Whether to ask the running processes what they are '
							+ 'scaling on, which takes about a second. False answers with '
							+ 'the stored shared settings alone.',
					},
				},
			},
			outputSchema: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: 'The settings column the shared settings are stored in.',
					},
					sharedSettings: {
						type: 'object',
						description: 'The fields the shared settings set, or null for none. '
							+ 'Carries `setBy`, `setAt`, `setFrom` and `note` beside them.',
					},
					setByEmail: {
						type: 'string',
						description: 'The address behind `setBy`, or null for none.',
					},
					supervisor: {
						type: 'object',
						description: 'The pm2 options stored for the next rolling '
							+ 'restart, under `key`, `sharedSettings` and `setByEmail` of '
							+ 'their own. They reach the pool through a restart rather '
							+ 'than on a tick.',
					},
					running: {
						type: 'array',
						description: 'One entry per process that is scaling a pool.',
						items: { type: 'object' },
					},
				},
			},
			annotations: READ_ONLY,
			run: async (args, context) => {
				const service = utils(context);
				const stored = await service.readAutoscaleConfig();

				return {
					...stored,
					running: args['live'] === false
						? []
						: await service.readAutoscaleRunners(),
				};
			},
		}),
		defineSystemMcpTool({
			name: 'write_autoscale_config',
			group: 'autoscale',
			title: 'Change the autoscale configuration',
			description:
				'Lay fields over the live autoscale configuration, which every '
				+ 'process scaling a pool in this cache namespace picks up within a '
				+ 'second — no redeploy, and no restart of the pool being tuned. '
				+ 'Pass a field as null to give it back to the environment chain, and '
				+ '`clear: true` to drop the shared settings entirely. Bounds are corrected '
				+ 'by the loop rather than refused here, so read the configuration '
				+ 'back to see what it is actually running on.',
			inputSchema: {
				type: 'object',
				properties: {
					config: {
						type: 'object',
						description: 'The fields to set: enabled, strategy, appName, '
							+ 'signal, sampleWindow, scaleCpuThreshold, '
							+ 'releaseCpuThreshold, minWorkers, maxWorkers, '
							+ 'prewarmWorkers, minSecondsToScaleUp, '
							+ 'minSecondsToScaleDown, warmupSeconds. A null value clears '
							+ 'that field. Setting minWorkers and maxWorkers to the same '
							+ 'number pins the pool at it whatever the load reads.',
					},
					note: {
						type: 'string',
						description: 'Why this is being changed, stored with the '
							+ 'sharedSettings. Shared settings outlive the incident that '
							+ 'justified them, and this is what says which one that was.',
					},
					clear: {
						type: 'boolean',
						description: 'Drop the whole shared settings, so every field comes '
							+ 'the environment chain again.',
					},
				},
				required: ['note'],
			},
			outputSchema: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: 'The settings column the shared settings are stored in.',
					},
					sharedSettings: {
						type: 'object',
						description: 'The shared settings as they now stand, or null for none. '
							+ 'This write stamps it `setFrom: "mcp"`.',
					},
					setByEmail: {
						type: 'string',
						description: 'The address behind `setBy`, or null for none.',
					},
					supervisor: {
						type: 'object',
						description: 'The pm2 options stored for the next rolling '
							+ 'restart, answered here because they are read back with '
							+ 'the configuration. This tool does not change them.',
					},
				},
			},
			annotations: CHANGES_CONFIG,
			run: async (args, context) => {
				const service = utils(context);

				if (args['clear'] === true) {
					await service.clearAutoscaleConfig();

					return service.readAutoscaleConfig();
				}

				const config = args['config'];

				if (typeof config !== 'object' || config === null || Array.isArray(config)) {
					throw new InvalidPayloadError({
						reason: '`config` has to be an object of configuration fields',
					});
				}

				return service.updateAutoscaleConfig(
					{
						...config as Record<string, unknown>,
						note: args['note'],
					},
					'mcp',
				);
			},
		}),
		defineSystemMcpTool({
			name: 'write_supervisor_config',
			group: 'autoscale',
			title: 'Change the pm2 options the pool boots under',
			description:
				'Store the pm2 options every worker of the scaled pool boots under. '
				+ 'pm2 reads them when it starts a worker, so nothing written here '
				+ 'reaches the pool by itself — `restart_autoscale_pool` is what '
				+ 'carries it, and until that runs the values are stored and '
				+ 'unapplied. Pass a field as null to hand it back to the '
				+ 'environment chain. Nothing is corrected: a value outside its '
				+ 'bounds is refused, because a supervisor takes what it is handed.',
			inputSchema: {
				type: 'object',
				properties: {
					supervisor: {
						type: 'object',
						description: 'The options to store, each a whole number: '
							+ '`listenTimeout` (1000-600000 ms, how long a replacement '
							+ 'has to report ready before the roll gives up on it), '
							+ '`killTimeout` (100-600000 ms), `minUptime` '
							+ '(100-600000 ms), `restartDelay` (0-600000 ms), '
							+ '`maxRestarts` (0-1000) and `maxMemoryRestartMegabytes` '
							+ '(64-65536). A null value clears that one field.',
					},
					note: {
						type: 'string',
						description: 'Why this is being changed, stored with the '
							+ 'options. Shared settings outlive the incident that '
							+ 'justified them, and this is what says which one that was.',
					},
				},
				required: ['note'],
			},
			outputSchema: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: 'The Redis key the options are stored under.',
					},
					sharedSettings: {
						type: 'object',
						description: 'The options as they now stand, or null for none. '
							+ 'This write stamps them `setFrom: "mcp"`.',
					},
					setByEmail: {
						type: 'string',
						description: 'The address behind `setBy`, or null for none.',
					},
				},
			},
			annotations: CHANGES_CONFIG,
			run: async (args, context) => {
				const supervisor = args['supervisor'];

				const usable = typeof supervisor === 'object'
					&& supervisor !== null
					&& Array.isArray(supervisor) === false;

				if (usable === false) {
					throw new InvalidPayloadError({
						reason: '`supervisor` has to be an object of pm2 options',
					});
				}

				return utils(context).updateSupervisorConfig(
					{
						...supervisor as Record<string, unknown>,
						note: args['note'],
					},
					'mcp',
				);
			},
		}),
		defineSystemMcpTool({
			name: 'restart_autoscale_pool',
			group: 'autoscale',
			title: 'Restart the scaled pool',
			description:
				'Roll every worker of the scaled pool: the supervisor starts a '
				+ 'replacement, waits for it to report ready, and only then retires '
				+ 'the worker it replaces — so the pool never drops below the size '
				+ 'it is holding. This is how anything a worker reads at boot '
				+ 'reaches a running pool without a deploy, and it is what applies '
				+ 'the options `write_supervisor_config` stores. Refused, with the '
				+ 'reason, where nothing reports that it is scaling a pool, where a '
				+ 'restart is already running, or where the pool is not in cluster '
				+ 'mode and a worker would be stopped before its replacement starts.',
			inputSchema: { type: 'object', properties: {} },
			outputSchema: {
				type: 'object',
				properties: {
					askedAt: {
						type: 'number',
						description: 'When the pool was asked for this one, in '
							+ 'milliseconds since the epoch.',
					},
					running: {
						type: 'boolean',
						description: 'Whether the supervisor is replacing workers, '
							+ 'which it still is when this answers.',
					},
					finishedAt: {
						type: 'number',
						description: 'When the last restart came back, null while one '
							+ 'runs. Read it back to watch this one land.',
					},
					error: {
						type: 'string',
						description: 'Why the last restart failed, or null.',
					},
				},
			},
			annotations: DISTURBS_POOL,
			run: async (_args, context) => utils(context).startAutoscaleReload(),
		}),
		defineSystemMcpTool({
			name: 'read_autoscale_drill',
			group: 'autoscale_drill',
			title: 'Read the running load drill',
			description:
				'Whether the pool is under a drill right now, and until when. Read '
				+ 'it back after starting one: the deadline that ends a drill is '
				+ 'the one each burning worker holds, not the one the request '
				+ 'asked for.',
			inputSchema: { type: 'object', properties: {} },
			outputSchema: {
				type: 'object',
				properties: {
					until: {
						type: 'number',
						description: 'When the drill runs out, in milliseconds since '
							+ 'the epoch, or null where none is running.',
					},
					percent: {
						type: 'number',
						description: 'The share of its time a drilling worker spends '
							+ 'holding the processor.',
					},
				},
			},
			annotations: READ_ONLY,
			run: async (_args, context) => utils(context).readAutoscaleDrill(),
		}),
		defineSystemMcpTool({
			name: 'run_autoscale_drill',
			group: 'autoscale_drill',
			title: 'Put the pool under load',
			description:
				'Make every worker of the pool spend a share of its time busy, on '
				+ 'purpose, so a configuration change can be watched deciding '
				+ 'something instead of waiting for the traffic that would decide '
				+ 'it. It touches nothing the loop reads except the load itself. '
				+ 'Refused where the pool is already working, because a drill laid '
				+ 'over real traffic measures both at once. Pass `stop: true` to '
				+ 'call one off before its deadline.',
			inputSchema: {
				type: 'object',
				properties: {
					seconds: {
						type: 'integer',
						description: 'How long to hold the pool under load, '
							+ `1-${MAX_DRILL_SECONDS}. Required unless stopping. The `
							+ 'cap is what makes a lost stop harmless, so a longer '
							+ 'drill is refused rather than shortened to it.',
					},
					percent: {
						type: 'integer',
						description: 'The share of its time each worker spends holding '
							+ `the processor, ${MIN_DRILL_PERCENT}-${MAX_DRILL_PERCENT}. `
							+ 'Required unless stopping. It stops short of the whole '
							+ 'slice so the deployment keeps answering while it burns.',
					},
					stop: {
						type: 'boolean',
						description: 'Call the running drill off now instead of '
							+ 'starting one.',
					},
				},
			},
			outputSchema: {
				type: 'object',
				properties: {
					until: {
						type: 'number',
						description: 'When the drill runs out, in milliseconds since '
							+ 'the epoch, or null where none is running.',
					},
					percent: {
						type: 'number',
						description: 'The share of its time a drilling worker spends '
							+ 'holding the processor.',
					},
				},
			},
			annotations: DISTURBS_POOL,
			run: async (args, context) => {
				const service = utils(context);

				if (args['stop'] === true) {
					return service.stopAutoscaleDrill();
				}

				return service.startAutoscaleDrill(args['seconds'], args['percent']);
			},
		}),
		defineSystemMcpTool({
			name: 'list_cache_entries',
			group: 'cache',
			title: 'List cache entries',
			description:
				'The response-cache entries seen in the window, grouped by endpoint and '
				+ 'query, with hit counts, size, age and remaining TTL. Use it to find '
				+ 'what is filling the cache and what is never read back.',
			inputSchema: { type: 'object', properties: windowProperty('10m') },
			outputSchema: LIST_OUTPUT,
			annotations: READ_ONLY,
			run: async (args, context) => {
				return utils(context).getCacheEntries(args['window']);
			},
		}),
		defineSystemMcpTool({
			name: 'read_cache_entry',
			group: 'cache',
			title: 'Read one cache entry',
			description:
				'The live state of a single response-cache entry: whether its value '
				+ 'is still held, its scoped-cache tags, when it was written and when '
				+ 'it expires, its size raw and compressed, any tombstone, and the '
				+ 'purges that covered it since it was filled. The cached response '
				+ 'itself is not returned. Use it to follow up a row the entry '
				+ 'listing returned, whose `redisKey` it takes — not its `key`, which '
				+ 'is the stats identity the two differ by where the deployment does '
				+ 'not hash its cache keys.',
			inputSchema: {
				type: 'object',
				properties: {
					redisKey: {
						type: 'string',
						description: 'The entry key, as `redisKey` in the entry listing.',
					},
				},
				required: ['redisKey'],
			},
			outputSchema: {
				type: 'object',
				properties: {
					exists: {
						type: 'boolean',
						description: 'Whether the value itself is still held.',
					},
					tags: {
						type: ['array', 'null'],
						description: 'Scoped-cache tags, where that sidecar was written.',
						items: { type: 'string' },
					},
					tagCounts: {
						type: 'object',
						description: 'How many entries each of those tags covers.',
					},
					expiry: {
						type: ['object', 'null'],
						description: 'When it was written, and the TTL it was written with.',
					},
					sizes: {
						type: ['object', 'null'],
						description: 'Its size as a response, and as Redis holds it.',
					},
					tombstone: {
						type: ['number', 'null'],
						description: 'When it was purged, where a tombstone outlived it.',
					},
					filledAt: {
						type: ['number', 'null'],
						description:
							'When it was last written, per its descriptor. Null where it '
							+ 'was never cached at all — a key known only from an anomaly '
							+ 'has a descriptor but no fill.',
					},
					purgesSinceFilled: {
						type: ['array', 'null'],
						description:
							'Purges that covered this entry after it was filled, newest '
							+ 'first, a namespace clear included. Beside `exists: true` '
							+ 'each one is an invalidation the entry survived. Empty '
							+ 'means none covered it; null means it was never filled, so '
							+ 'there is nothing to measure from.',
						items: { type: 'object' },
					},
				},
			},
			annotations: READ_ONLY,
			run: async (args, context) => {
				const redisKey = args['redisKey'];

				// One named entry and no default: an empty key would read the
				// deployment's own namespace prefix rather than anything asked for.
				if (typeof redisKey !== 'string' || redisKey.trim() === '') {
					throw new InvalidPayloadError({
						reason: 'A `redisKey` naming the entry to read is required',
					});
				}

				const entry = await utils(context).readCacheEntry(redisKey);

				// Everything the entry is, and not the response inside it. The cache
				// key carries the user (`get-cache-key.ts`), so a cached body is one
				// person's permission-filtered view, and a tool answer travels
				// wherever the model's context travels. Every lifecycle question —
				// is it held, how big, when does it die, what pins it, was it
				// tombstoned — is answered without it. `GET /utils/cache/entry`
				// still hands the body to an administrator who asks for it.
				return {
					exists: entry.exists,
					tags: entry.tags,
					tagCounts: entry.tagCounts,
					expiry: entry.expiry,
					sizes: entry.sizes,
					tombstone: entry.tombstone,
					filledAt: entry.filledAt,
					purgesSinceFilled: entry.purgesSinceFilled,
				};
			},
		}),
		defineSystemMcpTool({
			name: 'list_cache_anomalies',
			group: 'cache',
			title: 'List cache anomalies',
			description:
				'Responses the cache declined to keep in the window, and why — a value '
				+ 'over the size cap, a read with no collection to purge it by, a scope '
				+ 'too coarse to pin. Use it to explain a low hit ratio.',
			inputSchema: { type: 'object', properties: windowProperty('24h') },
			outputSchema: LIST_OUTPUT,
			annotations: READ_ONLY,
			run: async (args, context) => {
				return utils(context).getCacheAnomalies(args['window']);
			},
		}),
		defineSystemMcpTool({
			name: 'list_cache_latencies',
			group: 'cache',
			title: 'List cache latencies',
			description:
				'Response-time percentiles per endpoint group in the window, split by '
				+ 'outcome (served from cache, filled, declined). Use it to say what the '
				+ 'cache is actually saving.',
			inputSchema: { type: 'object', properties: windowProperty('10m') },
			outputSchema: LIST_OUTPUT,
			annotations: READ_ONLY,
			run: async (args, context) => {
				return utils(context).getCacheGroupLatencies(args['window']);
			},
		}),
		defineSystemMcpTool({
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
					...windowProperty('24h'),
					buckets: {
						type: 'number',
						// The bounds the read clamps to, so a client validating against
						// this schema knows what it will get rather than discovering it.
						minimum: CACHE_TIMESERIES_MIN_BUCKETS,
						maximum: CACHE_TIMESERIES_MAX_BUCKETS,
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
				return utils(context).getCacheTimeseries(
					args['window'],
					args['buckets'],
				);
			},
		}),
		defineSystemMcpTool({
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
					budgetAlert: {
						type: ['string', 'null'],
						description: 'Why the telemetry is over its byte budget and '
							+ 'cannot evict its way back. Collection keeps running.',
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
		}),
	];
}

/**
 * The tools this deployment exposes. A tool whose group is not exposed is not
 * listed and, because lookups go through here, cannot be called either.
 */
export function systemMcpTools(): SystemMcpTool[] {
	const groups = systemMcpToolGroups()
		// `PROCESSES_REPORT_ENABLED` off means every node's responder is gone
		// (`initProcessReports` returns early), so the collector would wait out its
		// window and answer an empty tree. The REST route is absent in that
		// deployment; the tool it shares a service with has to be too.
		.filter((group) => group !== 'processes' || processesReportEnabled())
		// A change travels to the scaling process over the bus, so a deployment with no
		// keep a change and nothing to read back — the same reason the REST route
		// is not registered there.
		.filter((group) => group !== 'autoscale' || redisConfigAvailable())
		// The drill holds real workers on the processor, so a deployment opens it
		// deliberately or not at all, and it reaches them over the bus — which
		// without Redis is an emitter this worker shares with nobody. Both gates
		// are the ones the REST routes are registered behind.
		.filter((group) => {
			return group !== 'autoscale_drill'
				|| (autoscaleDrillEnabled() && redisConfigAvailable());
		});

	return allSystemMcpTools().filter((tool) => groups.includes(tool.group));
}

export function findSystemMcpTool(name: unknown): SystemMcpTool | undefined {
	return systemMcpTools().find((tool) => tool.name === name);
}
