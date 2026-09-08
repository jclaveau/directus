import { paths } from '@common/config';
import { ChildProcess, execFileSync, spawn } from 'child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `paths.cwd` is tests/blackbox, so two levels up is the repo root. PM2 ships
// as an api dependency; the same binary the published image runs Directus with.
const pm2Bin = join(paths.cwd, '..', '..', 'api', 'node_modules', '.bin', 'pm2');

const workerScript = join(
	paths.cwd,
	'tests',
	'db',
	'app',
	'autoscale',
	'worker.cjs',
);

export interface Rig {
	appName: string;
	pm2Home: string;
	autoscaler: ChildProcess | null;
	logs: string[];
}

export interface PoolOptions {
	appName: string;
	instances: number;
	/**
	 * Milliseconds of spin per `idleMs` of sleep, which is what the daemon
	 * reports as CPU.
	 */
	busyMs?: number;
	idleMs?: number;
	/** Milliseconds each worker serves before aborting, so pm2 restarts it. */
	crashAfterMs?: number;
}

/**
 * A pm2 daemon of this suite's own, running the fixture app.
 *
 * Its own `PM2_HOME` so the daemon belongs to one rig and can be killed
 * without reaching any other — the suites run beside each other, and beside
 * whatever else the runner supervises.
 */
export function startPool(options: PoolOptions): Rig {
	const pm2Home = mkdtempSync(
		join(tmpdir(), `bb-autoscale-${options.appName}-`),
	);

	const ecosystem = join(pm2Home, 'ecosystem.config.cjs');

	writeFileSync(
		ecosystem,
		`module.exports = ${JSON.stringify({
			apps: [
				{
					name: options.appName,
					script: workerScript,
					exec_mode: 'cluster',
					instances: options.instances,
					// What the API's own ecosystem sets, and what makes a
					// worker's `ready` the signal that paces scaling rather
					// than a timer.
					wait_ready: true,
					listen_timeout: 10_000,
					env: {
						BB_BUSY_MS: String(options.busyMs ?? 0),
						BB_IDLE_MS: String(options.idleMs ?? 100),
						BB_CRASH_AFTER_MS: String(options.crashAfterMs ?? 0),
					},
				},
			],
		})};\n`,
	);

	execFileSync(pm2Bin, ['start', ecosystem], {
		env: { ...process.env, PM2_HOME: pm2Home },
		stdio: 'pipe',
	});

	return { appName: options.appName, pm2Home, autoscaler: null, logs: [] };
}

/** Runs `directus autoscale` against the rig's daemon, keeping its decisions. */
export function startAutoscaler(rig: Rig, env: Record<string, string>): void {
	const autoscaler = spawn('node', [paths.cli, 'autoscale'], {
		cwd: paths.cwd,
		env: {
			...process.env,
			PM2_HOME: rig.pm2Home,
			PM2_AUTOSCALE_APP_NAME: rig.appName,
			LOG_LEVEL: 'info',
			...env,
		},
	});

	autoscaler.stdout?.on('data', (chunk) => rig.logs.push(String(chunk)));
	autoscaler.stderr?.on('data', (chunk) => rig.logs.push(String(chunk)));

	rig.autoscaler = autoscaler;
}

export function stopRig(rig: Rig): void {
	rig.autoscaler?.kill('SIGTERM');

	try {
		execFileSync(pm2Bin, ['kill'], {
			env: { ...process.env, PM2_HOME: rig.pm2Home },
			stdio: 'pipe',
		});
	}
	catch {
		// The daemon dies with the job either way; a failed kill must not red
		// an otherwise passing suite.
	}
}

interface ListedProcess {
	name: string;
	pm2_env?: { status?: string };
}

/**
 * Workers of the managed app the daemon currently holds, whether serving yet
 * or not.
 */
export function countWorkers(rig: Rig): number {
	// pm2 jlist prints a large JSON document; the default 1 MB buffer cuts it
	// off mid-object.
	const listed = JSON.parse(execFileSync(pm2Bin, ['jlist'], {
		env: { ...process.env, PM2_HOME: rig.pm2Home },
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	})) as ListedProcess[];

	return listed
		.filter((worker) => worker.name === rig.appName)
		.filter((worker) => worker.pm2_env?.status !== 'stopped')
		.length;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * The pool size once it reaches `expected`, or once `timeoutMs` runs out.
 *
 * Returns the size either way, so the assertion is what names the failure
 * rather than a timeout with nothing to report.
 */
export async function poolSize(
	rig: Rig,
	expected: number,
	timeoutMs: number,
): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let size = countWorkers(rig);

	while (size !== expected && Date.now() < deadline) {
		await sleep(250);
		size = countWorkers(rig);
	}

	return size;
}

/**
 * Whether the pool stayed at or under `size` for the window.
 *
 * What an arm asserting "this must not grow" actually claims. Exact equality
 * would additionally claim the count never dips, and a worker being restarted
 * is briefly a worker the supervisor is between states on.
 */
export async function neverExceeded(
	rig: Rig,
	size: number,
	windowMs: number,
): Promise<number> {
	const deadline = Date.now() + windowMs;
	let peak = countWorkers(rig);

	while (Date.now() < deadline) {
		peak = Math.max(peak, countWorkers(rig));

		await sleep(250);
	}

	return peak;
}

/** Whether the pool ever left `size` over the window — what "held" means. */
export async function heldAt(
	rig: Rig,
	size: number,
	windowMs: number,
): Promise<boolean> {
	const deadline = Date.now() + windowMs;

	while (Date.now() < deadline) {
		if (countWorkers(rig) !== size) {
			return false;
		}

		await sleep(250);
	}

	return countWorkers(rig) === size;
}
