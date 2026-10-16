import { LEGACY_SAMPLE_WINDOW } from "@directus/constants";

//#region src/processes/autoscale/lib/pool-samples.ts
const BYTES_PER_MEGABYTE = 1048576;
/** The deepest window either strategy asks for, so one ring holds both. */
const RING_DEPTH = LEGACY_SAMPLE_WINDOW;
function megabytesOf(worker) {
	return Math.round(worker.memoryBytes / BYTES_PER_MEGABYTE);
}
function mean(values) {
	return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
/**
* The rolling window both strategies decide on.
*
* A pool's CPU is read once a second off a supervisor sampling processes that
* spend their time in bursts, so any single reading is as much sampling as
* load: acted on alone it buys a worker for one busy second, and gives one
* back for one quiet second in a pool that is loaded. Both rules average
* instead, over their own window and out of one ring, so switching strategy
* mid-incident decides on samples already taken.
*
* Keyed by pid rather than by pm id: a restarted worker keeps its pm id and
* takes a new pid, and its history is exactly what should not carry over — the
* numbers belong to a process that is gone.
*/
var PoolSamples = class {
	history = /* @__PURE__ */ new Map();
	observe(workers) {
		const seen = /* @__PURE__ */ new Set();
		let appeared = false;
		for (const worker of workers) {
			seen.add(worker.pid);
			const sample = {
				cpuPercent: worker.cpuPercent,
				memoryMegabytes: megabytesOf(worker),
				mature: worker.mature
			};
			const known = this.history.get(worker.pid);
			if (known === void 0) {
				appeared = true;
				this.history.set(worker.pid, [sample]);
				continue;
			}
			this.history.set(worker.pid, [sample, ...known].slice(0, RING_DEPTH));
		}
		let vanished = false;
		for (const pid of this.history.keys()) if (seen.has(pid) === false) {
			vanished = true;
			this.history.delete(pid);
		}
		return {
			appeared,
			vanished
		};
	}
	/**
	* Each worker's last `window` samples, averaged, by pid.
	*
	* `matureOnly` drops what a worker reported while it was still warming up,
	* which is the reason it was held out of the statistic at the time:
	* averaging those back in hands a worker its own boot for another window's
	* worth of ticks after it was declared warm.
	*/
	averaged(window, matureOnly) {
		const averages = /* @__PURE__ */ new Map();
		for (const [pid, samples] of this.history) {
			const usable = (matureOnly ? samples.filter((sample) => sample.mature) : samples).slice(0, window);
			if (usable.length === 0) continue;
			averages.set(pid, {
				cpuPercent: mean(usable.map((sample) => sample.cpuPercent)),
				memoryMegabytes: mean(usable.map((sample) => sample.memoryMegabytes))
			});
		}
		return averages;
	}
};

//#endregion
export { PoolSamples };