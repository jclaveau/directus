import config, { paths } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { ChildProcess, execFile, execFileSync, spawn } from 'child_process';
import Redis from 'ioredis';
import knex, { type Knex } from 'knex';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// `paths.cwd` is tests/blackbox, so two levels up is the repo root. PM2 ships
// as an api dependency; the same binary the published image runs Directus with.
const pm2Bin = join(paths.cwd, '..', '..', 'api', 'node_modules', '.bin', 'pm2');

/**
 * How long pm2 waits on a fixture worker's `ready` before it moves on: what
 * one boot costs a scale, whatever `readyDelayMs` says the worker takes.
 */
export const WORKER_LISTEN_TIMEOUT_MS = 10_000;

/**
 * The bound a supervisor call carries by default, `SUPERVISOR_TIMEOUT_MS` in
 * `api/src/processes/supervisor/lib/client.ts`: what a prewarm's scale gets
 * on top of the boots it asked for.
 */
export const SUPERVISOR_TIMEOUT_MS = 15_000;

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
	/**
	 * Milliseconds a worker takes to report ready.
	 *
	 * `wait_ready` holds the supervisor's answer to a scale until every
	 * worker that scale named has reported, and it starts them one after
	 * another — so this is what makes a scale cost what a pool of booting
	 * Directus workers costs rather than what a pool of empty ones does.
	 */
	readyDelayMs?: number;
	/**
	 * Which worker spins, by pm2 instance number. Unset means all of them, so
	 * every worker reports the same percent. Naming one stages a pool where
	 * they differ, which is the only pool an average can be wrong about.
	 */
	busyOnlyInstance?: string;
	/** Milliseconds a worker spends loaded before falling idle. */
	calmAfterMs?: number;
	/** Milliseconds a worker serves before aborting, so pm2 restarts it. */
	crashAfterMs?: number;
	/** Which worker crashes, by pm2 instance number. Unset means all of them. */
	crashOnlyInstance?: string;
	/**
	 * Requests a worker reports it is serving, which is what the autoscaler
	 * chooses a release victim from. Unset means the pool reports nothing, the
	 * way a pool on a build without the report does.
	 */
	inFlight?: number;
	/**
	 * Which workers report `inFlight`, by pm2 instance number, several of them
	 * comma-separated. Every other worker reports none. Unset means all of
	 * them report it.
	 */
	inFlightBusyInstances?: string;
	/**
	 * How many crashes the daemon puts a worker back for before it gives up and
	 * leaves it errored, which is the state it calls a failure. One makes the
	 * first crash the last, so an arm reaches that state without waiting out a
	 * budget.
	 *
	 * A worker left with restarting turned off ends stopped instead, and
	 * stopped is what an operator's own `pm2 stop` leaves behind — a pool is
	 * not short of a worker somebody took out of it.
	 */
	giveUpAfterRestarts?: number;
	/**
	 * The API itself as the pool's worker, booted under this environment, in
	 * place of the fixture.
	 *
	 * What a deployment's pool is made of: a worker's boot is a Directus boot,
	 * and what it serves are Directus routes, so this is the pool an arm about
	 * serving through a scale runs. The fixture's knobs above do not apply.
	 */
	directusEnv?: Record<string, string>;
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
					exec_mode: 'cluster',
					instances: options.instances,
					// What the API's own ecosystem sets, and what makes a
					// worker's `ready` the signal that paces scaling rather
					// than a timer.
					wait_ready: true,
					autorestart: true,
					...options.directusEnv === undefined
						? { script: workerScript, listen_timeout: WORKER_LISTEN_TIMEOUT_MS }
						: {
								// The CLI's entry file: `node` adds the
								// extension, pm2 checks the path exists.
								script: `${paths.cli}.js`,
								args: ['start'],
								// Where the suites spawn their own instances from.
								cwd: paths.cwd,
								// A Directus boot on a loaded runner, with the
								// margin the fixture's ten seconds do not need.
								listen_timeout: 60_000,
								// The planner's, so a release drains the way a
								// production one does.
								kill_timeout: 20_000,
							},
					...options.giveUpAfterRestarts === undefined
						? {}
						: {
								max_restarts: options.giveUpAfterRestarts,
								// Wider than the crash any arm stages, so the
								// crash counts against the budget above rather
								// than reading as a worker that had been up.
								min_uptime: 30_000,
							},
					env: options.directusEnv ?? {
						BB_BUSY_MS: String(options.busyMs ?? 0),
						BB_IDLE_MS: String(options.idleMs ?? 100),
						...options.readyDelayMs === undefined
							? {}
							: { BB_READY_DELAY_MS: String(options.readyDelayMs) },
						BB_CALM_AFTER_MS: String(options.calmAfterMs ?? 0),
						...options.busyOnlyInstance === undefined
							? {}
							: { BB_BUSY_ONLY_INSTANCE: options.busyOnlyInstance },
						BB_CRASH_AFTER_MS: String(options.crashAfterMs ?? 0),
						...options.crashOnlyInstance === undefined
							? {}
							: { BB_CRASH_ONLY_INSTANCE: options.crashOnlyInstance },
						...options.inFlight === undefined
							? {}
							: { BB_IN_FLIGHT: String(options.inFlight) },
						...options.inFlightBusyInstances === undefined
							? {}
							: {
									BB_IN_FLIGHT_BUSY_INSTANCES:
										options.inFlightBusyInstances,
								},
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

/** The `directus_settings` columns the processes module lays over the env. */
export type SharedSettingsColumn = 'autoscale_settings' | 'supervisor_settings';

// The channel `useBus` publishes a change on. It is namespaced by the bus
// rather than by the deployment, so it is the same one for every process on
// the shared Redis.
const CHANGED_CHANNEL = 'directus:bus:sharedSettingsChanged';

const REDIS_PORT = 6108;

const databases = new Map<Vendor, Knex>();

let announcer: Redis | null = null;

/**
 * The vendor's connection, as the autoscaler has to be told to reach it.
 *
 * It is spawned with this process's environment, which carries no `DB_*` at
 * all: the vendor's connection lives in the config the suites' own Directus
 * instances are spawned with.
 */
export function databaseEnv(vendor: Vendor): Record<string, string> {
	return Object.fromEntries(
		Object.entries(config.envs[vendor])
			.filter(([key]) => key.startsWith('DB_')),
	);
}

/**
 * Stores the layer every process of a deployment reads, or clears it.
 *
 * Written to the singleton directly rather than through `PATCH /settings`,
 * because most of these suites run a pool and an autoscaler and no Directus at
 * all. `announce` is what a write through the service would have published,
 * and leaving it off is how a suite asks whether the re-read floor alone
 * carries a change to a node the bus never reached.
 */
export async function storeSharedSettings(
	vendor: Vendor,
	column: SharedSettingsColumn,
	settings: Record<string, unknown> | null,
	announce = true,
): Promise<void> {
	let database = databases.get(vendor);

	if (database === undefined) {
		database = knex(config.knexConfig[vendor]!);
		databases.set(vendor, database);
	}

	const stored = settings === null
		? null
		: JSON.stringify(settings);

	const rows = await database('directus_settings').update({ [column]: stored });

	// A deployment nobody has saved a setting on yet has no singleton to carry
	// the layer, and the autoscaler reading one is how it gets there in
	// production too.
	if (rows === 0) {
		await database('directus_settings').insert({ [column]: stored });
	}

	if (announce) {
		announcer ??= new Redis({ host: 'localhost', port: REDIS_PORT });
		await announcer.publish(CHANGED_CHANNEL, JSON.stringify({ column }));
	}
}

/** Closes whatever storing a layer opened. */
export async function closeSharedSettings(): Promise<void> {
	for (const database of databases.values()) {
		await database.destroy();
	}

	databases.clear();

	announcer?.disconnect();
	announcer = null;
}

/** Runs `directus autoscale` against the rig's daemon, keeping its decisions. */
export function startAutoscaler(rig: Rig, env: Record<string, string>): void {
	const autoscaler = spawn('node', [paths.cli, 'autoscale'], {
		cwd: paths.cwd,
		env: {
			...process.env,
			// The autoscaler is a process of a Directus deployment, and building
			// the CLI registers the extensions with a connection: one spawned
			// without the variables naming it ends on the first missing one
			// before any command runs. The first vendor stands in for the suites
			// whose claim is about the loop rather than about a vendor; the
			// others name their own below.
			...databaseEnv(vendors[0]!),
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
	/** The declaration a worker booted under, entry by entry, as pm2 names them. */
	pm2_env?: { status?: string; restart_time?: number; [entry: string]: unknown };
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

/**
 * What each serving worker holds for one pm2 entry.
 *
 * Read off the daemon rather than off the autoscaler's report: the claim
 * being made is about the declaration a replacement worker booted under, and
 * only the supervisor holding that worker can answer it.
 */
export function declarationsOf(rig: Rig, entry: string): unknown[] {
	return listWorkers(rig)
		.filter((worker) => worker.pm2_env?.status !== 'stopped')
		.map((worker) => worker.pm2_env?.[entry]);
}

/**
 * Waits until every serving worker holds the entry at the value given.
 *
 * A rolling restart replaces the workers one at a time, so the pool holds the
 * old declaration beside the new one for as long as it runs: the arm is only
 * answered once the last worker still on the old one has gone. Returns what
 * it last saw either way, so a failure names the declaration it timed out on.
 */
export async function declaredEverywhere(
	rig: Rig,
	entry: string,
	value: unknown,
	timeoutMs: number,
): Promise<unknown[]> {
	const deadline = Date.now() + timeoutMs;
	let held: unknown[] = [];

	while (Date.now() < deadline) {
		held = declarationsOf(rig, entry);

		if (held.length > 0 && held.every((seen) => seen === value)) {
			return held;
		}

		await sleep(500);
	}

	return held;
}

/**
 * The pm2 instance numbers the daemon is still keeping, in ascending order.
 *
 * Which worker a release stopped, rather than how many are left: pm2 walks the
 * app's processes from the first one, so a release it chose from is a release
 * that took instance 0.
 */
export function instancesOf(rig: Rig): number[] {
	return listWorkers(rig)
		.filter((worker) => gone(worker) === false)
		.map((worker) => Number(worker.pm2_env?.['NODE_APP_INSTANCE'] ?? -1))
		.sort((left, right) => left - right);
}

/** A worker the pool is short of: given up on, or stopped by somebody. */
function gone(worker: ListedProcess): boolean {
	return ['stopped', 'stopping', 'errored']
		.includes(worker.pm2_env?.status ?? '');
}

/**
 * The workers the daemon is keeping.
 *
 * What is serving plus what is on its way to serving, which is the count the
 * autoscaler sizes a pool on. A worker it gave up on is neither, and neither is
 * one somebody stopped — a pool is short of both.
 */
export function countWorkers(rig: Rig): number {
	return listWorkers(rig).filter((worker) => gone(worker) === false).length;
}

/**
 * `countWorkers`, without holding the event loop for the half second the
 * listing takes: what a watcher reading the pool beside traffic it is itself
 * driving asks for.
 */
export async function countWorkersAsync(rig: Rig): Promise<number> {
	const { stdout } = await promisify(execFile)(pm2Bin, ['jlist'], {
		env: { ...process.env, PM2_HOME: rig.pm2Home },
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	});

	return (JSON.parse(stdout) as ListedProcess[])
		.filter((worker) => worker.name === rig.appName && gone(worker) === false)
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

/**
 * Waits for the autoscaler to decide something it had not decided by `taken`.
 *
 * A pool size is where the pool got to, which an arm about the autoscaler still
 * running can only read a minute late and cannot attribute: the supervisor
 * moves the pool too, and a pool that never moves says the autoscaler decided
 * against it and that it decided nothing in the same number. A decision line
 * says which, on the tick it happened.
 */
export async function decisionAfter(
	rig: Rig,
	taken: number,
	timeoutMs: number,
): Promise<string[]> {
	const deadline = Date.now() + timeoutMs;
	let decisions = decisionsOf(rig);

	while (decisions.length <= taken && Date.now() < deadline) {
		await sleep(250);
		decisions = decisionsOf(rig);
	}

	return decisions.slice(taken);
}

/** The lines the autoscaler logged for the resizes it decided on. */
export function decisionsOf(rig: Rig): string[] {
	return rig.logs
		.join('')
		.split('\n')
		.filter((line) => line.includes('workers:'));
}

/**
 * The resizes the autoscaler decided on, as `from -> to`, in order. How the
 * pool got from one size to another is what a release of several workers at
 * once has over a release of one a cooldown, and the sizes the pool passed
 * through cannot say it: a poll sees the pool between deletes either way.
 */
export function resizesOf(rig: Rig): string[] {
	return decisionsOf(rig).flatMap((line) => {
		const resize = line.match(/(\d+ -> \d+) workers:/);

		return resize === null
			? []
			: [resize[1]!];
	});
}
