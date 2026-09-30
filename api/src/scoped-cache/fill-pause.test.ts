import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted, so the factories hand the module re-imported per case the same mocks
// the cases assert on.
const {
	collectProcessReports,
	endFillPause,
	logger,
	requestScopedCacheIndexReap,
	scopedCachePurgeEnabled,
	watchFillPause,
} = vi.hoisted(() => {
	return {
		collectProcessReports: vi.fn(),
		endFillPause: vi.fn(async () => true),
		logger: { info: vi.fn(), warn: vi.fn() },
		requestScopedCacheIndexReap: vi.fn(async () => {}),
		scopedCachePurgeEnabled: vi.fn(() => true),
		watchFillPause: vi.fn(),
	};
});

vi.mock('./config.js', () => ({ scopedCachePurgeEnabled }));
vi.mock('./reap-requests.js', () => ({ requestScopedCacheIndexReap }));
vi.mock('../logger/index.js', () => ({ useLogger: () => logger }));
vi.mock('../utils/node-id.js', () => ({ nodeId: 'node-1' }));

vi.mock('../processes/lib/collect-processes.js', () => {
	return { collectProcessReports };
});

vi.mock('./store.js', () => {
	return {
		useScopedCacheStore: () => ({ endFillPause, watchFillPause }),
	};
});

beforeEach(() => {
	vi.useFakeTimers();
	// The pause is module state: a case imports it afresh, so it never starts
	// inside the window the one before opened.
	vi.resetModules();
});

afterEach(() => {
	vi.useRealTimers();
	vi.resetAllMocks();
	scopedCachePurgeEnabled.mockReturnValue(true);
	endFillPause.mockResolvedValue(true);
});

describe('scopedCacheFillPaused', () => {
	it(oneLine`
		is paused before the boot recorded the build — the first fill could be this
		build's first during a deploy
	`, async () => {
		const { scopedCacheFillPaused } = await import('./fill-pause.js');

		expect(scopedCacheFillPaused()).toBe(true);
	});

	it('never pauses outside scoped mode', async () => {
		scopedCachePurgeEnabled.mockReturnValueOnce(false);
		const { scopedCacheFillPaused } = await import('./fill-pause.js');

		expect(scopedCacheFillPaused()).toBe(false);
	});

	it('fills again at once, looking at nothing, when no pause runs', async () => {
		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(0, 'build-c');

		expect(scopedCacheFillPaused()).toBe(false);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(watchFillPause).not.toHaveBeenCalled();
		expect(requestScopedCacheIndexReap).not.toHaveBeenCalled();
	});
});

describe('pauseScopedCacheFills', () => {
	it(oneLine`
		ends the pause once three looks in a row heard only this build, and asks
		for the reap that writes the marker
	`, async () => {
		watchFillPause.mockResolvedValue({ fillPauseLeftMs: 200_000, watching: true });

		collectProcessReports
			.mockResolvedValueOnce([
				{ self: { nodeId: 'node-1', coreBuildId: 'build-c' } },
				{ self: { nodeId: 'node-9', coreBuildId: 'build-b' } },
			])
			.mockResolvedValue([
				{ self: { nodeId: 'node-1', coreBuildId: 'build-c' } },
				{ self: { nodeId: 'node-2', coreBuildId: 'build-c' } },
			]);

		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(300_000, 'build-c');

		await vi.advanceTimersByTimeAsync(15_000);
		expect(scopedCacheFillPaused()).toBe(true);
		expect(endFillPause).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5_000);
		expect(scopedCacheFillPaused()).toBe(false);
		expect(endFillPause.mock.calls).toEqual([['build-c']]);
		expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();

		expect(watchFillPause.mock.calls).toEqual([
			['node-1', 15_000],
			['node-1', 15_000],
			['node-1', 15_000],
			['node-1', 15_000],
		]);

		expect(collectProcessReports.mock.calls).toEqual([
			[[], { nodeBuildOnly: true }],
			[[], { nodeBuildOnly: true }],
			[[], { nodeBuildOnly: true }],
			[[], { nodeBuildOnly: true }],
		]);

		expect(logger.info).toHaveBeenCalledExactlyOnceWith(oneLine`
			[scoped-cache] fills resumed 20000 ms into the pause after a deploy, once
			no process of another build answered 3 looks
		`);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(watchFillPause).toHaveBeenCalledTimes(4);
	});

	it(oneLine`
		counts a process with no build in its report as the build before — one
		older than the field
	`, async () => {
		watchFillPause.mockResolvedValue({ fillPauseLeftMs: 200_000, watching: true });

		collectProcessReports.mockResolvedValue([
			{ self: { nodeId: 'node-1', coreBuildId: 'build-c' } },
			{ self: { nodeId: 'node-9' } },
		]);

		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(300_000, 'build-c');
		await vi.advanceTimersByTimeAsync(60_000);

		expect(scopedCacheFillPaused()).toBe(true);
		expect(endFillPause).not.toHaveBeenCalled();
	});

	it(oneLine`
		holds on while its own report is missing — the query reached no one, and a
		silence says nothing
	`, async () => {
		watchFillPause.mockResolvedValue({ fillPauseLeftMs: 200_000, watching: true });
		collectProcessReports.mockResolvedValue([]);

		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(300_000, 'build-c');
		await vi.advanceTimersByTimeAsync(60_000);

		expect(scopedCacheFillPaused()).toBe(true);
		expect(endFillPause).not.toHaveBeenCalled();
	});

	it(oneLine`
		starts the count again on a look that heard the build before — one
		missed answer is a busy node, not a gone one
	`, async () => {
		watchFillPause.mockResolvedValue({ fillPauseLeftMs: 200_000, watching: true });
		const thisBuild = { self: { nodeId: 'node-1', coreBuildId: 'build-c' } };
		const buildBefore = { self: { nodeId: 'node-9', coreBuildId: 'build-b' } };

		collectProcessReports
			.mockResolvedValueOnce([thisBuild])
			.mockResolvedValueOnce([thisBuild])
			.mockResolvedValueOnce([thisBuild, buildBefore])
			.mockResolvedValue([thisBuild]);

		const { pauseScopedCacheFills } = await import('./fill-pause.js');

		pauseScopedCacheFills(300_000, 'build-c');

		await vi.advanceTimersByTimeAsync(25_000);
		expect(endFillPause).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5_000);
		expect(endFillPause).toHaveBeenCalledOnce();
	});

	it(oneLine`
		starts the count again on a look that lost the watch — the quiet looks
		counted before it no longer run in a row
	`, async () => {
		watchFillPause
			.mockResolvedValueOnce({ fillPauseLeftMs: 200_000, watching: true })
			.mockResolvedValueOnce({ fillPauseLeftMs: 200_000, watching: true })
			.mockResolvedValueOnce({ fillPauseLeftMs: 200_000, watching: false })
			.mockResolvedValue({ fillPauseLeftMs: 200_000, watching: true });

		collectProcessReports.mockResolvedValue([
			{ self: { nodeId: 'node-1', coreBuildId: 'build-c' } },
		]);

		const { pauseScopedCacheFills } = await import('./fill-pause.js');

		pauseScopedCacheFills(300_000, 'build-c');

		await vi.advanceTimersByTimeAsync(25_000);
		expect(endFillPause).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5_000);
		expect(endFillPause).toHaveBeenCalledOnce();
	});

	it(oneLine`
		starts the count again on a look that failed — the quiet looks counted
		before it no longer run in a row
	`, async () => {
		watchFillPause
			.mockResolvedValueOnce({ fillPauseLeftMs: 200_000, watching: true })
			.mockResolvedValueOnce({ fillPauseLeftMs: 200_000, watching: true })
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			.mockResolvedValue({ fillPauseLeftMs: 200_000, watching: true });

		collectProcessReports.mockResolvedValue([
			{ self: { nodeId: 'node-1', coreBuildId: 'build-c' } },
		]);

		const { pauseScopedCacheFills } = await import('./fill-pause.js');

		pauseScopedCacheFills(300_000, 'build-c');

		await vi.advanceTimersByTimeAsync(25_000);
		expect(endFillPause).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5_000);
		expect(endFillPause).toHaveBeenCalledOnce();
	});

	it(oneLine`
		leaves the processes to the node holding the watch, and resumes when that
		one ended the pause
	`, async () => {
		watchFillPause
			.mockResolvedValueOnce({ fillPauseLeftMs: 200_000, watching: false })
			.mockResolvedValueOnce({ fillPauseLeftMs: 0, watching: false });

		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(300_000, 'build-c');

		await vi.advanceTimersByTimeAsync(5_000);
		expect(scopedCacheFillPaused()).toBe(true);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(scopedCacheFillPaused()).toBe(false);
		expect(collectProcessReports).not.toHaveBeenCalled();
		expect(endFillPause).not.toHaveBeenCalled();
		expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();

		expect(logger.info).toHaveBeenCalledExactlyOnceWith(oneLine`
			[scoped-cache] fills resumed 10000 ms into the pause after a deploy,
			ended by its watcher
		`);
	});

	it(oneLine`
		keeps watching when a later deploy's pause replaced this one — that one
		waits for this build to go
	`, async () => {
		watchFillPause.mockResolvedValue({ fillPauseLeftMs: 200_000, watching: true });
		endFillPause.mockResolvedValue(false);

		collectProcessReports.mockResolvedValue([
			{ self: { nodeId: 'node-1', coreBuildId: 'build-c' } },
		]);

		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(300_000, 'build-c');
		await vi.advanceTimersByTimeAsync(20_000);

		expect(scopedCacheFillPaused()).toBe(true);
		expect(endFillPause).toHaveBeenCalledTimes(2);
	});

	it(oneLine`
		resumes at its ceiling whatever still answers, even with Redis gone
	`, async () => {
		watchFillPause.mockRejectedValue(new Error('ECONNREFUSED'));

		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(12_000, 'build-c');

		await vi.advanceTimersByTimeAsync(11_999);
		expect(scopedCacheFillPaused()).toBe(true);
		expect(logger.warn).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(1);
		expect(scopedCacheFillPaused()).toBe(false);

		await vi.advanceTimersByTimeAsync(3_000);
		expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();

		expect(logger.info).toHaveBeenCalledExactlyOnceWith(oneLine`
			[scoped-cache] fills resumed 15000 ms into the pause after a deploy, at
			its ceiling
		`);
	});

	it(oneLine`
		follows the pause Redis reads on each look, and restarts its looks on a
		reconnect's reading
	`, async () => {
		watchFillPause.mockResolvedValue({ fillPauseLeftMs: 1_000, watching: false });

		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(300_000, 'build-c');
		await vi.advanceTimersByTimeAsync(2_000);
		pauseScopedCacheFills(300_000, 'build-c');

		await vi.advanceTimersByTimeAsync(5_000);
		expect(watchFillPause).toHaveBeenCalledOnce();
		expect(scopedCacheFillPaused()).toBe(true);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(scopedCacheFillPaused()).toBe(false);
	});
});
