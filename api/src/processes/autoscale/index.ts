import { freemem } from 'node:os';
import { LEGACY_SAMPLE_WINDOW } from '@directus/constants';
import { useLogger } from '../../logger/index.js';
import { initProcessReports } from '../index.js';
import {
	connectToSupervisor,
	disconnectFromSupervisor,
	scaleApp,
} from '../supervisor/index.js';
import { guardUnhandledRejections } from '../../utils/report-unhandled-rejection.js';
import { validateBooleanEnv } from '../../utils/validate-env.js';
import { PROCESSES_BOOLEAN_ENV } from '../lib/boolean-env.js';
import { decide } from './lib/decide.js';
import { PoolSamples } from './lib/pool-samples.js';
import { readPool, restarted } from './lib/pool.js';
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
import type { AutoscaleConfig, Decision } from './types.js';

/**
 * How often the pool is sampled. The thresholds are what tuning should reach
 * for.
 */
const SAMPLE_INTERVAL_MS = 1000;

/**
 * Brings the pool to `PM2_AUTOSCALE_PREWARM` in one step.
 *
 * A deploy restarts the pool at its floor, so the first requests after one
 * land on a pool sized for an idle night. This is not the floor: the extra
 * workers are released like any others once the load does not justify them,
 * so a quiet deploy costs nothing lasting.
 */
async function prewarm(
	config: AutoscaleConfig,
	workers: number,
): Promise<number | null> {
	const target = Math.min(config.prewarmWorkers, config.maxWorkers);

	if (target <= workers) {
		return null;
	}

	useLogger().info(
		`[autoscale] prewarming ${config.appName} `
		+ `from ${workers} to ${target} workers`,
	);

	await scaleApp(config.appName, target);

	return target;
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

			beginAskedReload(config.appName, workers);

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
			// of workers to crash.
			const readyToPrewarm = config.enabled
				&& config.strategy !== 'legacy'
				&& workers > 0
				&& churning === false
				&& carriesRestarts === false
				&& prewarmed === false
				&& reloading() === false;

			let decision: Decision | null = null;

			if (readyToPrewarm) {
				prewarmed = true;
				const target = await prewarm(config, workers);
				lastScaleUpAt = Date.now();
				lastScaleDownAt = Date.now();

				if (target !== null) {
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

					await scaleApp(config.appName, decision.workers);

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
