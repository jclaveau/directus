import type { AutoscaleConfig, AutoscaleConfigSources } from '@directus/types';
import { expect, test, vi } from 'vitest';

const config = { appName: 'api', maxWorkers: 4 } as AutoscaleConfig;
const sources = { maxWorkers: 'env' } as AutoscaleConfigSources;

/**
 * The state is one process's own, held for as long as it runs, so each case
 * takes its own instance rather than the one the case before it left behind.
 */
async function freshState() {
	vi.resetModules();

	return import('./state.js');
}

test('answers nothing before the first tick', async () => {
	const { autoscaleState } = await freshState();

	expect(autoscaleState()).toBeNull();
});

test('answers with the tick that was recorded', async () => {
	const { autoscaleState, recordAutoscaleTick } = await freshState();

	recordAutoscaleTick({
		at: 1000,
		config,
		withoutSharedConfig: config,
		sources,
		workers: 2,
		pendingWorkers: 1,
		warmingWorkers: 0,
		reload: { askedAt: null, running: false, finishedAt: null, error: null },
		supervisor: null,
		cpuPercents: [20, 30],
		lastDecision: { at: 1000, workers: 3, reason: 'average cpu 25% is high' },
	});

	expect(autoscaleState()).toEqual({
		at: 1000,
		config,
		withoutSharedConfig: config,
		sources,
		workers: 2,
		pendingWorkers: 1,
		warmingWorkers: 0,
		reload: { askedAt: null, running: false, finishedAt: null, error: null },
		supervisor: null,
		cpuPercents: [20, 30],
		lastDecision: { at: 1000, workers: 3, reason: 'average cpu 25% is high' },
		lastScale: { at: 1000, workers: 3, reason: 'average cpu 25% is high' },
	});
});

// A pool holding steady decides "within the band" every second, which says
// nothing about why it is the size it is. The move that made it that size does,
// so it survives every tick that leaves the pool alone.
test('keeps the last move a tick that decides nothing', async () => {
	const { autoscaleState, recordAutoscaleTick } = await freshState();

	const tick = {
		at: 1000,
		config,
		withoutSharedConfig: config,
		sources,
		workers: 3,
		pendingWorkers: 0,
		warmingWorkers: 0,
		reload: { askedAt: null, running: false, finishedAt: null, error: null },
		supervisor: null,
		cpuPercents: [20],
	};

	recordAutoscaleTick({
		...tick,
		lastDecision: { at: 1000, workers: 3, reason: 'average cpu 61% is high' },
	});

	recordAutoscaleTick({ ...tick, at: 2000, lastDecision: null });

	expect(autoscaleState()).toMatchObject({
		at: 2000,
		lastDecision: null,
		lastScale: { at: 1000, workers: 3, reason: 'average cpu 61% is high' },
	});
});
