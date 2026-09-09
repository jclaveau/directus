import type { AutoscaleSupervisor } from '@directus/types';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import type { AutoscaleConfig } from './types.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../logger/index.js', () => {
	return { useLogger: () => logger };
});

const initProcessReports = vi.fn(async () => undefined);

vi.mock('../processes/index.js', () => {
	return { initProcessReports };
});

vi.mock('../utils/report-unhandled-rejection.js', () => {
	return { reportUnhandledRejection: vi.fn() };
});

const connectToSupervisor = vi.fn(async () => undefined);
const disconnectFromSupervisor = vi.fn();
const readPool = vi.fn();
const restarted = vi.fn(() => false);
const scaleTo = vi.fn(async () => undefined);

vi.mock('./lib/pool.js', () => {
	return {
		connectToSupervisor,
		disconnectFromSupervisor,
		readPool,
		restarted,
		scaleTo,
	};
});

const beginAskedReload = vi.fn();
const initAutoscaleReload = vi.fn();
const reloading = vi.fn(() => false);

const reloadState = vi.fn(() => {
	return { askedAt: null, running: false, finishedAt: null, error: null };
});

vi.mock('./lib/reload.js', () => {
	return { beginAskedReload, initAutoscaleReload, reloadState, reloading };
});

const resolveConfig = vi.fn();
const resolvedSources = vi.fn(() => ({}));
const resolvedWithoutOverride = vi.fn(() => null);

vi.mock('./lib/resolve-config.js', () => {
	return { resolveConfig, resolvedSources, resolvedWithoutOverride };
});

const decide = vi.fn((): { workers: number | null; reason: string } => {
	return { workers: null, reason: 'steady' };
});

vi.mock('./lib/decide.js', () => {
	return { decide };
});

const recordAutoscaleTick = vi.fn();

vi.mock('./lib/state.js', () => {
	return { recordAutoscaleTick };
});

// Compiling the graph behind these modules is seconds of work, and a case that
// pays it is a case timing its own toolchain.
beforeAll(async () => {
	await import('./index.js');
});

const { runAutoscaler } = await import('./index.js');

const config: AutoscaleConfig = {
	enabled: true,
	strategy: 'scalabus',
	appName: 'api',
	signal: 'average',
	sampleWindow: 5,
	scaleCpuThreshold: 60,
	releaseCpuThreshold: 40,
	minWorkers: 1,
	maxWorkers: 4,
	prewarmWorkers: 0,
	minSecondsToScaleUp: 10,
	minSecondsToScaleDown: 300,
	warmupSeconds: 30,
};

const supervisor: AutoscaleSupervisor = {
	instances: 2,
	execMode: 'cluster_mode',
	maxMemoryRestart: null,
	listenTimeout: 15000,
	killTimeout: 1600,
	minUptime: 1000,
	maxRestarts: 16,
	restartDelay: 0,
	autorestart: true,
	waitReady: true,
};

/**
 * The loop never returns, so it is driven rather than awaited: while the clock
 * is fake the tick it parks on between samples only comes when a case asks for
 * it, and the last one leaves it parked for good.
 */
async function ticks(count: number) {
	void runAutoscaler();

	// The tick's own awaits are settled promises, so they drain between the
	// steps of the fake clock rather than needing time to pass.
	await vi.advanceTimersByTimeAsync(1000 * (count - 1) + 1);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	restarted.mockReturnValue(false);
	reloading.mockReturnValue(false);
	decide.mockReturnValue({ workers: null, reason: 'steady' });
	resolveConfig.mockResolvedValue(config);

	readPool.mockResolvedValue({
		pendingWorkers: 0,
		warmingWorkers: 0,
		onlineWorkers: [{ pid: 11, cpuPercent: 70, memoryBytes: 0, mature: true }],
		restartsByWorker: new Map([[11, 0]]),
		supervisor,
	});
});

afterEach(() => {
	vi.useRealTimers();
	// Each run registers its own, and the process outlives the case.
	process.removeAllListeners('SIGINT');
	process.removeAllListeners('SIGTERM');
});

describe('runAutoscaler', () => {
	// This process answers no request, so what the pool is being scaled on can
	// only come from the tick that scaled it.
	test('reports the reading its decision was taken on', async () => {
		decide.mockReturnValue({ workers: 3, reason: 'cpu above the threshold' });

		// The first tick out of a deploy is prewarm's, whatever it decides.
		await ticks(2);

		expect(scaleTo).toHaveBeenCalledWith('api', 3);

		expect(recordAutoscaleTick).toHaveBeenLastCalledWith(expect.objectContaining({
			config,
			workers: 1,
			pendingWorkers: 0,
			warmingWorkers: 0,
			supervisor,
			reload: { askedAt: null, running: false, finishedAt: null, error: null },
			lastDecision: expect.objectContaining({
				workers: 3,
				reason: 'cpu above the threshold',
			}),
		}));
	});

	// A reload bumps the restart counter and leaves the retiring worker in the
	// pool, which are both signals the loop reads as a pool in trouble.
	test('takes no decision while the pool is being restarted', async () => {
		reloading.mockReturnValue(true);
		resolveConfig.mockResolvedValue({ ...config, prewarmWorkers: 3 });
		decide.mockReturnValue({ workers: 3, reason: 'cpu above the threshold' });

		await ticks(2);

		expect(decide).not.toHaveBeenCalled();
		expect(scaleTo).not.toHaveBeenCalled();
		// Still reported: an admin watching the restart is watching this.
		expect(recordAutoscaleTick).toHaveBeenCalledTimes(2);
	});

	test('prewarms a pool fresh out of a deploy, once', async () => {
		resolveConfig.mockResolvedValue({ ...config, prewarmWorkers: 3 });

		await ticks(2);

		expect(scaleTo).toHaveBeenCalledExactlyOnceWith('api', 3);

		expect(recordAutoscaleTick).toHaveBeenNthCalledWith(1, expect.objectContaining({
			lastDecision: expect.objectContaining({ reason: 'prewarming the pool' }),
		}));

		// The second tick is a normal one: prewarm is a step out of a deploy,
		// not a floor the pool is held at.
		expect(decide).toHaveBeenCalledOnce();
	});

	// A pool fresh out of a deploy carries no restarts. One that does was
	// crash-looping before the autoscaler arrived, and prewarm would hand it a
	// batch of workers to crash.
	test('does not prewarm a pool that is already crash-looping', async () => {
		resolveConfig.mockResolvedValue({ ...config, prewarmWorkers: 3 });

		readPool.mockResolvedValue({
			pendingWorkers: 0,
			warmingWorkers: 0,
			onlineWorkers: [{ pid: 11, cpuPercent: 70, memoryBytes: 0, mature: true }],
			restartsByWorker: new Map([[11, 4]]),
			supervisor,
		});

		await ticks(1);

		expect(scaleTo).not.toHaveBeenCalled();
		expect(decide).toHaveBeenCalledOnce();
	});

	// The budget a restart is given comes from the pool it is about to replace,
	// so the size and the declaration are read on the tick that starts it.
	test('hands an asked-for restart the pool it is to replace', async () => {
		readPool.mockResolvedValue({
			pendingWorkers: 1,
			warmingWorkers: 0,
			onlineWorkers: [{ pid: 11, cpuPercent: 70, memoryBytes: 0, mature: true }],
			restartsByWorker: new Map([[11, 0]]),
			supervisor,
		});

		await ticks(1);

		expect(beginAskedReload).toHaveBeenCalledWith('api', 2);
	});

	// A tick that throws is a tick that was skipped: ending the loop would
	// leave the pool frozen at whatever size the failure caught it in.
	test('skips a tick that failed rather than ending', async () => {
		resolveConfig.mockRejectedValueOnce(new Error('redis is gone'));

		await ticks(2);

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'redis is gone' }),
			'[autoscale] a tick failed',
		);

		expect(recordAutoscaleTick).toHaveBeenCalledOnce();
	});
});
