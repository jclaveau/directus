import { freemem } from 'node:os';
import { LEGACY_SAMPLE_WINDOW } from '@directus/constants';
import { useLogger } from '../../logger/index.js';
import { initProcessReports } from '../index.js';
import {
	connectToSupervisor,
	disconnectFromSupervisor,
	releaseWorker,
	SUPERVISOR_TIMEOUT_MS,
	scaleApp,
} from '../supervisor/index.js';
import { guardUnhandledRejections } from '../../utils/report-unhandled-rejection.js';
import { validateBooleanEnv } from '../../utils/validate-env.js';
import { PROCESSES_BOOLEAN_ENV } from '../lib/boolean-env.js';
import { reportPoolHealth } from '../lib/pool-health.js';
import { chooseVictims } from './lib/choose-victims.js';
import { decide } from './lib/decide.js';
import { inFlightOf, watchInFlightReports } from './lib/in-flight.js';
import { PoolSamples } from './lib/pool-samples.js';
import { type OnlineWorker, readPool, restarted } from './lib/pool.js';
import {
	beginAskedReload,
	initAutoscaleReload,
	reloadState,
	reloading,
} from './lib/reload.js';
import {
	initSharedSettingsMirror,
	resolveConfig,
	resolvedSources,
	resolvedWithoutSharedSettings,
} from './lib/resolve-config.js';
import { WorkerCpu } from './lib/worker-cpu.js';
import { recordAutoscaleTick } from './lib/state.js';
import { SUPERVISOR_FALLBACKS } from './lib/supervisor.js';
import type { AutoscaleConfig, Decision } from './types.js';

/**
 * How often the pool is sampled. The thresholds are what tuning should reach
 * for.
 */
const SAMPLE_INTERVAL_MS = 1000;

/**
 * Shrinks the pool by stopping workers this picks, rather than a size pm2 picks
 * from.
 *
 * Handed a size, pm2 walks the app's processes from the first one and deletes
 * the worker the pool has had longest. Under keep-alive that is where the live
 * requests are — node cluster round-robins new connections, so clients stay on
 * the workers they already hold sockets to — and stopping it drops them: the
 * drain budget is the shutdown timeout, and a request already past it is a 502.
 *
 * Together rather than one after the other: the supervisor answers a release
 * once the worker has drained, up to its `kill_timeout`, and a release of
 * several workers waiting out each drain in turn would hold the tick for the
 * sum of them. Every release is asked for before any is waited on, so the
 * drains overlap and the tick waits for the longest. A release the supervisor
 * does not answer fails the tick once the others have settled, the same as it
 * fails a release of one, and the next tick reads the pool it left.
 */
async function releaseWorkers(
	pool: OnlineWorker[],
	count: number,
): Promise<void> {
	const candidates = pool.map((worker) => {
		return { pmId: worker.pmId, inFlight: inFlightOf(worker.pmId) };
	});

	const releases = await Promise.allSettled(
		chooseVictims(candidates, count).map((pmId) => releaseWorker(pmId)),
	);

	for (const release of releases) {
		if (release.status === 'rejected') {
			throw release.reason;
		}
	}
}

/**
 * The size the pool is meant to be serving with once it is up.
 *
 * The prewarm where one is asked for, because that is the whole of what it
 * asks: be this big before the deployment takes traffic. The floor otherwise,
 * and the floor too where scaling is off, since prewarm is one of the things
 * that does not run then. Not a floor itself: a deploy restarts the pool at
 * its floor, sized for an idle night, and the workers prewarm adds for the
 * first requests after it are released like any others once the load does
 * not justify them.
 */
export function targetPoolSize(config: AutoscaleConfig): number {
	if (config.enabled === false) {
		return config.minWorkers;
	}

	return Math.min(
		Math.max(config.minWorkers, config.prewarmWorkers),
		config.maxWorkers,
	);
}

/**
 * How many workers the supervisor had given up on when that was last said.
 *
 * Read on every tick, so a line a tick would be the pool's whole log.
 */
let lastFailedWorkers = 0;

/**
 * Say that the pool is short, and say when it is whole again.
 *
 * At error because nothing else reports it: `/server/health` carries the same
 * reading, but a platform polling it is answered by a worker that is serving
 * and reads the 200 it was looking for. This line is what a deployment that
 * lost a worker to a boot it cannot finish has to go on.
 */
function announceFailedWorkers(failed: number, online: number): void {
	if (failed === lastFailedWorkers) {
		return;
	}

	const logger = useLogger();

	if (failed > 0) {
		logger.error(
			`[autoscale] the supervisor could not keep ${failed} worker(s) `
				+ `running; the pool is serving with ${online}`,
		);
	}
	else {
		logger.info(`[autoscale] the pool is whole again, at ${online} worker(s)`);
	}

	lastFailedWorkers = failed;
}

/**
 * Watches one pm2 app and resizes it.
 *
 * Runs as its own process beside the app it scales, so the decision survives
 * any single worker and no worker ever scales itself.
 */
export async function runAutoscaler(): Promise<void> {
	const logger = useLogger();

	// Before anything is connected to: a pool told to scale by a variable this
	// process reads as false would run at its floor under any load, and the
	// deployment that set it would have no line saying why.
	validateBooleanEnv(PROCESSES_BOOLEAN_ENV);

	// This command outlives the pool it manages, so it takes the guard the server
	// process takes and for the same reason: Node ends a process on a rejection
	// nothing awaited, and an unreachable Redis produces them from the bus
	// subscriber and from commands its own caller has already given up on. An
	// autoscaler that exits leaves the pool at whatever size the outage caught it
	// at, and its supervisor restarts it into the same outage.
	guardUnhandledRejections();

	// Armed before the connection, which is what launches the bus it reads:
	// the workers report over pm2's own channel rather than over the bus the
	// rest of the processes module uses, so what the autoscaler knows about
	// which worker is busy survives a Redis outage exactly as its scaling does.
	watchInFlightReports();

	await connectToSupervisor();

	// The supervisor lists this process like any other, and the processes report
	// is built on that list — so without a self-report of its own the autoscaler
	// shows up on the Processes page as a worker that never answers, which is
	// what that page means by a worker crash-looping too fast to reply. It
	// describes itself for the same reason every worker does.
	//
	// Never a reason not to scale, which is why the loop does not wait for it: the
	// report subscribes over the shared Redis client, and a command that client is
	// asked for while it is not connected waits in a queue with no deadline
	// (jclaveau/directus#463) — on the critical path, an autoscaler booting into a
	// Redis outage would take no decision at all until that queue was flushed,
	// which is the retry budget away and can be configured further away still.
	initProcessReports().catch((error) => {
		logger.warn(error, '[autoscale] could not answer processes queries');
	});

	// The pool cannot restart itself: a worker running the restart would be
	// retiring the process serving the request. This is the process that holds
	// the supervisor connection and is not a member of the pool, so it listens
	// for the ask instead.
	initAutoscaleReload();

	// Before the loop rather than inside it: the mirror the ticks read is seeded
	// once here, and kept current by the announcement every settings write makes
	// plus a floor of its own. A tick that had to fetch it would put a query on
	// the one path that must not be able to hang.
	await initSharedSettingsMirror();

	const stop = () => {
		disconnectFromSupervisor();
		process.exit(0);
	};

	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);

	let lastScaleUpAt = Date.now();
	let lastScaleDownAt = Date.now();
	let prewarmed = false;
	let prewarmBegun = false;
	let prewarmAsked: Promise<void> | null = null;
	// The epoch until the pool has been seen growing once.
	let poolGrewAt = 0;
	let workersBefore: number | null = null;
	let restartsByWorker: Map<number, number> | null = null;
	let lastRestartAt: number | null = null;

	// Fed on every tick whichever strategy is running, so switching strategy
	// during an incident decides on a full window rather than on the single
	// reading it happens to switch on.
	const samples = new PoolSamples();

	// Kept across ticks because a CPU percent is a window rather than a value,
	// and this is what holds the end of the previous one.
	const cpu = new WorkerCpu();

	for (;;) {
		// A tick that throws is a tick that was skipped, never the end of the
		// autoscaler: it would leave the pool frozen at whatever size the
		// failure caught it in, and a pool that cannot shrink is how the
		// module this replaces took production down.
		try {
			const config = resolveConfig();
			const reading = await readPool(config.appName, config.warmupSeconds);
			const { pendingWorkers, warmingWorkers } = reading;

			// Re-measured rather than taken from the supervisor: pm2's percent
			// covers the time since whichever client last asked about that pid,
			// so anything else listing the same daemon sets the window this
			// pool is judged on.
			const onlineWorkers = cpu.measure(reading.onlineWorkers);
			const workers = onlineWorkers.length + pendingWorkers;

			// A worker the supervisor is starting counts from its fork, so this
			// is when the supervisor was last seen adding one.
			if (workersBefore !== null && workers > workersBefore) {
				poolGrewAt = Date.now();
			}

			workersBefore = workers;
			beginAskedReload(config.appName, workers);

			// Held back while a reload is in flight: it replaces the pool a
			// worker at a time on purpose, and the states it passes through
			// are not a pool that lost any.
			if (reloading() === false) {
				reportPoolHealth({
					failedWorkers: reading.failedWorkers,
					onlineWorkers: onlineWorkers.length,
					targetWorkers: targetPoolSize(config),
				});

				announceFailedWorkers(reading.failedWorkers, onlineWorkers.length);
			}

			const carriesRestarts = [...reading.restartsByWorker.values()]
				.some((count) => count > 0);

			// The first sample is a baseline, so no rise can be read from it —
			// and an autoscaler that starts against a pool already carrying
			// restarts would otherwise spend a whole crash cycle believing the
			// pool is calm. Meeting one counts as meeting it mid-churn.
			const churnObserved = restartsByWorker === null
				? carriesRestarts
				: restarted(restartsByWorker, reading.restartsByWorker);

			if (churnObserved) {
				lastRestartAt = Date.now();
			}

			restartsByWorker = reading.restartsByWorker;
			const observed = samples.observe(onlineWorkers);

			// Warm-up samples are dropped here rather than averaged back in: a
			// worker held out of the statistic while it booted would otherwise
			// carry that boot into the window for as long again once warm.
			const smoothed = samples.averaged(config.sampleWindow, true);
			const legacy = samples.averaged(LEGACY_SAMPLE_WINDOW, false);

			const cpuPercents = onlineWorkers
				.filter((worker) => worker.mature)
				.map((worker) => smoothed.get(worker.pid)?.cpuPercent ?? 0);

			const legacyWorkers = onlineWorkers.map((worker) => {
				return legacy.get(worker.pid)
					?? { cpuPercent: worker.cpuPercent, memoryMegabytes: 0 };
			});

			// The module paces itself off the pool's membership rather than off
			// the scales it asked for, so a worker the supervisor replaced
			// re-arms the cooldowns exactly as one it added would.
			if (config.strategy === 'legacy') {
				if (observed.appeared) {
					lastScaleUpAt = Date.now();
				}

				if (observed.vanished) {
					lastScaleDownAt = Date.now();
				}
			}

			const now = Date.now();

			const secondsSinceRestart = lastRestartAt === null
				? null
				: (now - lastRestartAt) / 1000;

			const churning = secondsSinceRestart !== null
				&& secondsSinceRestart < config.warmupSeconds;

			// A pool fresh out of a deploy, which is the one prewarm exists for,
			// carries no restarts at all. One that does was crash-looping
			// before the autoscaler arrived, and prewarm would hand it a batch
			// of workers to crash. A worker restarting once the prewarm is under
			// way holds it for the warm-up, like any restart holds a decision,
			// and no longer: the deployment still has to reach the size it asked
			// for, and one still crashing keeps the warm-up running.
			const readyToPrewarm = config.enabled
				&& config.strategy !== 'legacy'
				&& workers > 0
				&& churning === false
				&& (carriesRestarts === false || prewarmBegun)
				&& prewarmed === false
				&& reloading() === false;

			let decision: Decision | null = null;

			if (readyToPrewarm) {
				const target = targetPoolSize(config);
				lastScaleUpAt = Date.now();
				lastScaleDownAt = Date.now();

				// pm2 waits at most this long on each worker a scale adds before
				// it moves to the next: what one boot costs the scale, whatever
				// the worker itself takes.
				const listenTimeout = reading.supervisor?.listenTimeout
					?? SUPERVISOR_FALLBACKS.listenTimeout;

				const sinceGrowthMs = Date.now() - poolGrewAt;

				// Latched on the pool having reached the size, not on the scale
				// having been asked for: only the read at the top of the tick says
				// whether the workers a scale started have arrived.
				if (target <= workers) {
					prewarmed = true;
				}
				else if (prewarmAsked !== null) {
					decision = {
						workers: null,
						reason: `the prewarm to ${target} is still arriving`,
					};
				}
				// A second scale sent while the first is still adding counts the
				// workers added so far and adds the difference on top of the ones
				// still to come, and a failed ask does not say whether pm2 is
				// still adding: the daemon may be gone, or alive and starved past
				// the bound. A scale still adding forks a worker at least every
				// `listen_timeout`, so a pool that has not grown for two of them
				// has no scale behind it.
				else if (sinceGrowthMs < 2 * listenTimeout) {
					decision = {
						workers: null,
						reason: 'a scale may still be adding: the pool grew '
							+ `${Math.round(sinceGrowthMs / 1000)}s ago`,
					};
				}
				else {
					prewarmBegun = true;

					logger.info(
						`[autoscale] prewarming ${config.appName} `
						+ `from ${workers} to ${target} workers`,
					);

					// One scale for the whole target, not waited on by the tick:
					// pm2 answers it once every worker it added has reported ready,
					// one boot after another, which for a pool of fifteen runs well
					// past the bound a supervisor call carries by default. Bounded
					// all the same, at the boots asked for plus that default: pm2
					// clocks `listen_timeout` from the worker's `online` event, so
					// the fork before it is a cost the scale carries on top, one
					// pm2 does not bound and a container booting the pool it just
					// asked for stretches. A scale still unanswered past that is
					// one whose answer is not coming — the daemon it was sent to is
					// gone and the one listening now never heard of it.
					prewarmAsked = scaleApp(
						config.appName,
						target,
						(target - workers) * listenTimeout + SUPERVISOR_TIMEOUT_MS,
					)
						.catch((error: unknown) => {
							logger.warn(
								error,
								'[autoscale] the prewarm scale failed, asked again next tick',
							);
						})
						.finally(() => {
							prewarmAsked = null;
						});

					decision = { workers: target, reason: 'prewarming the pool' };
				}
			}
			else if (config.enabled && reloading() === false) {

				decision = decide({
					cpuPercents,
					pendingWorkers,
					warmingWorkers,
					secondsSinceRestart,
					now,
					lastScaleUpAt,
					lastScaleDownAt,
					legacyWorkers,
					freeMemoryMegabytes: Math.round(freemem() / 1_048_576),
				}, config);

				if (decision.workers !== null) {
					// The readings the rule that decided actually looked at: the
					// two strategies filter the pool differently, and a line
					// printing the other one's list reads as a decision taken on
					// no numbers at all.
					const read = config.strategy === 'legacy'
						? legacyWorkers.map((worker) => worker.cpuPercent)
						: cpuPercents;

					logger.info(
						`[autoscale] ${config.appName} ${workers} -> ${decision.workers} `
						+ `workers: ${decision.reason}. cpu: ${read.join(',')}. `
						+ `restarts: ${[...reading.restartsByWorker.values()].join(',')}`,
					);

					if (decision.workers < workers) {
						await releaseWorkers(
							onlineWorkers,
							workers - decision.workers,
						);
					}
					else {
						await scaleApp(config.appName, decision.workers);
					}

					if (decision.workers > workers) {
						lastScaleUpAt = Date.now();
					}
					else {
						lastScaleDownAt = Date.now();
					}
				}
			}

			// Reported and not only logged: this process is not one an admin
			// request can reach, so the answer to what the pool is being scaled
			// on has to come from the tick that scaled it.
			recordAutoscaleTick({
				at: now,
				config,
				sources: resolvedSources(),
				withoutSharedSettings: resolvedWithoutSharedSettings(),
				workers: onlineWorkers.length,
				pendingWorkers,
				warmingWorkers,
				supervisor: reading.supervisor,
				reload: reloadState(),
				cpuPercents: config.strategy === 'legacy'
					? legacyWorkers.map((worker) => worker.cpuPercent)
					: cpuPercents,
				lastDecision: decision === null
					? null
					: { at: now, ...decision },
			});
		}
		catch (error) {
			logger.error(error, '[autoscale] a tick failed');
		}

		await new Promise((resolve) => {
			setTimeout(resolve, SAMPLE_INTERVAL_MS);
		});
	}
}
