import type { LegacyWorkerSample } from '../types.js';
import type { OnlineWorker } from './pool.js';

const BYTES_PER_MEGABYTE = 1_048_576;

/**
 * How many samples the `legacy` strategy averages a worker over.
 *
 * Its thresholds are calibrated against a mean of the last thirty seconds,
 * not against an instantaneous reading: a worker answering one heavy request
 * clears any threshold for a moment, and a rule reading that moment grows the
 * pool on a spike that is over before the worker has finished booting.
 */
export const LEGACY_SAMPLE_WINDOW = 30;

interface WorkerHistory {
	cpuPercents: number[];
	memoryMegabytes: number[];
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
export interface LegacyObservation {
	workers: LegacyWorkerSample[];
	/** A pid the pool did not have before, which paces the next add. */
	appeared: boolean;
	/** A pid the pool no longer has, which paces the next release. */
	vanished: boolean;
}

/**
 * The rolling window the `legacy` strategy decides on.
 *
 * Keyed by pid rather than by pm id: a restarted worker keeps its pm id and
 * takes a new pid, and its history is exactly what should not carry over —
 * the numbers belong to a process that is gone. That the window empties on a
 * restart is also all the protection the rule has against a crash loop, which
 * is why `scalabus` freezes on one outright.
 */
export class LegacySamples {
	private history = new Map<number, WorkerHistory>();

	observe(workers: OnlineWorker[]): LegacyObservation {
		const seen = new Set<number>();
		let appeared = false;

		for (const worker of workers) {
			seen.add(worker.pid);
			const known = this.history.get(worker.pid);

			if (known === undefined) {
				appeared = true;

				this.history.set(worker.pid, {
					cpuPercents: [worker.cpuPercent],
					memoryMegabytes: [megabytesOf(worker)],
				});

				continue;
			}

			known.cpuPercents = [worker.cpuPercent, ...known.cpuPercents]
				.slice(0, LEGACY_SAMPLE_WINDOW);

			known.memoryMegabytes = [megabytesOf(worker), ...known.memoryMegabytes]
				.slice(0, LEGACY_SAMPLE_WINDOW);
		}

		let vanished = false;

		for (const pid of this.history.keys()) {
			if (seen.has(pid) === false) {
				vanished = true;
				this.history.delete(pid);
			}
		}

		return {
			workers: workers.map((worker) => {
				const known = this.history.get(worker.pid)!;

				return {
					cpuPercent: mean(known.cpuPercents),
					memoryMegabytes: mean(known.memoryMegabytes),
				};
			}),
			appeared,
			vanished,
		};
	}
}
