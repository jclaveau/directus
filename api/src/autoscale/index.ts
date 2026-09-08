import { useLogger } from '../logger/index.js';
import { decide } from './lib/decide.js';
import {
	connectToSupervisor,
	disconnectFromSupervisor,
	readPool,
	restarted,
	scaleTo,
} from './lib/pool.js';
import { resolveConfig } from './lib/resolve-config.js';
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

	await connectToSupervisor();

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

	for (;;) {
		// A tick that throws is a tick that was skipped, never the end of the
		// autoscaler: it would leave the pool frozen at whatever size the
		// failure caught it in, and a pool that cannot shrink is how the
		// module this replaces took production down.
		try {
			const config = await resolveConfig();
			const reading = await readPool(config.appName, config.warmupSeconds);
			const { cpuPercents, pendingWorkers, warmingWorkers } = reading;
			const workers = cpuPercents.length + pendingWorkers + warmingWorkers;

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
				}, config);

				if (decision.workers !== null) {
					logger.info(
						`[autoscale] ${config.appName} ${workers} -> ${decision.workers} `
						+ `workers: ${decision.reason}. cpu: ${cpuPercents.join(',')}. `
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
