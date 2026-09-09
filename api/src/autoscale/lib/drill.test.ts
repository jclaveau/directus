import type { AutoscaleConfig, AutoscaleRunner } from '@directus/types';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@directus/env');

vi.mock('../../logger/index.js', () => {
	return {
		useLogger: () => {
			return { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
		},
	};
});

const publish = vi.fn();
const subscribe = vi.fn();

vi.mock('../../bus/index.js', () => {
	return {
		useBus: () => {
			return { publish, subscribe };
		},
	};
});

/**
 * A fresh copy of the module per case: the deadline and the share it is
 * burning are module state, which is what makes a lost stop message harmless
 * and what would otherwise carry one case's drill into the next.
 */
async function freshModule(enabled = true) {
	vi.resetModules();

	const { useEnv } = await import('@directus/env');
	vi.mocked(useEnv).mockReturnValue({ PM2_AUTOSCALE_DRILL_ENABLED: enabled });

	return import('./drill.js');
}

/** The announcement the pool was sent, as the subscriber receives it. */
function announced(): { until: number; percent: number } {
	return publish.mock.calls.at(-1)?.[1];
}

function runner(cpuPercents: number[], releaseCpuThreshold = 40): AutoscaleRunner {
	return {
		service: 'api',
		replicaId: 'one',
		nodeId: 'node',
		name: 'api',
		state: {
			at: 0,
			config: { releaseCpuThreshold } as AutoscaleConfig,
			sources: {} as never,
			withoutOverride: {} as never,
			workers: cpuPercents.length,
			pendingWorkers: 0,
			warmingWorkers: 0,
			supervisor: null,
			cpuPercents,
			lastDecision: null,
			lastScale: null,
		},
	};
}

beforeEach(() => {
	publish.mockClear();
	subscribe.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('a deployment that did not ask for the drill listens for none', async () => {
	const { initAutoscaleDrill, autoscaleDrillEnabled } = await freshModule(false);

	initAutoscaleDrill();

	expect(autoscaleDrillEnabled()).toBe(false);
	expect(subscribe).not.toHaveBeenCalled();
});

test('a deployment that asked for it subscribes', async () => {
	const { initAutoscaleDrill } = await freshModule();

	initAutoscaleDrill();

	expect(subscribe).toHaveBeenCalledWith('autoscaleDrill', expect.any(Function));
});

test('starting announces the deadline and the share to the pool', async () => {
	const { startDrill } = await freshModule();

	const before = Date.now();
	const drill = startDrill(30, 80);

	expect(drill.percent).toBe(80);
	expect(drill.until).toBeGreaterThanOrEqual(before + 30_000);
	expect(publish).toHaveBeenCalledWith('autoscaleDrill', drill);
	expect(announced()).toEqual({ until: drill.until, percent: 80 });
});

test('a share outside what a worker may burn is brought inside it', async () => {
	const { clampPercent, MAX_DRILL_PERCENT, MIN_DRILL_PERCENT } = await freshModule();

	expect(clampPercent(100)).toBe(MAX_DRILL_PERCENT);
	expect(clampPercent(0)).toBe(MIN_DRILL_PERCENT);
	expect(clampPercent(80.4)).toBe(80);
	expect(clampPercent('nonsense')).toBe(MIN_DRILL_PERCENT);
});

test('a drill announced to run for a week runs for the cap', async () => {
	const { cappedDeadline, MAX_DRILL_SECONDS } = await freshModule();

	const now = 1_000_000;

	expect(cappedDeadline(now + 604_800_000, now))
		.toBe(now + MAX_DRILL_SECONDS * 1000);

	expect(cappedDeadline(now + 5000, now)).toBe(now + 5000);
	expect(cappedDeadline('nonsense', now)).toBe(0);
});

test('stopping calls the pool off with a deadline already past', async () => {
	const { startDrill, stopDrill } = await freshModule();

	startDrill(30, 80);
	const stopped = stopDrill();

	expect(stopped.until).toBeNull();
	expect(announced().until).toBe(0);
});

test('a worker burns until its deadline and then reports none', async () => {
	const { drillState, initAutoscaleDrill } = await freshModule();

	initAutoscaleDrill();
	const receive = subscribe.mock.calls[0]![1] as (message: unknown) => void;

	receive({ until: Date.now() + 150, percent: 10 });
	expect(drillState().until).not.toBeNull();
	expect(drillState().percent).toBe(10);

	await new Promise((resolve) => {
		setTimeout(resolve, 300);
	});

	expect(drillState().until).toBeNull();
});

test('a worker at or above the release threshold means a working pool', async () => {
	const { loadedWorker } = await freshModule();

	expect(loadedWorker([runner([2, 41])])).toBe(41);
	expect(loadedWorker([runner([2, 3])])).toBeNull();
	expect(loadedWorker([runner([40])])).toBe(40);
	expect(loadedWorker([runner([2]), runner([70])])).toBe(70);
	expect(loadedWorker([])).toBeNull();
});
