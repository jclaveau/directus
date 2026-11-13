import { afterEach, describe, expect, test, vi } from 'vitest';
import { scopedCachePurgeEnabled } from '../scoped-cache/config.js';
import { scopedCacheFillPaused } from '../scoped-cache/fill-pause.js';
import { runScopedCacheIndexReap } from '../scoped-cache/reap-requests.js';
import { scheduleSynchronizedJob } from '../utils/schedule.js';
import scopedCacheReapSchedule from './scoped-cache-reap.js';

const env = vi.hoisted((): Record<string, string> => {
	return { CACHE_SCOPED_INDEX_REAP_SCHEDULE: '0 * * * *' };
});

const warn = vi.hoisted(() => vi.fn());

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn }) }));

vi.mock('../scoped-cache/config.js', () => {
	return { scopedCachePurgeEnabled: vi.fn(() => true) };
});

vi.mock('../scoped-cache/fill-pause.js', () => {
	return { scopedCacheFillPaused: vi.fn(() => false) };
});

vi.mock('../scoped-cache/reap-requests.js', () => {
	return { runScopedCacheIndexReap: vi.fn() };
});

vi.mock('../utils/schedule.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('../utils/schedule.js')>();

	return { ...original, scheduleSynchronizedJob: vi.fn() };
});

afterEach(() => {
	vi.clearAllMocks();
	env['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '0 * * * *';
});

describe('scoped-cache-reap', () => {
	test('schedules the reap on the configured rule', async () => {
		expect(await scopedCacheReapSchedule()).toBe(true);

		expect(scheduleSynchronizedJob).toHaveBeenCalledWith(
			'scoped-cache-index-reap',
			'0 * * * *',
			expect.any(Function),
		);
	});

	test('runs the reap on each tick with fills not paused', async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValueOnce(false);

		await scopedCacheReapSchedule();

		await vi.mocked(scheduleSynchronizedJob).mock.calls[0]![2](new Date());

		expect(runScopedCacheIndexReap).toHaveBeenCalledOnce();
	});

	// The pause refuses the mark a pass writes, and its end asks for the one
	// pass that writes it.
	test('skips the reap on a tick while fills are paused', async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValueOnce(true);

		await scopedCacheReapSchedule();

		await vi.mocked(scheduleSynchronizedJob).mock.calls[0]![2](new Date());

		expect(runScopedCacheIndexReap).not.toHaveBeenCalled();
	});

	test('logs a failed reap rather than throwing it out of the tick', async () => {
		vi.mocked(runScopedCacheIndexReap)
			.mockRejectedValueOnce(new Error('Connection is closed.'));

		await scopedCacheReapSchedule();

		await vi.mocked(scheduleSynchronizedJob).mock.calls[0]![2](new Date());

		expect(warn).toHaveBeenCalledWith(
			new Error('Connection is closed.'),
			'[scoped-cache] reaping the index failed: Error: Connection is closed.',
		);
	});

	test('schedules nothing with scoped purging off', async () => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValueOnce(false);

		expect(await scopedCacheReapSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
	});

	test('warns and schedules nothing on a rule that is not cron', async () => {
		env['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = 'hourly';

		expect(await scopedCacheReapSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();

		expect(warn).toHaveBeenCalledWith(
			'[scoped-cache] CACHE_SCOPED_INDEX_REAP_SCHEDULE is not a cron rule '
			+ '(hourly) — only a flush or a boot reaps the index, so '
			+ 'expired entries pile up in it between them',
		);
	});
});
