import schedule from 'node-schedule';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { oneLine } from '@directus/utils';
import { useLogger } from '../logger/index.js';
import { SynchronizedClock } from '../synchronization.js';
import { scheduleSynchronizedJob, validateCron } from './schedule.js';

vi.mock('node-schedule');
vi.mock('../logger/index.js');
vi.mock('../synchronization.js');

const warn = vi.fn();

// The tick node-schedule would call, captured so a test can fire it directly —
// the point is what happens to the promise it returns, not when it runs.
function scheduledTick(clock: Partial<SynchronizedClock>) {
	vi.mocked(useLogger).mockReturnValue({ warn } as any);
	vi.mocked(SynchronizedClock).mockReturnValue(clock as SynchronizedClock);

	const job = {
		nextInvocation: () => new Date(1),
		cancel: vi.fn(),
	};

	let tick!: (fireDate: Date) => Promise<void>;

	vi.mocked(schedule.scheduleJob).mockImplementation(((_rule: string, cb: any) => {
		tick = cb;
		return job;
	}) as any);

	return { tick: () => tick(new Date(0)), job };
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('validateCron', () => {
	test('Accepts a real rule and rejects a malformed one', () => {
		expect(validateCron('0 */6 * * *')).toBe(true);
		expect(validateCron('not a cron')).toBe(false);
	});
});

describe('scheduleSynchronizedJob', () => {
	test(oneLine`
		A failing clock claim is logged, not rethrown — node-schedule drops the promise,
		so a rejection here is an unhandled rejection and a dead process
	`, async () => {
		const clock = { set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
		const { tick } = scheduledTick(clock);

		scheduleSynchronizedJob('cache-stats', '* * * * *', vi.fn());

		await expect(tick()).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
	});

	test(oneLine`
		A failing job body is logged, not rethrown, for the same reason
	`, async () => {
		const clock = { set: vi.fn().mockResolvedValue(true) };
		const { tick } = scheduledTick(clock);
		const body = vi.fn().mockRejectedValue(new Error('boom'));

		scheduleSynchronizedJob('retention', '* * * * *', body);

		await expect(tick()).resolves.toBeUndefined();
		expect(body).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledOnce();
	});

	test('Runs the job only when it won the claim', async () => {
		const clock = { set: vi.fn().mockResolvedValue(false) };
		const { tick } = scheduledTick(clock);
		const body = vi.fn();

		scheduleSynchronizedJob('telemetry', '* * * * *', body);

		await tick();

		expect(body).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});
});
