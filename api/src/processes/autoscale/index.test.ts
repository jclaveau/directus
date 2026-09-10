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
import { reportUnhandledRejection } from '../../utils/report-unhandled-rejection.js';
import type { AutoscaleConfig } from './types.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => logger };
});

const initProcessReports = vi.fn(async () => undefined);

vi.mock('../index.js', () => {
	return { initProcessReports };
});

vi.mock('../../utils/report-unhandled-rejection.js', () => {
	const report = vi.fn();

	// Taken for real rather than stubbed: what the arms below read is the
	// listener the process ends up carrying, which is the whole claim.
	return {
		reportUnhandledRejection: report,
		guardUnhandledRejections: () => {
			if (process.listeners('unhandledRejection').includes(report)) {
				return;
			}

			process.on('unhandledRejection', report);
		},
	};
});

const connectToSupervisor = vi.fn(async () => undefined);
const disconnectFromSupervisor = vi.fn();
const scaleApp = vi.fn(async () => undefined);

vi.mock('../supervisor/index.js', () => {
	return { connectToSupervisor, disconnectFromSupervisor, scaleApp };
});

const readPool = vi.fn();
const restarted = vi.fn(() => false);

vi.mock('./lib/pool.js', () => {
	return { readPool, restarted };
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

const initSharedSettingsMirror = vi.fn(async () => undefined);
const resolveConfig = vi.fn();
const resolvedSources = vi.fn(() => ({}));
const resolvedWithoutSharedSettings = vi.fn(() => null);

vi.mock('./lib/resolve-config.js', () => {
	return {
		initSharedSettingsMirror,
		resolveConfig,
		resolvedSources,
		resolvedWithoutSharedSettings,
	};
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
	resolveConfig.mockReturnValue(config);

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
	process.removeListener('unhandledRejection', reportUnhandledRejection);
});

describe('runAutoscaler', () => {
	// Taken before the first await rather than beside the loop: an unreachable
	// Redis rejects from the bus subscriber and from commands whose caller has
	// already given up, Node ends the process on one nothing awaited, and the
	// supervisor restarts this into the same outage — with the pool left at
	// whatever size the outage caught it at.
	test('guards against a stray rejection before one can happen', async () => {
		let guardedAtConnect = false;

		connectToSupervisor.mockImplementationOnce(async () => {
			guardedAtConnect = process
				.listeners('unhandledRejection')
				.includes(reportUnhandledRejection);

			return undefined;
		});

		await ticks(1);

		expect(guardedAtConnect).toBe(true);
	});

	// Once at boot and not once a tick: a listener added every second is one
	// this process carries for as long as it runs, and it runs for the life of
	// the pool.
	test('takes that guard once however long it runs', async () => {
		await ticks(3);

		const guards = process
			.listeners('unhandledRejection')
			.filter((listener) => listener === reportUnhandledRejection);

		expect(guards).toHaveLength(1);
	});

	// This process answers no request, so what the pool is being scaled on can
	// only come from the tick that scaled it.
	test('reports the reading its decision was taken on', async () => {
		decide.mockReturnValue({ workers: 3, reason: 'cpu above the threshold' });

		// The first tick out of a deploy is prewarm's, whatever it decides.
		await ticks(2);

		expect(scaleApp).toHaveBeenCalledWith('api', 3);

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
		resolveConfig.mockReturnValue({ ...config, prewarmWorkers: 3 });
		decide.mockReturnValue({ workers: 3, reason: 'cpu above the threshold' });

		await ticks(2);

		expect(decide).not.toHaveBeenCalled();
		expect(scaleApp).not.toHaveBeenCalled();
		// Still reported: an admin watching the restart is watching this.
		expect(recordAutoscaleTick).toHaveBeenCalledTimes(2);
	});

	test('prewarms a pool fresh out of a deploy, once', async () => {
		resolveConfig.mockReturnValue({ ...config, prewarmWorkers: 3 });

		await ticks(2);

		expect(scaleApp).toHaveBeenCalledExactlyOnceWith('api', 3);

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
		resolveConfig.mockReturnValue({ ...config, prewarmWorkers: 3 });

		readPool.mockResolvedValue({
			pendingWorkers: 0,
			warmingWorkers: 0,
			onlineWorkers: [{ pid: 11, cpuPercent: 70, memoryBytes: 0, mature: true }],
			restartsByWorker: new Map([[11, 4]]),
			supervisor,
		});

		await ticks(1);

		expect(scaleApp).not.toHaveBeenCalled();
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
		resolveConfig.mockImplementationOnce(() => {
			throw new Error('the pool could not be read');
		});

		await ticks(2);

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'the pool could not be read' }),
			'[autoscale] a tick failed',
		);

		expect(recordAutoscaleTick).toHaveBeenCalledOnce();
	});
});
