import { useLogger } from "../../../logger/index.js";
import { useBus } from "../../../bus/lib/use-bus.js";
import "../../../bus/index.js";
import { useEnv } from "@directus/env";

//#region src/processes/autoscale/lib/drill.ts
/**
* The channel a drill is announced on.
*
* A request reaches one worker, and one busy worker moves nothing the
* autoscaler reads: it judges the pool, not a member of it. So the drill is
* broadcast and every worker runs its own — which is the shape real load has,
* since the supervisor spreads connections across the pool too.
*/
const DRILL_CHANNEL = "autoscaleDrill";
/** The longest a drill may run, in seconds. */
const MAX_DRILL_SECONDS = 120;
/** The least of a slice a drilling worker spends busy, as a percentage. */
const MIN_DRILL_PERCENT = 10;
/**
* The most of it.
*
* Short of the whole slice on purpose: a worker that never yields answers no
* request, and a drill that takes the deployment down measures nothing. The
* gap is what `/server/health` and the drill's own stop are answered in.
*/
const MAX_DRILL_PERCENT = 95;
/**
* How long one busy/idle cycle takes.
*
* Short enough that a request arriving mid-slice waits less than it, long
* enough that the yield between slices is not most of the cycle.
*/
const SLICE_MS = 100;
/** How often a running drill is announced again, in milliseconds. */
const REBROADCAST_MS = 1e3;
let deadline = 0;
let percent = MIN_DRILL_PERCENT;
let burning = false;
let rebroadcast = null;
/**
* Whether this deployment carries the drill at all.
*
* Off by default: it is a lever that deliberately makes a production pool
* grow, so a deployment has to say that it wants one before the route exists.
*/
function autoscaleDrillEnabled() {
	return useEnv()["PM2_AUTOSCALE_DRILL_ENABLED"] === true;
}
/** The share of a slice a worker may be asked to burn, whatever was asked. */
function clampPercent(share) {
	const parsed = Number(share);
	if (Number.isFinite(parsed) === false) return MIN_DRILL_PERCENT;
	return Math.min(MAX_DRILL_PERCENT, Math.max(MIN_DRILL_PERCENT, Math.round(parsed)));
}
/**
* When a drill announced to run until `until` actually ends.
*
* The cap is applied by the worker that will burn rather than only by the one
* that was asked, because a stop is a message and a message can be lost — this
* deadline is the only thing certain to end the drill.
*/
function cappedDeadline(until, now) {
	const asked = Number(until);
	if (Number.isFinite(asked) === false) return 0;
	return Math.min(asked, now + MAX_DRILL_SECONDS * 1e3);
}
/** What this worker is burning, `until` being `null` where it burns nothing. */
function drillState() {
	return {
		until: deadline > Date.now() ? deadline : null,
		percent
	};
}
/**
* Hold the processor for a share of every slice until the deadline runs out.
*
* A tight loop is the point rather than a shortcut: the autoscaler reads each
* worker's CPU off `/proc` over a window it owns, so the only thing that moves
* its signal is a worker actually holding the processor.
*/
async function burn() {
	if (burning) return;
	burning = true;
	try {
		while (Date.now() < deadline) {
			const busyMs = Math.round(SLICE_MS * percent / 100);
			const busyUntil = Date.now() + busyMs;
			while (Date.now() < busyUntil);
			await new Promise((resolve) => {
				setTimeout(resolve, SLICE_MS - busyMs);
			});
		}
	} finally {
		burning = false;
	}
}
function announced({ until, percent: share }) {
	const now = Date.now();
	deadline = cappedDeadline(until, now);
	percent = clampPercent(share);
	if (deadline <= now) stopRebroadcast();
	if (burning === false && deadline > now) useLogger().info(`[autoscale] load drill: ${percent}% of this worker for ${Math.round((deadline - now) / 1e3)}s`);
	burn();
}
/**
* Listen for drills.
*
* Subscribing is what actually gates the feature: a worker of a deployment
* that did not ask for the drill ignores an announcement reaching it over a
* Redis two deployments share.
*/
function initAutoscaleDrill() {
	if (autoscaleDrillEnabled() === false) return;
	useBus().subscribe(DRILL_CHANNEL, announced);
}
function stopRebroadcast() {
	if (rebroadcast !== null) {
		clearInterval(rebroadcast);
		rebroadcast = null;
	}
}
/** Announce a drill to the pool, and keep announcing it while it runs. */
function startDrill(seconds, share) {
	const until = Date.now() + seconds * 1e3;
	const announcement = {
		until,
		percent: clampPercent(share)
	};
	stopRebroadcast();
	useBus().publish(DRILL_CHANNEL, announcement);
	rebroadcast = setInterval(() => {
		if (Date.now() >= until) {
			stopRebroadcast();
			return;
		}
		useBus().publish(DRILL_CHANNEL, announcement);
	}, REBROADCAST_MS);
	rebroadcast.unref();
	return {
		until,
		percent: announcement.percent
	};
}
/** Call the pool off, whether or not this worker is the one that started it. */
function stopDrill() {
	stopRebroadcast();
	useBus().publish(DRILL_CHANNEL, {
		until: 0,
		percent
	});
	return {
		until: null,
		percent
	};
}
/**
* The hottest worker of a pool that is already working, `null` where none is.
*
* A drill run over real traffic measures the traffic and the drill together,
* and the workers it buys are ones nobody chose to buy. The loop's own release
* threshold is what it means by a worker that is not busy, so it is what
* "already working" is read against here.
*/
function loadedWorker(runners) {
	let hottest = null;
	for (const runner of runners) for (const cpu of runner.state.cpuPercents) if (cpu >= runner.state.config.releaseCpuThreshold) hottest = Math.max(hottest ?? 0, cpu);
	return hottest;
}

//#endregion
export { MAX_DRILL_PERCENT, MAX_DRILL_SECONDS, MIN_DRILL_PERCENT, autoscaleDrillEnabled, cappedDeadline, clampPercent, drillState, initAutoscaleDrill, loadedWorker, startDrill, stopDrill };