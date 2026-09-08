import { useLogger } from '../logger/index.js';
import { decide } from './lib/decide.js';
import {
	connectToSupervisor,
	disconnectFromSupervisor,
	readPool,
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
	let restarts: number | null = null;
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

			// The first sample sets the baseline: whatever the supervisor has
			// counted before the autoscaler started is not a restart it saw.
			if (restarts !== null && reading.restarts > restarts) {
				lastRestartAt = Date.now();
			}

			restarts = reading.restarts;

			if (config.enabled && workers > 0 && prewarmed === false) {
				prewarmed = true;
				await prewarm(config, workers);
				lastScaleUpAt = Date.now();
				lastScaleDownAt = Date.now();
			}
			else if (config.enabled) {
				const now = Date.now();

				const decision = decide({
					cpuPercents,
					pendingWorkers,
					warmingWorkers,
					secondsSinceRestart: lastRestartAt === null
						? null
						: (now - lastRestartAt) / 1000,
					now,
					lastScaleUpAt,
					lastScaleDownAt,
				}, config);

				if (decision.workers !== null) {
					logger.info(
						`[autoscale] ${config.appName} ${workers} -> ${decision.workers} `
						+ `workers: ${decision.reason}. cpu: ${cpuPercents.join(',')}. `
						+ `restarts: ${reading.restarts}`,
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
