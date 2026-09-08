import { expect, test } from 'vitest';
import { LEGACY_SAMPLE_WINDOW, LegacySamples } from './legacy-samples.js';

const MEGABYTE = 1_048_576;

function worker(pid: number, cpuPercent: number) {
	return { pid, cpuPercent, memoryBytes: 200 * MEGABYTE };
}

test('reports a worker averaged over the samples it has', () => {
	const samples = new LegacySamples();

	samples.observe([worker(1, 0)]);
	samples.observe([worker(1, 90)]);

	expect(samples.observe([worker(1, 90)])).toEqual({
		workers: [{ cpuPercent: 60, memoryMegabytes: 200 }],
		appeared: false,
		vanished: false,
	});
});

// A threshold calibrated against the last thirty seconds must not still be
// answering for a minute that has passed.
test('forgets a sample once the window has moved past it', () => {
	const samples = new LegacySamples();

	for (let sample = 0; sample < LEGACY_SAMPLE_WINDOW; sample++) {
		samples.observe([worker(1, 0)]);
	}

	for (let sample = 0; sample < LEGACY_SAMPLE_WINDOW; sample++) {
		samples.observe([worker(1, 90)]);
	}

	expect(samples.observe([worker(1, 90)]).workers).toEqual([
		{ cpuPercent: 90, memoryMegabytes: 200 },
	]);
});

test('reports the pool gaining and losing a worker', () => {
	const samples = new LegacySamples();

	expect(samples.observe([worker(1, 0)]).appeared).toBe(true);
	expect(samples.observe([worker(1, 0)]).appeared).toBe(false);
	expect(samples.observe([worker(1, 0), worker(2, 0)]).appeared).toBe(true);
	expect(samples.observe([worker(1, 0)]).vanished).toBe(true);
	expect(samples.observe([worker(1, 0)]).vanished).toBe(false);
});

// A restarted worker keeps its pm id and takes a new pid, and the numbers
// under the old one belong to a process that is gone.
test('starts a replaced worker on a fresh window', () => {
	const samples = new LegacySamples();

	samples.observe([worker(1, 90)]);
	samples.observe([worker(1, 90)]);

	expect(samples.observe([worker(2, 0)])).toEqual({
		workers: [{ cpuPercent: 0, memoryMegabytes: 200 }],
		appeared: true,
		vanished: true,
	});
});
