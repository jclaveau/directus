import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cacheStatsConfigured,
	enforceCacheStatsBudget,
	drainCacheEvents,
	reapCacheAnomalies,
	reapCacheDescriptors,
	reapCacheEvents,
	reapScopedCacheEntryTags,
	refreshCacheStatsFlag,
	subscribeCacheStatsToggle,
} from '../cache-events.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';
import cacheStatsSchedule from './cache-stats.js';

vi.mock('../cache-events.js');
vi.mock('../utils/schedule.js');
vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));

beforeEach(() => {
	vi.mocked(validateCron).mockReturnValue(true);
	vi.mocked(refreshCacheStatsFlag).mockResolvedValue();
	vi.mocked(drainCacheEvents).mockResolvedValue(0);
	vi.mocked(enforceCacheStatsBudget).mockResolvedValue();
	vi.mocked(reapCacheDescriptors).mockResolvedValue(0);
	vi.mocked(reapCacheEvents).mockResolvedValue(0);
	vi.mocked(reapCacheAnomalies).mockResolvedValue(0);
	vi.mocked(reapScopedCacheEntryTags).mockResolvedValue(0);
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

	it('primes from the key then subscribes to the bus for live toggles', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		await cacheStatsSchedule();

		expect(refreshCacheStatsFlag).toHaveBeenCalled(); // durable boot read
		expect(subscribeCacheStatsToggle).toHaveBeenCalled(); // event-driven, no poll
	});

	it('swallows a flush error inside the scheduled job', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);
		vi.mocked(drainCacheEvents).mockRejectedValue(new Error('boom'));

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

		expect(drainCacheEvents).toHaveBeenCalled();
		expect(enforceCacheStatsBudget).toHaveBeenCalled();

		// Flush BEFORE enforce, so the budget check sees the just-drained size.
		expect(vi.mocked(drainCacheEvents).mock.invocationCallOrder[0]!).toBeLessThan(
			vi.mocked(enforceCacheStatsBudget).mock.invocationCallOrder[0]!,
		);
	});

	it('registers a daily reap for the fact tables', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		await cacheStatsSchedule();

		const reap = vi.mocked(scheduleSynchronizedJob).mock.calls.find(
			(call) => call[0] === 'cache-stats-reap',
		);

		expect(reap).toBeDefined();

		await reap![2](new Date(0));
		expect(reapCacheEvents).toHaveBeenCalled();
		expect(reapCacheAnomalies).toHaveBeenCalled();

		// The dimensions left the daily cycle: their disk is a peak row count, not
		// a retention window, so waiting a day for it is what let them grow.
		expect(reapCacheDescriptors).not.toHaveBeenCalled();
		expect(reapScopedCacheEntryTags).not.toHaveBeenCalled();
	});

	it('reaps the dimensions on their own short cadence', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		await cacheStatsSchedule();

		const reap = vi.mocked(scheduleSynchronizedJob).mock.calls.find(
			(call) => call[0] === 'cache-stats-dimension-reap',
		);

		expect(reap).toBeDefined();

		await reap![2](new Date(0));
		expect(reapCacheDescriptors).toHaveBeenCalled();

		// Descriptors first: a tag row is an orphan once its descriptor is gone, so
		// this order hands the second reaper the rows the first just orphaned.
		expect(vi.mocked(reapCacheDescriptors).mock.invocationCallOrder[0]!)
			.toBeLessThan(
				vi.mocked(reapScopedCacheEntryTags).mock.invocationCallOrder[0]!,
			);
	});

	it('swallows a dimension reap error inside the scheduled job', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);
		vi.mocked(reapCacheDescriptors).mockRejectedValue(new Error('boom'));

		await cacheStatsSchedule();

		const reap = vi.mocked(scheduleSynchronizedJob).mock.calls.find(
			(call) => call[0] === 'cache-stats-dimension-reap',
		);

		// Without this the subscript below throws a TypeError of its own, which
		// resolves() would read as the rejection never happening.
		expect(reap).toBeDefined();

		await expect(reap![2](new Date(0))).resolves.toBeUndefined();
		expect(reapScopedCacheEntryTags).not.toHaveBeenCalled();
	});
});
