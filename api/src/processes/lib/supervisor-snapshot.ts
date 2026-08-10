import type { ProcessSupervisorStats } from '@directus/types';
import { promisify } from 'node:util';
import pm2 from 'pm2';
import { useLogger } from '../../logger/index.js';

/**
 * PM2 sets `PM2_HOME` in every process it supervises; its absence is how local
 * dev and CI runs — which start the process directly — are told apart from a
 * supervised deployment. Same probe the metrics aggregator uses.
 */
export function supervisorAvailable(): boolean {
	return 'PM2_HOME' in process.env;
}

const listApps = promisify(pm2.list.bind(pm2));

/**
 * PM2's published typings stop at a documented subset of `pm2_env`; the recycling
 * cap and the exec mode — the two fields this page exists to show — are on the
 * runtime object but absent from them.
 */
interface SupervisedProcessEnv {
	status?: string;
	restart_time?: number;
	unstable_restarts?: number;
	pm_uptime?: number;
	max_memory_restart?: number;
	exec_mode?: string;
	instances?: number | 'max';
	NODE_APP_INSTANCE?: string | number;
}

/** One row of `pm2 list`, as this report needs it. */
export interface SupervisedProcess {
	pid: number | null;
	pmId: number | null;
	name: string;
	instance: number | null;
	stats: ProcessSupervisorStats;
}

function instanceNumber(value: string | number | undefined): number | null {
	const parsed = Number(value);

	return value !== undefined && Number.isInteger(parsed)
		? parsed
		: null;
}

/**
 * Every process of the local PM2 daemon, including the ones too dead to answer
 * for themselves — which is the whole point of asking the supervisor rather than
 * only collecting self-reports.
 *
 * Returns `null` when there is no supervisor, or when the daemon could not be
 * reached; the report says so rather than presenting a short list as complete.
 */
export async function readSupervisedProcesses(): Promise<
	SupervisedProcess[] | null
> {
	if (supervisorAvailable() === false) {
		return null;
	}

	try {
		const apps = await listApps();

		return apps.map((app) => {
			const pm2Env: SupervisedProcessEnv = app.pm2_env ?? {};

			return {
				pid: app.pid ?? null,
				pmId: app.pm_id ?? null,
				name: app.name ?? 'unknown',
				instance: instanceNumber(pm2Env.NODE_APP_INSTANCE),
				stats: {
					status: pm2Env.status ?? 'unknown',
					restarts: pm2Env.restart_time ?? 0,
					unstableRestarts: pm2Env.unstable_restarts ?? 0,
					uptimeMs: pm2Env.pm_uptime ?? null,
					memoryBytes: app.monit?.memory ?? null,
					cpuPercent: app.monit?.cpu ?? null,
					maxMemoryRestartBytes: pm2Env.max_memory_restart ?? null,
					execMode: pm2Env.exec_mode ?? null,
					configuredInstances: pm2Env.instances ?? null,
				},
			};
		});
	}
	catch (error) {
		useLogger().warn(error, 'Could not read the PM2 process list');

		return null;
	}
}
