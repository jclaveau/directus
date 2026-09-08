import { freemem } from 'node:os';
import { useLogger } from '../logger/index.js';
import { initProcessReports } from '../processes/index.js';
import { reportUnhandledRejection } from '../utils/report-unhandled-rejection.js';
import { decide } from './lib/decide.js';
import { PoolSamples } from './lib/pool-samples.js';
import {
	connectToSupervisor,
	disconnectFromSupervisor,
	readPool,
	restarted,
	scaleTo,
} from './lib/pool.js';
import { resolveConfig } from './lib/resolve-config.js';
import { LEGACY_SAMPLE_WINDOW } from './lib/sanitize-config.js';
import type { AutoscaleConfig } from './types.js';

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
): Promise<void> {
	const target = Math.min(config.prewarmWorkers, config.maxWorkers);

	if (target <= workers) {
		return;
	}

	useLogger().info(
		`[autoscale] prewarming ${config.appName} `
		+ `from ${workers} to ${target} workers`,
	);

	await scaleTo(config.appName, target);
}

/**
 * Watches one pm2 app and resizes it.
 *
 * Runs as its own process beside the app it scales, so the decision survives
 * any single worker and no worker ever scales itself.
 */
export async function runAutoscaler(): Promise<void> {
	const logger = useLogger();

	// This command outlives the pool it manages, so it takes the guard the server
	// process takes and for the same reason: Node ends a process on a rejection
	// nothing awaited, and an unreachable Redis produces them from the bus
	// subscriber and from commands its own caller has already given up on. An
	// autoscaler that exits leaves the pool at whatever size the outage caught it
	// at, and its supervisor restarts it into the same outage.
	process.on('unhandledRejection', reportUnhandledRejection);

	await connectToSupervisor();

	// The supervisor lists this process like any other, and the processes report
	// is built on that list — so without a self-report of its own the autoscaler
	// shows up on the Processes page as a worker that never answers, which is
	// what that page means by a worker crash-looping too fast to reply. It
	// describes itself for the same reason every worker does.
	//
	// Never a reason not to scale: a pool left unmanaged because its autoscaler
	// could not introduce itself would be a far worse trade than an unexplained
	// row on a page.
	try {
		await initProcessReports();
	}
	catch (error) {
		logger.warn(error, '[autoscale] could not answer processes queries');
	}

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

	for (;;) {
		// A tick that throws is a tick that was skipped, never the end of the
		// autoscaler: it would leave the pool frozen at whatever size the
		// failure caught it in, and a pool that cannot shrink is how the
		// module this replaces took production down.
		try {
			const config = await resolveConfig();
			const reading = await readPool(config.appName, config.warmupSeconds);
			const { onlineWorkers, pendingWorkers, warmingWorkers } = reading;
			const workers = onlineWorkers.length + pendingWorkers;

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
				&& prewarmed === false;

			if (readyToPrewarm) {
				prewarmed = true;
				await prewarm(config, workers);
				lastScaleUpAt = Date.now();
				lastScaleDownAt = Date.now();
			}
			else if (config.enabled) {

				const decision = decide({
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

					await scaleTo(config.appName, decision.workers);

					if (decision.workers > workers) {
						lastScaleUpAt = Date.now();
					}
					else {
						lastScaleDownAt = Date.now();
					}
				}
			}
		}
		catch (error) {
			logger.error(error, '[autoscale] a tick failed');
		}

		await new Promise((resolve) => {
			setTimeout(resolve, SAMPLE_INTERVAL_MS);
		});
	}
}
