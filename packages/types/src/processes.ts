/**
 * The running-processes report behind Settings → Processes: a
 * service → replica → process tree, each leaf carrying what its supervisor
 * observed about it and what environment it actually resolved.
 *
 * Shared here so the API producer and the app view can't drift.
 */

/** Which halves of a node the report carries, per `PROCESSES_REPORT_DETAILS`. */
export type ProcessDetail = 'stats' | 'env';

/**
 * Which layer of the env loader supplied a variable's final value:
 *
 * - `default` — the shipped `DEFAULTS` table, nothing overrode it
 * - `process` — the process environment (`process.env`)
 * - `file` — the config file at `CONFIG_PATH`
 * - `secret-file` — a `*_FILE` variable, read from the path it pointed at
 */
export type EnvValueSource = 'default' | 'process' | 'file' | 'secret-file';

/** One resolved variable as reported by the process that resolved it. */
export interface ResolvedEnvVariable {
	key: string;
	/** `null` when redacted — the value never leaves the process. */
	value: string | null;
	redacted: boolean;
	/** Whether the process holds a non-empty value, redacted or not. */
	isSet: boolean;
	source: EnvValueSource;
}

/** What the supervisor (PM2) observed about one of its processes. */
export interface ProcessSupervisorStats {
	status: string;
	restarts: number;
	unstableRestarts: number;
	uptimeMs: number | null;
	memoryBytes: number | null;
	cpuPercent: number | null;
	/** The `max_memory_restart` cap this process is recycled at. */
	maxMemoryRestartBytes: number | null;
	execMode: string | null;
	configuredInstances: number | 'max' | null;
}

/** What a process measured about itself, from inside. */
export interface ProcessRuntimeStats {
	rssBytes: number;
	heapUsedBytes: number;
	heapTotalBytes: number;
	externalBytes: number;
	uptimeMs: number;
	nodeVersion: string;
	/**
	 * The Node options this process was actually started with, so a flag set in
	 * the supervisor config or `NODE_OPTIONS` can be confirmed live rather than
	 * inferred from what the memory figures look like. Script arguments are not
	 * here — `execArgv` carries only what Node itself parsed.
	 */
	execArgv: string[];
}

/** One process: a PM2 app instance, or the lone process when unsupervised. */
export interface ProcessNode {
	/** Stable per-process bus identity, as used by the logs stream. */
	nodeId: string | null;
	pid: number | null;
	pmId: number | null;
	name: string;
	/** PM2's `NODE_APP_INSTANCE`, `null` when unsupervised. */
	instance: number | null;
	/** `false` when the supervisor lists it but it never answered. */
	responding: boolean;
	runtime: ProcessRuntimeStats | null;
	supervisor: ProcessSupervisorStats | null;
	env: ResolvedEnvVariable[] | null;
}

/**
 * How much of a replica's supervisor view the report got:
 *
 * - `pm2` — a full `pm2 list`, so dead/restarting processes are listed too
 * - `unavailable` — PM2 runs there, but no process answered with its list
 * - `none` — no supervisor; the process was started directly
 */
export type ProcessSupervisorState = 'pm2' | 'unavailable' | 'none';

/**
 * What the container a replica runs in is allowed to use. Read from the cgroup
 * rather than from `os`, which reports the whole machine however small a slice
 * the container was given — a usage bar against the host's 64 GB says nothing
 * about a process 200 MB from its own limit.
 */
export interface ProcessHostCapacity {
	/** Bytes the cgroup caps memory at, or the machine's where it is uncapped. */
	memoryBytes: number | null;
	/** Cores the CPU quota allows, fractional where the quota is. */
	cpuCores: number | null;
}

/** One replica: a container, holding one supervisor and its processes. */
export interface ProcessReplica {
	replicaId: string;
	hostname: string;
	supervisor: ProcessSupervisorState;
	/** `null` where no process answered with what its container may use. */
	capacity: ProcessHostCapacity | null;
	processes: ProcessNode[];
}

/** One service: a deployment unit, holding its replicas. */
export interface ProcessService {
	service: string;
	replicas: ProcessReplica[];
}

/** What could not be answered, so the page can say so rather than lie. */
export interface ProcessesDegraded {
	/**
	 * `true` when the bus is local-only (no Redis), so the report covers this
	 * replica alone however many are actually running.
	 */
	crossReplica: boolean;
	/** `true` when at least one replica has no usable supervisor view. */
	supervisor: boolean;
}

export interface ProcessesReport {
	collectedAt: number;
	/** How long replies were collected for, in ms. */
	collectedForMs: number;
	details: ProcessDetail[];
	services: ProcessService[];
	degraded: ProcessesDegraded;
}
