import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditCache, type CacheAuditReport } from '../cache-audit.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';
import cacheAuditSchedule from './cache-audit.js';

vi.mock('../cache-audit.js', () => ({ auditCache: vi.fn() }));
vi.mock('../utils/schedule.js');

const mockLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock('../logger/index.js', () => ({ useLogger: () => mockLogger }));

// Hoisted: the automocked '../utils/schedule.js' loads the real module to build
// its shape, and that reads the env before a plain const would exist.
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('@directus/env', () => ({ useEnv: () => env }));

function report(
	overrides: Partial<CacheAuditReport['counts']> = {},
): CacheAuditReport {
	return {
		scanned: 5,
		counts: {
			fresh: 5,
			stale: 0,
			tag_drift: 0,
			raced: 0,
			time_varying: 0,
			expired: 0,
			unreplayable: 0,
			...overrides,
		},
		findings: [],
		evicted: 0,
		durationMs: 40,
	};
}

async function runScheduledJob(): Promise<void> {
	await cacheAuditSchedule();

	const [, , job] = vi.mocked(scheduleSynchronizedJob).mock.calls[0]!;

	await job(new Date());
}

beforeEach(() => {
	env['CACHE_AUDIT_SCHEDULE'] = '*/15 * * * *';
	vi.mocked(validateCron).mockReturnValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('cache-audit schedule', () => {
	it('stays off until CACHE_AUDIT_SCHEDULE is set', async () => {
		env['CACHE_AUDIT_SCHEDULE'] = '';

		expect(await cacheAuditSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
	});

	it('stays off, and says so, on a rule that is not a cron', async () => {
		env['CACHE_AUDIT_SCHEDULE'] = 'hourly';
		vi.mocked(validateCron).mockReturnValue(false);

		expect(await cacheAuditSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('CACHE_AUDIT_SCHEDULE is not a cron rule (hourly)'),
		);
	});

	it('registers one synchronized job under the rule', async () => {
		expect(await cacheAuditSchedule()).toBe(true);

		expect(scheduleSynchronizedJob).toHaveBeenCalledWith(
			'cache-audit',
			'*/15 * * * *',
			expect.any(Function),
		);
	});

	it('logs a clean run as information', async () => {
		vi.mocked(auditCache).mockResolvedValue(report());

		await runScheduledJob();

		expect(auditCache).toHaveBeenCalledWith();

		expect(mockLogger.info).toHaveBeenCalledWith(
			'[cache-audit] 5 entries in 40ms: 0 stale, 0 drifted, 0 unreplayable',
		);

		expect(mockLogger.warn).not.toHaveBeenCalled();
	});

	it.each([
		[{ stale: 2 }, '2 stale, 0 drifted, 0 unreplayable'],
		[{ tag_drift: 1, unreplayable: 3 }, '0 stale, 1 drifted, 3 unreplayable'],
	])('warns on a run finding %o', async (counts, summary) => {
		vi.mocked(auditCache).mockResolvedValue(report(counts));

		await runScheduledJob();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			`[cache-audit] 5 entries in 40ms: ${summary}`,
		);

		expect(mockLogger.info).not.toHaveBeenCalled();
	});

	it('warns on a run that failed, and keeps the schedule', async () => {
		const failure = new Error('redis is away');
		vi.mocked(auditCache).mockRejectedValue(failure);

		await expect(runScheduledJob()).resolves.toBeUndefined();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			failure,
			'[cache-audit] run failed. redis is away',
		);
	});
});
