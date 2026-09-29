import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted, so the factories hand the module re-imported per case the same mocks
// the cases assert on.
const { requestScopedCacheIndexReap, scopedCachePurgeEnabled } = vi.hoisted(() => {
	return {
		requestScopedCacheIndexReap: vi.fn(async () => {}),
		scopedCachePurgeEnabled: vi.fn(() => true),
	};
});

vi.mock('./config.js', () => ({ scopedCachePurgeEnabled }));
vi.mock('./reap-requests.js', () => ({ requestScopedCacheIndexReap }));

beforeEach(() => {
	vi.useFakeTimers();
	// The pause is module state: a case imports it afresh, so it never starts
	// inside the window the one before opened.
	vi.resetModules();
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
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

	it('fills again at once when no pause runs', async () => {
		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(0);

		expect(scopedCacheFillPaused()).toBe(false);
		await vi.runAllTimersAsync();
		expect(requestScopedCacheIndexReap).not.toHaveBeenCalled();
	});

	it(oneLine`
		holds fills for what is left of the pause, and asks for the reap that
		writes the marker as it closes
	`, async () => {
		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(5_000);

		await vi.advanceTimersByTimeAsync(4_999);
		expect(scopedCacheFillPaused()).toBe(true);
		expect(requestScopedCacheIndexReap).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(scopedCacheFillPaused()).toBe(false);
		expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();
	});

	it(oneLine`
		asks once for a pause read again on a reconnect, at the end the last
		reading gave
	`, async () => {
		const { pauseScopedCacheFills, scopedCacheFillPaused } = await import(
			'./fill-pause.js'
		);

		pauseScopedCacheFills(5_000);
		await vi.advanceTimersByTimeAsync(2_000);
		pauseScopedCacheFills(3_000);

		await vi.advanceTimersByTimeAsync(2_999);
		expect(scopedCacheFillPaused()).toBe(true);

		await vi.advanceTimersByTimeAsync(1);
		expect(scopedCacheFillPaused()).toBe(false);
		expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();
	});
});
