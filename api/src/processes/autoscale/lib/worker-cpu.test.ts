import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OnlineWorker } from './pool.js';
import { WorkerCpu } from './worker-cpu.js';

const { readFileSync } = vi.hoisted(() => ({ readFileSync: vi.fn() }));

vi.mock('node:fs', () => ({ readFileSync }));

/** Seconds since boot, which `/proc/uptime` reports and pids are dated from. */
const UPTIME = 5000;

/**
 * A `/proc/<pid>/stat` line carrying `cpuSeconds` of CPU on a process started
 * `aliveSeconds` ago.
 *
 * The name is parenthesised and spaced on purpose: the field is the executable's
 * own, unquoted, and a reader splitting the line from the start mis-numbers every
 * field after it.
 */
function stat(cpuSeconds: number, aliveSeconds: number): string {
	const fields = Array.from({ length: 20 }, () => '0');

	// `state` is the first of these, so `utime`, `stime` and `starttime` — the
	// 14th, 15th and 22nd fields of the line — land here.
	fields[11] = String(cpuSeconds * 100);
	fields[12] = '0';
	fields[19] = String((UPTIME - aliveSeconds) * 100);

	return `4242 (node (worker) 1) ${fields.join(' ')}\n`;
}

/** What the supervisor said, which stands wherever `/proc` will not answer. */
function worker(cpuPercent: number): OnlineWorker {
	return { pid: 4242, cpuPercent, memoryBytes: 1024, mature: true };
}

function procHolding(line: string | null): void {
	readFileSync.mockImplementation((path: string) => {
		if (path === '/proc/uptime') {
			return `${UPTIME} 1.0\n`;
		}

		if (line === null) {
			throw new Error('ENOENT');
		}

		return line;
	});
}

describe('a worker measured over the reader\'s own window', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// The supervisor is asked for a percent it derives from whenever its last
	// caller asked, so the number it offers here is one another client's timing
	// produced. The reader is not allowed to prefer it.
	test('ignores the percent the supervisor reports', () => {
		const cpu = new WorkerCpu();

		procHolding(stat(2, 10));

		expect(cpu.measure([worker(100)])[0]?.cpuPercent).toBe(20);
	});

	test('measures a first sight over the whole life of the process', () => {
		const cpu = new WorkerCpu();

		procHolding(stat(30, 200));

		expect(cpu.measure([worker(0)])[0]?.cpuPercent).toBe(15);
	});

	test('measures every sight after it since the sight before', () => {
		const cpu = new WorkerCpu();

		procHolding(stat(2, 10));
		cpu.measure([worker(0)]);

		vi.setSystemTime(4000);
		procHolding(stat(3, 14));

		// One CPU second over the four wall seconds this reader waited, rather
		// than the three over fourteen a whole life would have given.
		expect(cpu.measure([worker(0)])[0]?.cpuPercent).toBe(25);
	});

	// A worker the pool no longer holds takes its counters with it, so the pid
	// coming back is a process this reader has never measured.
	test('forgets a worker that leaves the pool', () => {
		const cpu = new WorkerCpu();

		procHolding(stat(2, 10));
		cpu.measure([worker(0)]);

		cpu.measure([]);

		vi.setSystemTime(4000);
		procHolding(stat(3, 14));

		expect(cpu.measure([worker(0)])[0]?.cpuPercent).toBeCloseTo(21.4, 1);
	});

	// A pid the kernel has handed to a new process reports fewer CPU seconds
	// than the one before it spent, and the difference would be negative.
	test('measures a reused pid over its own life', () => {
		const cpu = new WorkerCpu();

		procHolding(stat(90, 300));
		cpu.measure([worker(0)]);

		vi.setSystemTime(4000);
		procHolding(stat(1, 10));

		expect(cpu.measure([worker(0)])[0]?.cpuPercent).toBe(10);
	});

	test('keeps the supervisor\'s percent where /proc will not answer', () => {
		const cpu = new WorkerCpu();

		procHolding(null);

		expect(cpu.measure([worker(37)])[0]?.cpuPercent).toBe(37);
	});
});
