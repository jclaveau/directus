import { afterEach, describe, expect, test, vi } from 'vitest';
import { scopedCachePurgeEnabled } from '../scoped-cache/config.js';
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

	test('runs the reap on each tick', async () => {
		await scopedCacheReapSchedule();

		await vi.mocked(scheduleSynchronizedJob).mock.calls[0]![2](new Date());

		expect(runScopedCacheIndexReap).toHaveBeenCalledOnce();
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
			+ '(hourly) — expired entries stay in the index',
		);
	});
});
