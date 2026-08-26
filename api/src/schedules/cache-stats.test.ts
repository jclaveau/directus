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

const mockLogger = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../logger/index.js', () => ({ useLogger: () => mockLogger }));

// Hoisted: the automocked '../utils/schedule.js' loads the real module to build
// its shape, and that reads the env before a plain const would exist.
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('@directus/env', () => ({ useEnv: () => env }));

beforeEach(() => {
	env['CACHE_STATS_DRAIN_SCHEDULE'] = '*/10 * * * * *';
	env['CACHE_STATS_RETENTION_SCHEDULE'] = '*/10 * * * *';
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

		// Named, because an unparseable rule takes the whole pipeline down with it
		// and the variable that did it is the only useful thing to say.
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('CACHE_STATS_DRAIN_SCHEDULE'),
		);
	});

	it('takes each schedule from its own variable', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);
		env['CACHE_STATS_DRAIN_SCHEDULE'] = '*/30 * * * * *';
		env['CACHE_STATS_RETENTION_SCHEDULE'] = '*/5 * * * *';

		await cacheStatsSchedule();

		const registered = vi.mocked(scheduleSynchronizedJob).mock.calls
			.map(([name, rule]) => [name, rule]);

		expect(registered).toEqual([
			['cache-stats', '*/30 * * * * *'],
			['cache-stats-reap', '*/5 * * * *'],
		]);
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

	it('reaps the facts, then the dimensions they orphan', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		await cacheStatsSchedule();

		const reap = vi.mocked(scheduleSynchronizedJob).mock.calls.find(
			(call) => call[0] === 'cache-stats-reap',
		);

		expect(reap).toBeDefined();

		await reap![2](new Date(0));
		expect(reapCacheEvents).toHaveBeenCalled();
		expect(reapCacheAnomalies).toHaveBeenCalled();

		// The order is the rule: a fact aging out is what orphans a descriptor,
		// and a descriptor going is what orphans its entry tags. On two jobs at two
		// cadences each link waited for the next tick of the one behind it.
		const order = (job: any) => vi.mocked(job).mock.invocationCallOrder[0]!;

		expect(order(reapCacheEvents)).toBeLessThan(order(reapCacheDescriptors));

		expect(order(reapCacheDescriptors))
			.toBeLessThan(order(reapScopedCacheEntryTags));
	});

	it('registers one reap job, not two', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);

		await cacheStatsSchedule();

		const names = vi.mocked(scheduleSynchronizedJob).mock.calls
			.map(([name]) => name);

		expect(names).toEqual(['cache-stats', 'cache-stats-reap']);
	});

	it('swallows a reap error inside the scheduled job', async () => {
		vi.mocked(cacheStatsConfigured).mockReturnValue(true);
		vi.mocked(reapCacheEvents).mockRejectedValue(new Error('boom'));

		await cacheStatsSchedule();

		const reap = vi.mocked(scheduleSynchronizedJob).mock.calls.find(
			(call) => call[0] === 'cache-stats-reap',
		);

		// Without this the subscript below throws a TypeError of its own, which
		// resolves() would read as the rejection never happening.
		expect(reap).toBeDefined();

		await expect(reap![2](new Date(0))).resolves.toBeUndefined();
		expect(reapScopedCacheEntryTags).not.toHaveBeenCalled();
	});
});
