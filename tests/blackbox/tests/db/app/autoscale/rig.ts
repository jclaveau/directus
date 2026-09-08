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
	/** Milliseconds a worker spends loaded before falling idle. */
	calmAfterMs?: number;
	/** Milliseconds a worker serves before aborting, so pm2 restarts it. */
	crashAfterMs?: number;
	/** Which worker crashes, by pm2 instance number. Unset means all of them. */
	crashOnlyInstance?: string;
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
						BB_CALM_AFTER_MS: String(options.calmAfterMs ?? 0),
						BB_CRASH_AFTER_MS: String(options.crashAfterMs ?? 0),
						...options.crashOnlyInstance === undefined
							? {}
							: { BB_CRASH_ONLY_INSTANCE: options.crashOnlyInstance },
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

/**
 * Takes the supervisor away from under the autoscaler and brings it back.
 *
 * What a `pm2 update`, an OOM or the planner's nightly restart does to the
 * daemon a running autoscaler is already connected to. The pool comes back at
 * the size the ecosystem declares, not the size it had.
 */
export function restartSupervisor(rig: Rig): void {
	execFileSync(pm2Bin, ['kill'], {
		env: { ...process.env, PM2_HOME: rig.pm2Home },
		stdio: 'pipe',
	});

	execFileSync(pm2Bin, ['start', join(rig.pm2Home, 'ecosystem.config.cjs')], {
		env: { ...process.env, PM2_HOME: rig.pm2Home },
		stdio: 'pipe',
	});
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
	pm_id?: number;
	monit?: { cpu?: number };
	pm2_env?: { status?: string; restart_time?: number };
}

/**
 * Waits until the supervisor has recorded a restart of this app.
 *
 * An arm about a churning pool has to start the autoscaler against one that is
 * already churning. Started beside a pool that has not crashed yet, it sees a
 * calm pool — correctly — and acts on it before the first crash lands.
 */
export async function waitForRestart(rig: Rig, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (restartsOf(rig) > 0) {
			return true;
		}

		await sleep(250);
	}

	return false;
}

/**
 * Restarts the supervisor has recorded for the pool.
 *
 * A pool briefly holds two entries for one worker it is replacing, so a size an
 * arm did not expect is either a scale or a restart — and an assertion that
 * reports only the size cannot say which, on a runner where neither
 * reproduces.
 */
export function restartsOf(rig: Rig): number {
	return listWorkers(rig)
		.reduce((total, worker) => total + (worker.pm2_env?.restart_time ?? 0), 0);
}

/**
 * Workers of the managed app the daemon currently holds, whether serving yet
 * or not.
 */
function listWorkers(rig: Rig): ListedProcess[] {
	// pm2 jlist prints a large JSON document; the default 1 MB buffer cuts it
	// off mid-object.
	const listed = JSON.parse(execFileSync(pm2Bin, ['jlist'], {
		env: { ...process.env, PM2_HOME: rig.pm2Home },
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	})) as ListedProcess[];

	return listed.filter((worker) => worker.name === rig.appName);
}

export function countWorkers(rig: Rig): number {
	return listWorkers(rig)
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

/**
 * Every pool size seen over the window, in the order it was first seen.
 *
 * An arm claiming the pool holds fails on a bare boolean without saying what
 * it saw, and the two ways of leaving a size want opposite fixes: growing is
 * the scaling defect these arms are about, while dipping is the supervisor
 * between states on a worker it is replacing.
 */
export async function sizesOver(rig: Rig, windowMs: number): Promise<number[]> {
	const deadline = Date.now() + windowMs;
	const seen: number[] = [];

	do {
		const size = countWorkers(rig);

		if (seen.includes(size) === false) {
			seen.push(size);
		}

		await sleep(250);
	} while (Date.now() < deadline);

	return seen;
}

/**
 * What the autoscaler was doing, for an assertion to fail with.
 *
 * A pool that did not move says nothing about why: the process may be gone, it
 * may be deciding against a load the runner never gave it, or its ticks may be
 * failing. All three read as one number, and none of them reproduces on a quiet
 * laptop.
 */
export function reportOf(rig: Rig): string {
	const autoscaler = rig.autoscaler;

	let alive = 'never started';

	if (autoscaler !== null) {
		alive = autoscaler.exitCode === null && autoscaler.signalCode === null
			? 'running'
			: `gone (code ${autoscaler.exitCode}, signal ${autoscaler.signalCode})`;
	}

	const tail = rig.logs
		.join('')
		.split('\n')
		.slice(-40)
		.join('\n');

	// What the supervisor reports for the pool right now, which is the
	// autoscaler's whole input: a pool that did not grow because the runner gave
	// it no load to read looks, in the lines above, exactly like one whose ticks
	// never ran. Caught, because asking means calling the daemon that may be the
	// thing that failed, and a report that throws takes the assertion it was
	// meant to explain with it.
	let reported: string;

	try {
		reported = listWorkers(rig)
			.map((worker) => {
				const status = worker.pm2_env?.status ?? 'unknown';

				return `${worker.pm_id}:${status}:${worker.monit?.cpu ?? '-'}%`;
			})
			.join(', ');
	}
	catch (error) {
		reported = `unreadable: ${error}`;
	}

	return `autoscaler ${alive}; supervisor reports [${reported}]; `
		+ `its last lines:\n${tail}`;
}

/** The lines the autoscaler logged for the resizes it decided on. */
export function decisionsOf(rig: Rig): string[] {
	return rig.logs
		.join('')
		.split('\n')
		.filter((line) => line.includes('workers:'));
}
