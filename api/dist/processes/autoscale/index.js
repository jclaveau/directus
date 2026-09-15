import { useLogger } from "../../logger/index.js";
import { connectToSupervisor, disconnectFromSupervisor, releaseWorker, scaleApp } from "../supervisor/lib/client.js";
import "../supervisor/index.js";
import { validateBooleanEnv } from "../../utils/validate-env.js";
import { reportPoolHealth } from "../lib/pool-health.js";
import { guardUnhandledRejections } from "../../utils/report-unhandled-rejection.js";
import { beginAskedReload, initAutoscaleReload, reloadState, reloading } from "./lib/reload.js";
import { initSharedSettingsMirror, resolveConfig, resolvedSources, resolvedWithoutSharedSettings } from "./lib/resolve-config.js";
import { recordAutoscaleTick } from "./lib/state.js";
import { initProcessReports } from "../lib/report-processes.js";
import "../index.js";
import { PROCESSES_BOOLEAN_ENV } from "../lib/boolean-env.js";
import { chooseVictims } from "./lib/choose-victims.js";
import { decide } from "./lib/decide.js";
import { inFlightOf, watchInFlightReports } from "./lib/in-flight.js";
import { PoolSamples } from "./lib/pool-samples.js";
import { readPool, restarted } from "./lib/pool.js";
import { WorkerCpu } from "./lib/worker-cpu.js";
import { LEGACY_SAMPLE_WINDOW } from "@directus/constants";
import { freemem } from "node:os";

//#region src/processes/autoscale/index.ts
/**
* How often the pool is sampled. The thresholds are what tuning should reach
* for.
*/
const SAMPLE_INTERVAL_MS = 1e3;
/**
* Brings the pool to `PM2_AUTOSCALE_PREWARM` in one step.
*
* A deploy restarts the pool at its floor, so the first requests after one
* land on a pool sized for an idle night. This is not the floor: the extra
* workers are released like any others once the load does not justify them,
* so a quiet deploy costs nothing lasting.
*/
async function prewarm(config, workers) {
	const target = Math.min(config.prewarmWorkers, config.maxWorkers);
	if (target <= workers) return null;
	useLogger().info(`[autoscale] prewarming ${config.appName} from ${workers} to ${target} workers`);
	await scaleApp(config.appName, target);
	return target;
}
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
* One at a time and awaited, so a release that the supervisor does not answer
* costs the workers after it rather than the pool's whole shape.
*/
async function releaseWorkers(pool, count) {
	const candidates = pool.map((worker) => {
		return {
			pmId: worker.pmId,
			inFlight: inFlightOf(worker.pmId)
		};
	});
	for (const pmId of chooseVictims(candidates, count)) await releaseWorker(pmId);
}
/**
* The size the pool is meant to be serving with once it is up.
*
* The prewarm where one is asked for, because that is the whole of what it
* asks: be this big before the deployment takes traffic. The floor otherwise,
* and the floor too where scaling is off, since prewarm is one of the things
* that does not run then.
*/
function targetPoolSize(config) {
	if (config.enabled === false) return config.minWorkers;
	return Math.min(Math.max(config.minWorkers, config.prewarmWorkers), config.maxWorkers);
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
function announceFailedWorkers(failed, online) {
	if (failed === lastFailedWorkers) return;
	const logger = useLogger();
	if (failed > 0) logger.error(`[autoscale] the supervisor could not keep ${failed} worker(s) running; the pool is serving with ${online}`);
	else logger.info(`[autoscale] the pool is whole again, at ${online} worker(s)`);
	lastFailedWorkers = failed;
}
/**
* Watches one pm2 app and resizes it.
*
* Runs as its own process beside the app it scales, so the decision survives
* any single worker and no worker ever scales itself.
*/
async function runAutoscaler() {
	const logger = useLogger();
	validateBooleanEnv(PROCESSES_BOOLEAN_ENV);
	guardUnhandledRejections();
	watchInFlightReports();
	await connectToSupervisor();
	initProcessReports().catch((error) => {
		logger.warn(error, "[autoscale] could not answer processes queries");
	});
	initAutoscaleReload();
	await initSharedSettingsMirror();
	const stop = () => {
		disconnectFromSupervisor();
		process.exit(0);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	let lastScaleUpAt = Date.now();
	let lastScaleDownAt = Date.now();
	let prewarmed = false;
	let restartsByWorker = null;
	let lastRestartAt = null;
	const samples = new PoolSamples();
	const cpu = new WorkerCpu();
	for (;;) {
		try {
			const config = resolveConfig();
			const reading = await readPool(config.appName, config.warmupSeconds);
			const { pendingWorkers, warmingWorkers } = reading;
			const onlineWorkers = cpu.measure(reading.onlineWorkers);
			const workers = onlineWorkers.length + pendingWorkers;
			beginAskedReload(config.appName, workers);
			if (reloading() === false) {
				reportPoolHealth({
					failedWorkers: reading.failedWorkers,
					onlineWorkers: onlineWorkers.length,
					targetWorkers: targetPoolSize(config)
				});
				announceFailedWorkers(reading.failedWorkers, onlineWorkers.length);
			}
			const carriesRestarts = [...reading.restartsByWorker.values()].some((count) => count > 0);
			if (restartsByWorker === null ? carriesRestarts : restarted(restartsByWorker, reading.restartsByWorker)) lastRestartAt = Date.now();
			restartsByWorker = reading.restartsByWorker;
			const observed = samples.observe(onlineWorkers);
			const smoothed = samples.averaged(config.sampleWindow, true);
			const legacy = samples.averaged(LEGACY_SAMPLE_WINDOW, false);
			const cpuPercents = onlineWorkers.filter((worker) => worker.mature).map((worker) => smoothed.get(worker.pid)?.cpuPercent ?? 0);
			const legacyWorkers = onlineWorkers.map((worker) => {
				return legacy.get(worker.pid) ?? {
					cpuPercent: worker.cpuPercent,
					memoryMegabytes: 0
				};
			});
			if (config.strategy === "legacy") {
				if (observed.appeared) lastScaleUpAt = Date.now();
				if (observed.vanished) lastScaleDownAt = Date.now();
			}
			const now = Date.now();
			const secondsSinceRestart = lastRestartAt === null ? null : (now - lastRestartAt) / 1e3;
			const churning = secondsSinceRestart !== null && secondsSinceRestart < config.warmupSeconds;
			const readyToPrewarm = config.enabled && config.strategy !== "legacy" && workers > 0 && churning === false && carriesRestarts === false && prewarmed === false && reloading() === false;
			let decision = null;
			if (readyToPrewarm) {
				prewarmed = true;
				const target = await prewarm(config, workers);
				lastScaleUpAt = Date.now();
				lastScaleDownAt = Date.now();
				if (target !== null) decision = {
					workers: target,
					reason: "prewarming the pool"
				};
			} else if (config.enabled && reloading() === false) {
				decision = decide({
					cpuPercents,
					pendingWorkers,
					warmingWorkers,
					secondsSinceRestart,
					now,
					lastScaleUpAt,
					lastScaleDownAt,
					legacyWorkers,
					freeMemoryMegabytes: Math.round(freemem() / 1048576)
				}, config);
				if (decision.workers !== null) {
					const read = config.strategy === "legacy" ? legacyWorkers.map((worker) => worker.cpuPercent) : cpuPercents;
					logger.info(`[autoscale] ${config.appName} ${workers} -> ${decision.workers} workers: ${decision.reason}. cpu: ${read.join(",")}. restarts: ${[...reading.restartsByWorker.values()].join(",")}`);
					if (decision.workers < workers) await releaseWorkers(onlineWorkers, workers - decision.workers);
					else await scaleApp(config.appName, decision.workers);
					if (decision.workers > workers) lastScaleUpAt = Date.now();
					else lastScaleDownAt = Date.now();
				}
			}
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
				cpuPercents: config.strategy === "legacy" ? legacyWorkers.map((worker) => worker.cpuPercent) : cpuPercents,
				lastDecision: decision === null ? null : {
					at: now,
					...decision
				}
			});
		} catch (error) {
			logger.error(error, "[autoscale] a tick failed");
		}
		await new Promise((resolve) => {
			setTimeout(resolve, SAMPLE_INTERVAL_MS);
		});
	}
}

//#endregion
export { runAutoscaler, targetPoolSize };