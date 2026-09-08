import type { AutoscaleConfig, Decision, PoolSample } from '../types.js';

function statistic(cpuPercents: number[], config: AutoscaleConfig): number {
	if (config.signal === 'max') {
		return Math.max(...cpuPercents);
	}

	const total = cpuPercents.reduce((sum, percent) => sum + percent, 0);

	return Math.round(total / cpuPercents.length);
}

function secondsSince(instant: number, now: number): number {
	return (now - instant) / 1000;
}

/**
 * The pool size this sample calls for, or `null` to leave it alone.
 *
 * Pure, so the rule can be exercised without a supervisor: everything it
 * reads arrives in the sample, including the clock.
 *
 * Scaling up and scaling down are asked independently. Upstream
 * pm2-autoscale nests the release test in the `else` of the scale-up test,
 * so a pool whose signal sits above the threshold cannot shrink even once
 * it has run out of ceiling — it can only stop growing.
 */
export function decide(sample: PoolSample, config: AutoscaleConfig): Decision {
	const workers = sample.cpuPercents.length
		+ sample.pendingWorkers
		+ sample.warmingWorkers;

	if (config.enabled === false) {
		return { workers: null, reason: 'autoscaling is disabled' };
	}

	// A pool with nothing in it is not a pool below its floor: the app is
	// gone, or has not started yet, and pm2 answers a scale on a name it does
	// not know with an error. Restarting workers is the supervisor's job.
	if (workers === 0) {
		return { workers: null, reason: 'no workers of that app' };
	}

	// Bounds first: a pool outside them is corrected whatever the load says,
	// so a lowered ceiling takes effect rather than waiting for the load to
	// drop.
	if (workers > config.maxWorkers) {
		return {
			workers: config.maxWorkers,
			reason: `above the ceiling of ${config.maxWorkers}`,
		};
	}

	if (workers < config.minWorkers) {
		return {
			workers: config.minWorkers,
			reason: `below the floor of ${config.minWorkers}`,
		};
	}

	// A pool that is restarting is broken, not busy, and through a CPU average
	// the two look identical. Adding a worker to a crash loop cannot relieve
	// it and provably multiplies it: on 2026-09-08 a heap cap crash-looped the
	// planner's Api and each restart's boot CPU bought another worker that
	// died the same way, until the container did.
	//
	// Frozen in both directions. Releasing would be acting on the same
	// untrustworthy reading, and a restart is just as likely to be a healthy
	// recycle under load as a crash.
	if (
		sample.secondsSinceRestart !== null
		&& sample.secondsSinceRestart < config.warmupSeconds
	) {
		const ago = Math.round(sample.secondsSinceRestart);

		return { workers: null, reason: `a worker restarted ${ago}s ago` };
	}

	// A booting worker spends its whole startup at the top of the CPU table,
	// so a pool with one in flight would read as loaded and add another on
	// top of it — each add paying for the next. Nothing moves until the pool
	// is whole again.
	if (sample.pendingWorkers > 0) {
		return {
			workers: null,
			reason: `${sample.pendingWorkers} worker(s) still starting`,
		};
	}

	// Every worker is inside its warm-up, so the pool has told us nothing.
	// Without this the empty statistic reads as 0% and releases a worker.
	if (sample.cpuPercents.length === 0) {
		return {
			workers: null,
			reason: `${sample.warmingWorkers} worker(s) still warming up`,
		};
	}

	const cpu = statistic(sample.cpuPercents, config);

	if (cpu >= config.scaleCpuThreshold && workers < config.maxWorkers) {
		const waited = secondsSince(sample.lastScaleUpAt, sample.now);

		// Ready is not warm: a worker that has just started listening still
		// has a cold schema cache and an unJITted hot path. The settle window
		// covers the stretch where its CPU is elevated by its own youth.
		if (waited < config.minSecondsToScaleUp) {
			const left = Math.round(config.minSecondsToScaleUp - waited);

			return {
				workers: null,
				reason: `${cpu}% needs a worker, ${left}s of settling left`,
			};
		}

		return {
			workers: workers + 1,
			reason: `${config.signal} cpu ${cpu}% >= ${config.scaleCpuThreshold}%`,
		};
	}

	if (cpu < config.releaseCpuThreshold && workers > config.minWorkers) {
		const waited = secondsSince(sample.lastScaleDownAt, sample.now);

		if (waited < config.minSecondsToScaleDown) {
			const left = Math.round(config.minSecondsToScaleDown - waited);

			return {
				workers: null,
				reason: `${cpu}% releases a worker, ${left}s of cooldown left`,
			};
		}

		return {
			workers: workers - 1,
			reason: `${config.signal} cpu ${cpu}% < ${config.releaseCpuThreshold}%`,
		};
	}

	return {
		workers: null,
		reason: `${config.signal} cpu ${cpu}% is within the band`,
	};
}
