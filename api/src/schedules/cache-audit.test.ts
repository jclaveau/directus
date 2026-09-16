import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCacheAudit, type CacheAuditRunReport } from '../cache-audit-runs.js';
import getDatabase from '../database/index.js';
import { scheduleSynchronizedJob, validateCron } from '../utils/schedule.js';
import cacheAuditSchedule, {
	cacheAuditScheduleState,
	refreshCacheAuditScheduleOverride,
	resolvedCacheAuditSchedule,
} from './cache-audit.js';

vi.mock('../cache-audit-runs.js', () => ({ runCacheAudit: vi.fn() }));
vi.mock('../utils/schedule.js');
vi.mock('../database/index.js', () => ({ default: vi.fn() }));

const mockLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock('../logger/index.js', () => ({ useLogger: () => mockLogger }));

const mockBus = vi.hoisted(() => ({ publish: vi.fn(), subscribe: vi.fn() }));
vi.mock('../bus/index.js', () => ({ useBus: () => mockBus }));

const mockEmitter = vi.hoisted(() => ({ onAction: vi.fn() }));
vi.mock('../emitter.js', () => ({ default: mockEmitter }));

// Hoisted: the automocked '../utils/schedule.js' loads the real module to build
// its shape, and that reads the env before a plain const would exist.
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('@directus/env', () => ({ useEnv: () => env }));

// The handler `subscribe` registered — a peer's (or this node's own) delivery.
let busHandler: (payload: { rule: string | null }) => Promise<void>;

// The handler `onAction` registered — a settings write landing, whichever
// service performed it.
let settingsUpdateHandler: (meta: Record<string, unknown>) => void;

let settingsRow: { cache_audit_schedule: string | null } | undefined;

function report(
	overrides: Partial<CacheAuditRunReport['counts']> = {},
): CacheAuditRunReport {
	return {
		id: 1,
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

function scheduledJob(call = 0) {
	return {
		rule: vi.mocked(scheduleSynchronizedJob).mock.calls[call]![1],
		run: vi.mocked(scheduleSynchronizedJob).mock.calls[call]![2],
	};
}

async function runScheduledJob(): Promise<void> {
	await cacheAuditSchedule();
	await scheduledJob().run(new Date());
}

beforeEach(() => {
	env['CACHE_AUDIT_ENABLED'] = true;
	env['CACHE_AUDIT_SCHEDULE'] = '*/15 * * * *';
	settingsRow = { cache_audit_schedule: null };

	const builder: any = {
		select: vi.fn(() => builder),
		from: vi.fn(() => builder),
		first: vi.fn(() => Promise.resolve(settingsRow)),
	};

	vi.mocked(getDatabase).mockReturnValue(builder);
	vi.mocked(validateCron).mockImplementation((rule) => rule !== 'hourly');

	vi.mocked(scheduleSynchronizedJob).mockImplementation(() => {
		return { stop: vi.fn(async () => {}) };
	});

	mockBus.subscribe.mockImplementation((_channel: string, handler: any) => {
		busHandler = handler;
	});

	mockEmitter.onAction.mockImplementation((_event: string, handler: any) => {
		settingsUpdateHandler = handler;
	});
});

afterEach(async () => {
	// The override lives in module scope: put it back to "unset" so a value one
	// test wrote cannot leak into the next.
	settingsRow = { cache_audit_schedule: null };
	await refreshCacheAuditScheduleOverride();
	vi.clearAllMocks();
});

describe('cache-audit schedule', () => {
	it('stays off until CACHE_AUDIT_SCHEDULE is set', async () => {
		env['CACHE_AUDIT_SCHEDULE'] = '';

		expect(await cacheAuditSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
		expect(resolvedCacheAuditSchedule()).toBeNull();
	});

	it(oneLine`
		never schedules on a node with CACHE_AUDIT_ENABLED off, whichever rule
		the settings or the env carry — but still relays a settings write
	`, async () => {
		env['CACHE_AUDIT_ENABLED'] = false;
		settingsRow = { cache_audit_schedule: '0 3 * * *' };

		expect(await cacheAuditSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();
		expect(resolvedCacheAuditSchedule()).toBe('0 3 * * *');

		await busHandler({ rule: '*/5 * * * *' });
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();

		settingsUpdateHandler({ payload: { cache_audit_schedule: '0 4 * * *' } });

		expect(mockBus.publish).toHaveBeenCalledWith(
			'cacheAuditScheduleChanged',
			{ rule: '0 4 * * *' },
		);
	});

	it('stays off, and says so, on a rule that is not a cron', async () => {
		env['CACHE_AUDIT_SCHEDULE'] = 'hourly';

		expect(await cacheAuditSchedule()).toBe(false);
		expect(scheduleSynchronizedJob).not.toHaveBeenCalled();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('CACHE_AUDIT_SCHEDULE is not a cron rule (hourly)'),
		);
	});

	it('registers one synchronized job under the env rule', async () => {
		expect(await cacheAuditSchedule()).toBe(true);

		expect(scheduleSynchronizedJob).toHaveBeenCalledWith(
			'cache-audit',
			'*/15 * * * *',
			expect.any(Function),
		);
	});

	it('runs under the settings rule when one is stored', async () => {
		settingsRow = { cache_audit_schedule: '0 3 * * *' };

		expect(await cacheAuditSchedule()).toBe(true);
		expect(scheduledJob().rule).toBe('0 3 * * *');
		expect(resolvedCacheAuditSchedule()).toBe('0 3 * * *');
	});

	// A blank input on the page is a cleared one, not a rule of its own.
	it('treats a blank settings rule as unset', async () => {
		settingsRow = { cache_audit_schedule: '   ' };

		await cacheAuditSchedule();

		expect(scheduledJob().rule).toBe('*/15 * * * *');
	});

	// The settings table predates the column on a not-yet-migrated node; the env
	// rule has to run there rather than the boot dying.
	it('runs the env rule when the settings read fails', async () => {
		vi.mocked(getDatabase).mockImplementationOnce(() => {
			throw new Error('relation "directus_settings" does not exist');
		});

		expect(await cacheAuditSchedule()).toBe(true);
		expect(scheduledJob().rule).toBe('*/15 * * * *');
	});

	it('reschedules on the rule announced over the bus', async () => {
		await cacheAuditSchedule();
		const first = vi.mocked(scheduleSynchronizedJob).mock.results[0]!.value;

		await busHandler({ rule: '0 4 * * *' });

		expect(first.stop).toHaveBeenCalledOnce();
		expect(scheduledJob(1).rule).toBe('0 4 * * *');
		expect(resolvedCacheAuditSchedule()).toBe('0 4 * * *');
	});

	it('falls back to the env rule when the bus clears the override', async () => {
		settingsRow = { cache_audit_schedule: '0 3 * * *' };
		await cacheAuditSchedule();

		await busHandler({ rule: null });

		expect(scheduledJob(1).rule).toBe('*/15 * * * *');
	});

	it('stops the job when the bus clears the override and env has none', async () => {
		env['CACHE_AUDIT_SCHEDULE'] = '';
		settingsRow = { cache_audit_schedule: '0 3 * * *' };
		await cacheAuditSchedule();
		const first = vi.mocked(scheduleSynchronizedJob).mock.results[0]!.value;

		await busHandler({ rule: null });

		expect(first.stop).toHaveBeenCalledOnce();
		expect(scheduleSynchronizedJob).toHaveBeenCalledOnce();
		expect(resolvedCacheAuditSchedule()).toBeNull();
	});

	it('announces a settings write that carries the rule', async () => {
		await cacheAuditSchedule();

		expect(mockEmitter.onAction)
			.toHaveBeenCalledWith('settings.update', expect.any(Function));

		settingsUpdateHandler({ payload: { cache_audit_schedule: '0 5 * * *' } });

		expect(mockBus.publish).toHaveBeenCalledWith(
			'cacheAuditScheduleChanged',
			{ rule: '0 5 * * *' },
		);

		settingsUpdateHandler({ payload: { cache_audit_schedule: '' } });

		expect(mockBus.publish).toHaveBeenLastCalledWith(
			'cacheAuditScheduleChanged',
			{ rule: null },
		);
	});

	it('leaves the bus alone on a settings write about something else', async () => {
		await cacheAuditSchedule();

		settingsUpdateHandler({ payload: { project_name: 'x' } });
		settingsUpdateHandler({ payload: undefined });

		expect(mockBus.publish).not.toHaveBeenCalled();
	});

	it('logs a clean run as information', async () => {
		vi.mocked(runCacheAudit).mockResolvedValue(report());

		await runScheduledJob();

		expect(runCacheAudit).toHaveBeenCalledWith('cron');

		expect(mockLogger.info).toHaveBeenCalledWith(
			'[cache-audit] 5 entries in 40ms: 0 stale, 0 drifted, 0 unreplayable',
		);

		expect(mockLogger.warn).not.toHaveBeenCalled();
	});

	it.each([
		[{ stale: 2 }, '2 stale, 0 drifted, 0 unreplayable'],
		[{ tag_drift: 1, unreplayable: 3 }, '0 stale, 1 drifted, 3 unreplayable'],
	])('warns on a run finding %o', async (counts, summary) => {
		vi.mocked(runCacheAudit).mockResolvedValue(report(counts));

		await runScheduledJob();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			`[cache-audit] 5 entries in 40ms: ${summary}`,
		);

		expect(mockLogger.info).not.toHaveBeenCalled();
	});

	it('warns on a run that failed, and keeps the schedule', async () => {
		const failure = new Error('redis is away');
		vi.mocked(runCacheAudit).mockRejectedValue(failure);

		await expect(runScheduledJob()).resolves.toBeUndefined();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			failure,
			'[cache-audit] run failed. redis is away',
		);
	});
});

describe('cacheAuditScheduleState', () => {
	it('names the env rule and when it next fires', async () => {
		await refreshCacheAuditScheduleOverride();

		const state = cacheAuditScheduleState();

		expect(state).toMatchObject({
			rule: '*/15 * * * *',
			source: 'env',
			envRule: '*/15 * * * *',
		});

		// The next quarter hour: strictly ahead, within 15 minutes.
		expect(state.nextRunAt).toBeGreaterThan(Date.now());
		expect(state.nextRunAt).toBeLessThanOrEqual(Date.now() + 900_000);
	});

	it('names the settings rule over the env one', async () => {
		settingsRow = { cache_audit_schedule: '0 3 * * *' };
		await refreshCacheAuditScheduleOverride();

		expect(cacheAuditScheduleState()).toMatchObject({
			rule: '0 3 * * *',
			source: 'settings',
			envRule: '*/15 * * * *',
		});
	});

	it('has no source and no next run with no rule at all', async () => {
		env['CACHE_AUDIT_SCHEDULE'] = '';
		await refreshCacheAuditScheduleOverride();

		expect(cacheAuditScheduleState()).toEqual({
			rule: null,
			source: null,
			envRule: null,
			nextRunAt: null,
		});
	});

	// The env rule is not validated before it is read; the page must not crash
	// on it, and must not promise a next run.
	it('has no next run under a malformed env rule', async () => {
		env['CACHE_AUDIT_SCHEDULE'] = 'hourly';
		await refreshCacheAuditScheduleOverride();

		expect(cacheAuditScheduleState()).toMatchObject({
			rule: 'hourly',
			source: 'env',
			nextRunAt: null,
		});
	});
});
