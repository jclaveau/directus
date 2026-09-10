import { LEGACY_SAMPLE_WINDOW } from '@directus/constants';
import type { LegacyWorkerSample } from '../types.js';
import type { OnlineWorker } from './pool.js';

const BYTES_PER_MEGABYTE = 1_048_576;

/** The deepest window either strategy asks for, so one ring holds both. */
const RING_DEPTH = LEGACY_SAMPLE_WINDOW;

interface Sample {
	cpuPercent: number;
	memoryMegabytes: number;
	/** Whether the worker was past its warm-up when this was taken. */
	mature: boolean;
}

function megabytesOf(worker: OnlineWorker): number {
	return Math.round(worker.memoryBytes / BYTES_PER_MEGABYTE);
}

function mean(values: number[]): number {
	return Math.round(
		values.reduce((sum, value) => sum + value, 0) / values.length,
	);
}

/** What one observation says about the pool beyond its numbers. */
export interface PoolObservation {
	/** A pid the pool did not have before, which paces the next add. */
	appeared: boolean;
	/** A pid the pool no longer has, which paces the next release. */
	vanished: boolean;
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
export class PoolSamples {
	private history = new Map<number, Sample[]>();

	observe(workers: OnlineWorker[]): PoolObservation {
		const seen = new Set<number>();
		let appeared = false;

		for (const worker of workers) {
			seen.add(worker.pid);

			const sample = {
				cpuPercent: worker.cpuPercent,
				memoryMegabytes: megabytesOf(worker),
				mature: worker.mature,
			};

			const known = this.history.get(worker.pid);

			if (known === undefined) {
				appeared = true;
				this.history.set(worker.pid, [sample]);
				continue;
			}

			this.history.set(
				worker.pid,
				[sample, ...known].slice(0, RING_DEPTH),
			);
		}

		let vanished = false;

		for (const pid of this.history.keys()) {
			if (seen.has(pid) === false) {
				vanished = true;
				this.history.delete(pid);
			}
		}

		return { appeared, vanished };
	}

	/**
	 * Each worker's last `window` samples, averaged, by pid.
	 *
	 * `matureOnly` drops what a worker reported while it was still warming up,
	 * which is the reason it was held out of the statistic at the time:
	 * averaging those back in hands a worker its own boot for another window's
	 * worth of ticks after it was declared warm.
	 */
	averaged(
		window: number,
		matureOnly: boolean,
	): Map<number, LegacyWorkerSample> {
		const averages = new Map<number, LegacyWorkerSample>();

		for (const [pid, samples] of this.history) {
			const usable = (matureOnly
				? samples.filter((sample) => sample.mature)
				: samples
			).slice(0, window);

			if (usable.length === 0) {
				continue;
			}

			averages.set(pid, {
				cpuPercent: mean(usable.map((sample) => sample.cpuPercent)),
				memoryMegabytes: mean(usable.map((sample) => sample.memoryMegabytes)),
			});
		}

		return averages;
	}
}
