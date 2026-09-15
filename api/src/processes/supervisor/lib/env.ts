/**
 * The `pm2_env` fields this codebase reads.
 *
 * PM2's published typings stop at a documented subset: the counters it keeps
 * per worker and the declaration a worker boots under are on the runtime
 * object and absent from them. Declared here once so the pages that report a
 * supervisor and the loop that scales one read the same object rather than
 * each describing its own slice of it.
 *
 * The counters are PM2's own and arrive as it wrote them. The declaration
 * comes from a deployment's configuration, so every field it can set is
 * `unknown` and the reader coerces — except the three a report shows, which it
 * shows as PM2 hands them over.
 */
export interface SupervisedProcessEnv {
	status?: string;
	restart_time?: number;
	unstable_restarts?: number;
	pm_uptime?: number;
	NODE_APP_INSTANCE?: string | number;
	max_memory_restart?: number;
	exec_mode?: string;
	instances?: number | 'max';
	listen_timeout?: unknown;
	kill_timeout?: unknown;
	min_uptime?: unknown;
	max_restarts?: unknown;
	restart_delay?: unknown;
	autorestart?: unknown;
	wait_ready?: unknown;
}
