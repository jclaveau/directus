import { expect, test } from 'vitest';
import { PoolSamples } from './pool-samples.js';
import { LEGACY_SAMPLE_WINDOW } from '@directus/constants';

const MEGABYTE = 1_048_576;

function worker(pid: number, cpuPercent: number, mature = true) {
	return { pid, cpuPercent, memoryBytes: 200 * MEGABYTE, mature };
}

test('averages a worker over the window it is asked for', () => {
	const samples = new PoolSamples();

	samples.observe([worker(1, 0)]);
	samples.observe([worker(1, 60)]);
	samples.observe([worker(1, 90)]);

	expect(samples.averaged(2, false).get(1)).toEqual({
		cpuPercent: 75,
		memoryMegabytes: 200,
	});

	expect(samples.averaged(3, false).get(1)).toEqual({
		cpuPercent: 50,
		memoryMegabytes: 200,
	});
});

// A threshold calibrated against the last thirty seconds must not still be
// answering for a minute that has passed.
test('forgets a sample once the longest window has moved past it', () => {
	const samples = new PoolSamples();

	for (let sample = 0; sample < LEGACY_SAMPLE_WINDOW; sample++) {
		samples.observe([worker(1, 0)]);
	}

	for (let sample = 0; sample < LEGACY_SAMPLE_WINDOW; sample++) {
		samples.observe([worker(1, 90)]);
	}

	expect(samples.averaged(LEGACY_SAMPLE_WINDOW, false).get(1)).toEqual({
		cpuPercent: 90,
		memoryMegabytes: 200,
	});
});

// Warm-up samples are the boot the warm-up exists to keep out of the decision.
// Averaged back in they would hand a worker its own boot for another window's
// worth of ticks after it was declared warm.
test('leaves a warming worker out of the mature average', () => {
	const samples = new PoolSamples();

	samples.observe([worker(1, 100, false)]);
	samples.observe([worker(1, 100, false)]);
	samples.observe([worker(1, 20)]);

	expect(samples.averaged(LEGACY_SAMPLE_WINDOW, true).get(1)?.cpuPercent)
		.toBe(20);

	// The `legacy` strategy has no warm-up, so it reads every sample.
	expect(samples.averaged(LEGACY_SAMPLE_WINDOW, false).get(1)?.cpuPercent)
		.toBe(73);
});

test('reports nothing for a worker with no usable sample yet', () => {
	const samples = new PoolSamples();

	samples.observe([worker(1, 100, false)]);

	expect(samples.averaged(5, true).has(1)).toBe(false);
});

test('reports the pool gaining and losing a worker', () => {
	const samples = new PoolSamples();

	expect(samples.observe([worker(1, 0)]).appeared).toBe(true);
	expect(samples.observe([worker(1, 0)]).appeared).toBe(false);
	expect(samples.observe([worker(1, 0), worker(2, 0)]).appeared).toBe(true);
	expect(samples.observe([worker(1, 0)]).vanished).toBe(true);
	expect(samples.observe([worker(1, 0)]).vanished).toBe(false);
});

// A restarted worker keeps its pm id and takes a new pid, and the numbers
// under the old one belong to a process that is gone.
test('starts a replaced worker on a fresh window', () => {
	const samples = new PoolSamples();

	samples.observe([worker(1, 90)]);
	samples.observe([worker(1, 90)]);

	expect(samples.observe([worker(2, 0)])).toEqual({
		appeared: true,
		vanished: true,
	});

	expect(samples.averaged(LEGACY_SAMPLE_WINDOW, false).get(2)?.cpuPercent)
		.toBe(0);
});
