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

const scaleApp = vi.fn<
	(app: string, workers: number, timeoutMs?: number) => Promise<void>
>(async () => undefined);

const releaseWorker = vi.fn<(pmId: number) => Promise<void>>(async () => undefined);
const watchWorkerMessages = vi.fn();

vi.mock('../supervisor/index.js', () => {
	return {
		connectToSupervisor,
		disconnectFromSupervisor,
		releaseWorker,
		scaleApp,
		watchWorkerMessages,
		SUPERVISOR_TIMEOUT_MS: 15_000,
	};
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

const inFlightOf = vi.fn<(pmId: number) => number | null>(() => null);
const watchInFlightReports = vi.fn();

vi.mock('./lib/in-flight.js', () => {
	return { inFlightOf, watchInFlightReports };
});

const answerPoolHealthQueries = vi.fn(async () => undefined);
const reportPoolHealth = vi.fn();
const withdrawPoolHealth = vi.fn(async () => undefined);

vi.mock('../lib/pool-health.js', () => {
	return { answerPoolHealthQueries, reportPoolHealth, withdrawPoolHealth };
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
 * A pool of `count` online workers, each past its warm-up, under a
 * declaration giving each boot `listenTimeout`.
 */
function pool(count: number, listenTimeout = supervisor.listenTimeout) {
	const workers = Array.from({ length: count }, (_unused, index) => {
		return { pid: 11 + index, cpuPercent: 70, memoryBytes: 0, mature: true };
	});

	return {
		pendingWorkers: 0,
		warmingWorkers: 0,
		onlineWorkers: workers,
		restartsByWorker: new Map(workers.map((worker) => [worker.pid, 0])),
		supervisor: { ...supervisor, listenTimeout },
	};
}

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

	// Handed a size, pm2 walks the app's processes from the first one and
	// deletes the worker the pool has had longest — which under keep-alive is
	// the one carrying the live requests, because node cluster round-robins new
	// connections and clients stay on the sockets they hold. So a release names
	// the worker instead of the size it wants to be left at.
	test('releases the idle worker rather than the one pm2 would pick', async () => {
		readPool.mockResolvedValue({
			pendingWorkers: 0,
			warmingWorkers: 0,
			onlineWorkers: [
				{ pid: 11, pmId: 0, cpuPercent: 5, memoryBytes: 0, mature: true },
				{ pid: 12, pmId: 1, cpuPercent: 5, memoryBytes: 0, mature: true },
			],
			restartsByWorker: new Map([[0, 0], [1, 0]]),
			supervisor,
		});

		inFlightOf.mockImplementation((pmId) => {
			return pmId === 0
				? 4
				: 0;
		});

		decide.mockReturnValue({ workers: 1, reason: 'the load went' });

		await ticks(2);

		expect(releaseWorker).toHaveBeenCalledWith(1);
		expect(scaleApp).not.toHaveBeenCalled();
	});

	// The supervisor answers a release once the worker has drained, up to its
	// `kill_timeout`, so a release of several workers asked for one after the
	// other would hold the tick for the sum of the drains. Asked for together,
	// the tick waits for the longest.
	test('asks for every release of a tick before waiting on any', async () => {
		readPool.mockResolvedValue({
			pendingWorkers: 0,
			warmingWorkers: 0,
			onlineWorkers: [
				{ pid: 11, pmId: 0, cpuPercent: 5, memoryBytes: 0, mature: true },
				{ pid: 12, pmId: 1, cpuPercent: 5, memoryBytes: 0, mature: true },
				{ pid: 13, pmId: 2, cpuPercent: 5, memoryBytes: 0, mature: true },
				{ pid: 14, pmId: 3, cpuPercent: 5, memoryBytes: 0, mature: true },
			],
			restartsByWorker: new Map([[0, 0], [1, 0], [2, 0], [3, 0]]),
			supervisor,
		});

		inFlightOf.mockImplementation((pmId) => {
			return pmId === 0
				? 4
				: 0;
		});

		// Never answered, the way a worker mid-drain has not answered yet.
		releaseWorker.mockImplementation(() => new Promise(() => undefined));
		decide.mockReturnValue({ workers: 2, reason: 'the load went' });

		// The first tick out of a deploy is prewarm's, whatever it decides.
		await ticks(2);

		expect(releaseWorker.mock.calls).toEqual([[1], [2]]);
	});

	// The release the supervisor refused is the failure the tick reports, and
	// it reports it once the release beside it has been answered, so what the
	// next tick reads is the pool both left.
	test('fails the tick on a refused release once the others settle', async () => {
		readPool.mockResolvedValue({
			pendingWorkers: 0,
			warmingWorkers: 0,
			onlineWorkers: [
				{ pid: 11, pmId: 0, cpuPercent: 5, memoryBytes: 0, mature: true },
				{ pid: 12, pmId: 1, cpuPercent: 5, memoryBytes: 0, mature: true },
				{ pid: 13, pmId: 2, cpuPercent: 5, memoryBytes: 0, mature: true },
			],
			restartsByWorker: new Map([[0, 0], [1, 0], [2, 0]]),
			supervisor,
		});

		let answered = false;

		releaseWorker.mockImplementation((pmId) => {
			if (pmId === 1) {
				return Promise.reject(new Error('pm2 did not answer'));
			}

			return new Promise<void>((resolve) => {
				setTimeout(() => {
					answered = true;
					resolve();
				}, 500);
			});
		});

		decide.mockReturnValue({ workers: 1, reason: 'the load went' });

		await ticks(2);

		expect(logger.error).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(500);

		expect(answered).toBe(true);

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'pm2 did not answer' }),
			'[autoscale] a tick failed',
		);
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

	// One scale for the whole target: pm2 boots the workers it adds one after
	// another whatever the size asked, so nothing is gained by asking in parts.
	// Given the bound the boots deserve rather than a call's default: pm2 waits
	// `listen_timeout` at most on each worker it adds, four boots at
	// production's three seconds, and the forks it does not clock get the
	// fifteen seconds a call carries by default on top.
	test('asks for the whole prewarm in one scale, bounded at its boots', async () => {
		resolveConfig.mockReturnValue({
			...config,
			prewarmWorkers: 5,
			maxWorkers: 8,
		});

		readPool.mockResolvedValueOnce(pool(1, 3000)).mockResolvedValue(pool(5));

		await ticks(2);

		expect(scaleApp).toHaveBeenCalledExactlyOnceWith('api', 5, 27_000);

		expect(recordAutoscaleTick).toHaveBeenNthCalledWith(1, expect.objectContaining({
			lastDecision: expect.objectContaining({ reason: 'prewarming the pool' }),
		}));
	});

	// pm2 answers a scale once every worker it added has reported ready, which
	// for a whole prewarm runs well past the bound a waited supervisor call
	// carries: the ask is not waited on. A second scale sent while the first is
	// still adding counts the workers added so far and adds the difference on
	// top of the ones still to come, so the ask is not repeated either until
	// pm2 has answered it.
	test('asks once while the scale is still being answered', async () => {
		resolveConfig.mockReturnValue({ ...config, prewarmWorkers: 3 });
		scaleApp.mockReturnValueOnce(new Promise(() => undefined));

		await ticks(4);

		expect(scaleApp).toHaveBeenCalledExactlyOnceWith('api', 3, 45_000);
		expect(decide).not.toHaveBeenCalled();

		// A tick spent waiting says so, for the admin reading what the pool is
		// being scaled on while a deploy fills.
		expect(recordAutoscaleTick).toHaveBeenLastCalledWith(expect.objectContaining({
			lastDecision: expect.objectContaining({
				workers: null,
				reason: 'the prewarm to 3 is still arriving',
			}),
		}));
	});

	// The defect the prewarm was rewritten for. Latched on the ask, a single
	// scale the supervisor refused ended the prewarm for the life of the
	// deployment: nothing asked again, and the deployment sat at 503 waiting
	// to be told it had reached a size nothing was growing towards.
	test('asks again after a scale the supervisor refused', async () => {
		resolveConfig.mockReturnValue({ ...config, prewarmWorkers: 3 });
		scaleApp.mockRejectedValueOnce(new Error('pm2 is not answering'));

		await ticks(2);

		expect(scaleApp.mock.calls).toEqual([['api', 3, 45_000], ['api', 3, 45_000]]);

		expect(logger.warn).toHaveBeenCalledWith(
			expect.any(Error),
			'[autoscale] the prewarm scale failed, asked again next tick',
		);

		expect(decide).not.toHaveBeenCalled();
	});

	// A pool carrying restarts before the prewarm was asked was crash-looping
	// before the autoscaler arrived, and gets none. One restarting after the
	// ask is a deployment still short of the size it asked for: the restart
	// holds the prewarm for the warm-up, and it is asked for again after.
	test('asks again after a worker of the filling pool restarted', async () => {
		resolveConfig.mockReturnValue({
			...config,
			prewarmWorkers: 3,
			warmupSeconds: 1,
		});

		scaleApp.mockRejectedValueOnce(new Error('pm2 is not answering'));

		readPool
			.mockResolvedValueOnce(pool(1))
			.mockResolvedValue({
				...pool(1),
				onlineWorkers: [
					...pool(1).onlineWorkers,
					{ pid: 12, cpuPercent: 70, memoryBytes: 0, mature: true },
				],
				restartsByWorker: new Map([[11, 0], [12, 1]]),
			});

		restarted.mockReturnValueOnce(false).mockReturnValueOnce(true);

		// The restarted worker is a pool that grew, so the second ask waits out
		// the two listen timeouts a scale could still be adding behind: thirty
		// seconds from the second tick.
		await ticks(32);

		expect(scaleApp.mock.calls).toEqual([['api', 3, 45_000], ['api', 3, 30_000]]);
		// The tick of the restart itself went to the rule that holds on one.
		expect(decide).toHaveBeenCalledOnce();
	});

	// A failed ask does not say whether pm2 is still adding: the daemon may be
	// gone, or alive and starved past the bound, and a second scale sent while
	// the first is still adding grows the pool past the target. A scale still
	// adding forks a worker at least every `listen_timeout`, so the pool is
	// asked for again once it has not grown for two of them.
	test('holds the second ask while the pool is still growing', async () => {
		resolveConfig.mockReturnValue({
			...config,
			prewarmWorkers: 5,
			maxWorkers: 8,
		});

		scaleApp.mockRejectedValueOnce(new Error('pm2 is not answering'));

		readPool
			.mockResolvedValueOnce(pool(1, 3000))
			.mockResolvedValueOnce(pool(2, 3000))
			.mockResolvedValue(pool(3, 3000));

		// The pool last grew on the third tick; six seconds later is the ninth.
		await ticks(9);

		expect(scaleApp.mock.calls).toEqual([['api', 5, 27_000], ['api', 5, 21_000]]);

		expect(recordAutoscaleTick).toHaveBeenCalledWith(expect.objectContaining({
			lastDecision: expect.objectContaining({
				workers: null,
				reason: 'a scale may still be adding: the pool grew 1s ago',
			}),
		}));

		expect(decide).not.toHaveBeenCalled();
	});

	// Every worker of a pool that is still arriving is idle because it has just
	// booted, so the release rule reads a whole deploy as a pool nobody wants
	// and takes it apart faster than the supervisor is putting it together.
	test('takes no decision while the prewarm has not arrived', async () => {
		resolveConfig.mockReturnValue({ ...config, prewarmWorkers: 4 });
		decide.mockReturnValue({ workers: 1, reason: 'the pool is idle' });

		await ticks(3);

		expect(decide).not.toHaveBeenCalled();
		expect(releaseWorker).not.toHaveBeenCalled();
	});

	// Prewarm is a step out of a deploy, not a floor the pool is held at.
	test('takes normal decisions once the pool is the size asked for', async () => {
		resolveConfig.mockReturnValue({ ...config, prewarmWorkers: 3 });
		readPool.mockResolvedValueOnce(pool(1)).mockResolvedValue(pool(3));

		await ticks(3);

		expect(scaleApp).toHaveBeenCalledExactlyOnceWith('api', 3, 45_000);
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

	// A query nobody answers costs a new worker its reading, not the pool its
	// scaling, so the loop runs on without it.
	test('scales on when pool health queries cannot be answered', async () => {
		answerPoolHealthQueries.mockRejectedValueOnce(new Error('redis is down'));

		await ticks(2);

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'redis is down' }),
			'[autoscale] could not answer pool health queries',
		);

		expect(recordAutoscaleTick).toHaveBeenCalledTimes(2);
	});

	test('takes the reading back before it exits on a stop', async () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			return undefined as never;
		});

		let withdraw = (): void => undefined;

		withdrawPoolHealth.mockImplementationOnce(() => {
			return new Promise<void>((resolve) => {
				withdraw = resolve;
			});
		});

		await ticks(1);
		process.emit('SIGTERM');
		await vi.advanceTimersByTimeAsync(0);

		expect(disconnectFromSupervisor).toHaveBeenCalledOnce();
		expect(withdrawPoolHealth).toHaveBeenCalledOnce();
		expect(exit).not.toHaveBeenCalled();

		withdraw();
		await vi.advanceTimersByTimeAsync(0);

		expect(exit).toHaveBeenCalledWith(0);

		exit.mockRestore();
	});

	// A publish over a Redis that is down waits with no deadline.
	test('exits a second after a stop the bus never answers', async () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			return undefined as never;
		});

		withdrawPoolHealth.mockImplementationOnce(() => new Promise(() => {}));

		await ticks(1);
		process.emit('SIGINT');
		await vi.advanceTimersByTimeAsync(999);

		expect(exit).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(exit).toHaveBeenCalledWith(0);

		exit.mockRestore();
	});
});

describe('targetPoolSize', () => {
	const config = {
		enabled: true,
		minWorkers: 1,
		maxWorkers: 4,
		prewarmWorkers: 0,
	} as AutoscaleConfig;

	test('is the floor where no prewarm was asked for', async () => {
		const { targetPoolSize } = await import('./index.js');

		expect(targetPoolSize({ ...config, minWorkers: 2 })).toBe(2);
	});

	test('is the prewarm where one was', async () => {
		const { targetPoolSize } = await import('./index.js');

		expect(targetPoolSize({ ...config, prewarmWorkers: 3 })).toBe(3);
	});

	test('is the ceiling where the prewarm is above it', async () => {
		const { targetPoolSize } = await import('./index.js');

		// The same clamp prewarm itself runs under, so health is not held down
		// waiting for a size the pool is not allowed to reach.
		expect(targetPoolSize({ ...config, prewarmWorkers: 9 })).toBe(4);
	});

	test('is the floor where scaling is off', async () => {
		const { targetPoolSize } = await import('./index.js');

		// Prewarm is one of the things that does not run then.
		expect(targetPoolSize({ ...config, enabled: false, prewarmWorkers: 3 }))
			.toBe(1);
	});
});
