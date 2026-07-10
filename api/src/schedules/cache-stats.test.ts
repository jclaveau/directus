import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cacheStatsConfigured,
	enforceCacheStatsBudget,
	flushCacheEvents,
	reapCacheDescriptors,
	refreshCacheStatsFlag,
} from '../cache-events.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';
import cacheStatsSchedule from './cache-stats.js';

vi.mock('../cache-events.js');
vi.mock('../utils/schedule.js');
vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));

beforeEach(() => {
	vi.mocked(validateCron).mockReturnValue(true);
	vi.mocked(refreshCacheStatsFlag).mockResolvedValue();
	vi.mocked(flushCacheEvents).mockResolvedValue(0);
	vi.mocked(enforceCacheStatsBudget).mockResolvedValue();
	vi.mocked(reapCacheDescriptors).mockResolvedValue(0);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('cache-stats schedule', () => {
	it('does not register when stats are not configured', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(false);

		expect(await cacheStatsSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
	});

	it('does not register when the cron rule is invalid', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);
		vi.mocked(validateCron).mockReturnValue(false);

		expect(await cacheStatsSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
	});

	it('refreshes the flag on each interval tick', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);
		const timer = { unref: vi.fn() };
		const spy = vi.spyOn(global, 'setInterval').mockReturnValue(timer as any);

		await cacheStatsSchedule();
		vi.mocked(refreshCacheStatsFlag).mockClear();

		const tick = spy.mock.calls[0]![0] as () => void;
		tick();
		await Promise.resolve();

		expect(refreshCacheStatsFlag).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('swallows a flush error inside the scheduled job', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);
		vi.mocked(flushCacheEvents).mockRejectedValue(new Error('boom'));

		await cacheStatsSchedule();
		const job = vi.mocked(scheduleSynchronizedJob).mock.calls[0]![2];

		await expect(job(new Date(0))).resolves.toBeUndefined();
		expect(enforceCacheStatsBudget).not.toHaveBeenCalled();
	});

	it('primes the flag and registers the flush job when configured', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		expect(await cacheStatsSchedule()).toBe(true);
		expect(refreshCacheStatsFlag).toHaveBeenCalled();

		expect(scheduleSynchronizedJob).toHaveBeenCalledWith(
			'cache-stats',
			expect.any(String),
			expect.any(Function),
		);
	});

	it('the scheduled job flushes then enforces the budget', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		await cacheStatsSchedule();

		const job = vi.mocked(scheduleSynchronizedJob).mock.calls[0]![2];
		await job(new Date(0));

		expect(flushCacheEvents).toHaveBeenCalled();
		expect(enforceCacheStatsBudget).toHaveBeenCalled();
	});

	it('registers a daily reap job that prunes descriptors', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		await cacheStatsSchedule();

		const reap = vi.mocked(scheduleSynchronizedJob).mock.calls.find(
			(call) => call[0] === 'cache-stats-reap',
		);

		expect(reap).toBeDefined();

		await reap![2](new Date(0));
		expect(reapCacheDescriptors).toHaveBeenCalled();
	});
});
