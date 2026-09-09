import { readFileSync } from 'node:fs';
import type { OnlineWorker } from './pool.js';

/** The unit `/proc` counts CPU time in: `sysconf(_SC_CLK_TCK)`, 100 on Linux. */
const CLOCK_TICKS_PER_SECOND = 100;

/** What one worker's `/proc` entry says about the CPU it has spent. */
interface ProcessTimes {
	cpuSeconds: number;
	aliveSeconds: number;
}

function uptimeSeconds(): number | null {
	try {
		const uptime = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);

		return Number.isFinite(uptime)
			? uptime
			: null;
	}
	catch {
		return null;
	}
}

function timesOf(pid: number, uptime: number): ProcessTimes | null {
	let stat: string;

	try {
		stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
	}
	catch {
		return null;
	}

	// The second field is the executable name, unquoted and free to contain
	// spaces and parentheses of its own, so everything after it is found from
	// the last `)` rather than by splitting the line from the start.
	const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');

	// `utime`, `stime` and `starttime` are fields 14, 15 and 22 of the line,
	// counted from the `state` this list begins at.
	const utime = Number(fields[11]);
	const stime = Number(fields[12]);
	const startTicks = Number(fields[19]);

	if ([utime, stime, startTicks].some((field) => Number.isFinite(field) === false)) {
		return null;
	}

	return {
		cpuSeconds: (utime + stime) / CLOCK_TICKS_PER_SECOND,
		aliveSeconds: uptime - startTicks / CLOCK_TICKS_PER_SECOND,
	};
}

/** The last counters this reader took for one worker, and when it took them. */
interface Reading {
	cpuSeconds: number;
	at: number;
}

/**
 * Each worker's CPU, over a window this reader owns.
 *
 * The supervisor's own percent cannot be used for a decision, because it is not
 * a reading of a fixed window: pm2 derives it from the CPU a worker has spent
 * since *whichever client last asked about that pid*, so any other process
 * listing the same daemon decides what window the next reader measures over.
 * Measured against a worker spinning 20ms in every 100ms — a true 20% — a list
 * arriving 10 to 20ms ahead of the autoscaler's reports it at 100%. Two pollers
 * on steady timers hold a constant offset, so that is not an occasional spike
 * but a number the autoscaler reads all run: an operator on the Processes page
 * is enough to buy workers nothing needed. The daemon is shared and its clients
 * are not ours to schedule, so the measurement stops being shared instead.
 *
 * The counters are the same ones pm2 reads, on the same scale — 100% is one
 * core — so thresholds tuned against it keep their meaning. Where `/proc` will
 * not answer, the supervisor's number stands: the reading is degraded, and a
 * pool with no reading at all is worse.
 */
export class WorkerCpu {
	private readings = new Map<number, Reading>();

	measure(workers: OnlineWorker[]): OnlineWorker[] {
		const uptime = uptimeSeconds();
		const now = Date.now() / 1000;
		const seen = new Set<number>();

		const measured = workers.map((worker) => {
			seen.add(worker.pid);

			if (uptime === null) {
				return worker;
			}

			const times = timesOf(worker.pid, uptime);

			if (times === null) {
				return worker;
			}

			const before = this.readings.get(worker.pid);
			this.readings.set(worker.pid, { cpuSeconds: times.cpuSeconds, at: now });

			// A first sight is measured over the worker's whole life, which is
			// what pm2 answers a pid it has not been asked about before. A
			// counter that has gone backwards is a pid the kernel has handed to
			// a new process, whose life is the only window it has.
			const usable = before !== undefined
				&& times.cpuSeconds >= before.cpuSeconds;

			const spent = usable
				? times.cpuSeconds - before.cpuSeconds
				: times.cpuSeconds;

			const elapsed = usable
				? now - before.at
				: times.aliveSeconds;

			if (elapsed <= 0) {
				return worker;
			}

			return {
				...worker,
				cpuPercent: Math.round(spent / elapsed * 1000) / 10,
			};
		});

		for (const pid of this.readings.keys()) {
			if (seen.has(pid) === false) {
				this.readings.delete(pid);
			}
		}

		return measured;
	}
}
