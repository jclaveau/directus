//#region src/processes/autoscale/lib/decide.ts
function statistic(cpuPercents, config) {
	if (config.signal === "max") return Math.max(...cpuPercents);
	return average(cpuPercents);
}
function secondsSince(instant, now) {
	return (now - instant) / 1e3;
}
/** Seconds since `instant`, rounded the way the `legacy` strategy rounds them. */
function wholeSecondsSince(instant, now) {
	return Math.round((now - instant) / 1e3);
}
function averageOver(values, workers) {
	return Math.round(values.reduce((sum, value) => sum + value, 0) / workers);
}
function average(values) {
	return averageOver(values, values.length);
}
/**
* The pool size this sample calls for, or `null` to leave it alone.
*
* Pure, so the rule can be exercised without a supervisor: everything it
* reads arrives in the sample, including the clock.
*/
function decide(sample, config) {
	if (config.enabled === false) return {
		workers: null,
		reason: "autoscaling is disabled"
	};
	return config.strategy === "legacy" ? decideLegacy(sample, config) : decideScalabus(sample, config);
}
/**
* The rule of the `pm2-autoscale` module this replaces, so reverting to it
* costs one Redis write rather than a redeploy.
*
* Reproduced from its 1.4.0 sources down to the comparisons that look like
* slips — a rounded second, a strict `>` on both cooldowns, `>=` to grow and
* `<` to shrink — because the point of having it is that it decides what
* production already decided, and anything tidied is a difference nobody
* asked for at the moment they most need there to be none.
*
* The release test sits in the `else` of the growth test, so a pool whose
* hottest worker clears the threshold cannot shrink even once it has run out
* of ceiling. Its counterpart above is asked independently.
*
* Two knowing departures, both from the loop rather than the rule: the
* cooldown clocks start when the autoscaler does rather than at zero, so the
* first release waits one full cooldown instead of firing on the first tick;
* and the configuration comes from this autoscaler's own chain, which has no
* `max_workers: 'max'` and clamps what it is given.
*/
function decideLegacy(sample, config) {
	const workers = sample.legacyWorkers.length;
	if (workers === 0) return {
		workers: null,
		reason: "no workers of that app"
	};
	const cpuPercents = sample.legacyWorkers.map((worker) => worker.cpuPercent);
	const maxCpu = Math.max(...cpuPercents);
	const averageCpu = average(cpuPercents);
	if (maxCpu >= config.scaleCpuThreshold && workers < config.maxWorkers) {
		const perWorker = average(sample.legacyWorkers.map((worker) => worker.memoryMegabytes));
		if (sample.freeMemoryMegabytes - perWorker <= 0) return {
			workers: null,
			reason: `${sample.freeMemoryMegabytes}MB free will not hold another ${perWorker}MB worker`
		};
		const waited = wholeSecondsSince(sample.lastScaleUpAt, sample.now);
		if (waited <= config.minSecondsToScaleUp) return {
			workers: null,
			reason: `max cpu ${maxCpu}% needs a worker, ${config.minSecondsToScaleUp - waited}s of settling left`
		};
		return {
			workers: workers + sample.pendingWorkers + 1,
			reason: `max cpu ${maxCpu}% >= ${config.scaleCpuThreshold}%`
		};
	}
	if (averageCpu < config.releaseCpuThreshold && workers > config.minWorkers) {
		const waited = wholeSecondsSince(sample.lastScaleDownAt, sample.now);
		if (waited <= config.minSecondsToScaleDown) return {
			workers: null,
			reason: `average cpu ${averageCpu}% releases a worker, ${config.minSecondsToScaleDown - waited}s of cooldown left`
		};
		return {
			workers: workers - 1,
			reason: `average cpu ${averageCpu}% < ${config.releaseCpuThreshold}%`
		};
	}
	return {
		workers: null,
		reason: `max cpu ${maxCpu}%, average ${averageCpu}%, is within the band`
	};
}
function decideScalabus(sample, config) {
	const workers = sample.cpuPercents.length + sample.pendingWorkers + sample.warmingWorkers;
	if (workers === 0) return {
		workers: null,
		reason: "no workers of that app"
	};
	if (workers > config.maxWorkers) return {
		workers: config.maxWorkers,
		reason: `above the ceiling of ${config.maxWorkers}`
	};
	if (workers < config.minWorkers) return {
		workers: config.minWorkers,
		reason: `below the floor of ${config.minWorkers}`
	};
	if (sample.secondsSinceRestart !== null && sample.secondsSinceRestart < config.warmupSeconds) return {
		workers: null,
		reason: `a worker restarted ${Math.round(sample.secondsSinceRestart)}s ago`
	};
	if (sample.pendingWorkers > 0) return {
		workers: null,
		reason: `${sample.pendingWorkers} worker(s) still starting`
	};
	if (sample.cpuPercents.length === 0) return {
		workers: null,
		reason: `${sample.warmingWorkers} worker(s) still warming up`
	};
	const cpu = statistic(sample.cpuPercents, config);
	if (cpu >= config.scaleCpuThreshold && workers < config.maxWorkers) {
		const waited = secondsSince(sample.lastScaleUpAt, sample.now);
		if (waited < config.minSecondsToScaleUp) return {
			workers: null,
			reason: `${cpu}% needs a worker, ${Math.round(config.minSecondsToScaleUp - waited)}s of settling left`
		};
		return {
			workers: workers + 1,
			reason: `${config.signal} cpu ${cpu}% >= ${config.scaleCpuThreshold}%`
		};
	}
	if (workers > config.minWorkers) {
		if (sample.warmingWorkers > 0) return {
			workers: null,
			reason: `${sample.warmingWorkers} worker(s) still warming up`
		};
		const survivors = workers - 1;
		const projectedCpu = averageOver(sample.cpuPercents, survivors);
		if (projectedCpu < config.releaseCpuThreshold) {
			const waited = secondsSince(Math.max(sample.lastScaleUpAt, sample.lastScaleDownAt), sample.now);
			if (waited < config.minSecondsToScaleDown) return {
				workers: null,
				reason: `${projectedCpu}% releases a worker, ${Math.round(config.minSecondsToScaleDown - waited)}s of cooldown left`
			};
			return {
				workers: survivors,
				reason: `cpu ${projectedCpu}% across the ${survivors} worker(s) a release leaves < ${config.releaseCpuThreshold}%`
			};
		}
	}
	return {
		workers: null,
		reason: `${config.signal} cpu ${cpu}% is within the band`
	};
}

//#endregion
export { decide };