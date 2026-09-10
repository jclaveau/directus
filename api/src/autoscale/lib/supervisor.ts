import type { AutoscaleSupervisor } from '@directus/types';
import type { SupervisedProcessEnv } from '../../processes/supervisor/index.js';

/**
 * What pm2 acts on for a declaration that names no value.
 *
 * Kept here rather than reported as "unset" because unset is not what happens:
 * a worker whose declaration says nothing about `listen_timeout` is still given
 * up on after three seconds, and a pool whose workers take longer than that to
 * boot is one where the number matters most.
 */
const SUPERVISOR_FALLBACKS = {
	instances: 1,
	execMode: 'fork_mode',
	listenTimeout: 3000,
	killTimeout: 1600,
	minUptime: 1000,
	maxRestarts: 16,
	restartDelay: 0,
};

/**
 * A declared value as a number, or `fallback` where the declaration named
 * none.
 *
 * pm2 parses a numeric string into a number when it validates the declaration,
 * so an option a deployment passes straight from its environment arrives here
 * already typed. Parsed again anyway: a value that reached `pm2_env` some other
 * way is worth reporting as the number it means rather than dropping to a
 * fallback the supervisor is not using.
 */
function declaredNumber(value: unknown, fallback: number): number {
	const parsed = Number(value);

	return value === undefined || value === null || Number.isFinite(parsed) === false
		? fallback
		: parsed;
}

/** The pm2 application declaration one worker is running under. */
export function declaredBy(env: SupervisedProcessEnv): AutoscaleSupervisor {
	const memory = Number(env.max_memory_restart);

	return {
		instances: declaredNumber(env.instances, SUPERVISOR_FALLBACKS.instances),
		execMode: typeof env.exec_mode === 'string'
			? env.exec_mode
			: SUPERVISOR_FALLBACKS.execMode,
		maxMemoryRestart: Number.isFinite(memory) && memory > 0
			? memory
			: null,
		listenTimeout: declaredNumber(
			env.listen_timeout,
			SUPERVISOR_FALLBACKS.listenTimeout,
		),
		killTimeout: declaredNumber(
			env.kill_timeout,
			SUPERVISOR_FALLBACKS.killTimeout,
		),
		minUptime: declaredNumber(env.min_uptime, SUPERVISOR_FALLBACKS.minUptime),
		maxRestarts: declaredNumber(
			env.max_restarts,
			SUPERVISOR_FALLBACKS.maxRestarts,
		),
		restartDelay: declaredNumber(
			env.restart_delay,
			SUPERVISOR_FALLBACKS.restartDelay,
		),
		autorestart: env.autorestart !== false,
		waitReady: env.wait_ready === true,
	};
}
