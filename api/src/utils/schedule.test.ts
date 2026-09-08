import schedule from 'node-schedule';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { oneLine } from '@directus/utils';
import { useLogger } from '../logger/index.js';
import { migrationsAreOutstanding } from '../outstanding-migrations.js';
import { SynchronizedClock } from '../synchronization.js';
import { scheduleSynchronizedJob, validateCron } from './schedule.js';

vi.mock('node-schedule');
vi.mock('../logger/index.js');
vi.mock('../outstanding-migrations.js');
vi.mock('../synchronization.js');

const warn = vi.fn();
const info = vi.fn();

// The tick node-schedule would call, captured so a test can fire it directly —
// the point is what happens to the promise it returns, not when it runs.
function scheduledTick(clock: Partial<SynchronizedClock>) {
	vi.mocked(useLogger).mockReturnValue({ warn, info } as any);
	vi.mocked(SynchronizedClock).mockReturnValue(clock as SynchronizedClock);

	// clearAllMocks leaves implementations behind, so every test starts from the
	// caught-up reading and says so itself when it wants the other one.
	vi.mocked(migrationsAreOutstanding).mockReturnValue(false);

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

	test('Runs the job when it won the claim, and logs nothing', async () => {
		const clock = { set: vi.fn().mockResolvedValue(true) };
		const { tick } = scheduledTick(clock);
		const body = vi.fn().mockResolvedValue(undefined);

		scheduleSynchronizedJob('cache-stats', '* * * * *', body);

		await tick();

		expect(body).toHaveBeenCalledWith(new Date(0));
		expect(warn).not.toHaveBeenCalled();
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

describe('scheduleSynchronizedJob, with migrations outstanding', () => {
	test(oneLine`
		The tick does not claim the cluster's slot — a node that cannot write through
		this schema must leave the slot to one that can, rather than winning it and
		dropping the work every other node is then locked out of
	`, async () => {
		const clock = { set: vi.fn().mockResolvedValue(true) };
		const { tick } = scheduledTick(clock);
		const body = vi.fn();

		vi.mocked(migrationsAreOutstanding).mockReturnValue(true);
		scheduleSynchronizedJob('held-drain', '* * * * *', body);

		await tick();

		expect(clock.set).not.toHaveBeenCalled();
		expect(body).not.toHaveBeenCalled();
	});

	test('The wait is reported once, not once a tick', async () => {
		const { tick } = scheduledTick({ set: vi.fn().mockResolvedValue(true) });

		vi.mocked(migrationsAreOutstanding).mockReturnValue(true);
		scheduleSynchronizedJob('quiet-drain', '* * * * *', vi.fn());

		await tick();
		await tick();

		expect(warn).toHaveBeenCalledOnce();
	});

	test(oneLine`
		Two registrations of one id each report their own wait — a reloaded extension
		re-registers the id it had, and state outliving the job would swallow the
		second's warning and leak the first's
	`, async () => {
		const { tick: firstTick } = scheduledTick({ set: vi.fn() });
		vi.mocked(migrationsAreOutstanding).mockReturnValue(true);
		scheduleSynchronizedJob('reloaded-flow', '* * * * *', vi.fn());
		await firstTick();

		const { tick: secondTick } = scheduledTick({ set: vi.fn() });
		vi.mocked(migrationsAreOutstanding).mockReturnValue(true);
		scheduleSynchronizedJob('reloaded-flow', '* * * * *', vi.fn());
		await secondTick();

		expect(warn).toHaveBeenCalledTimes(2);
	});

	test('The job resumes, and says so, once the database has caught up', async () => {
		const { tick } = scheduledTick({ set: vi.fn().mockResolvedValue(true) });
		const body = vi.fn();

		vi.mocked(migrationsAreOutstanding).mockReturnValue(true);
		scheduleSynchronizedJob('resuming-drain', '* * * * *', body);
		await tick();

		vi.mocked(migrationsAreOutstanding).mockReturnValue(false);
		await tick();

		expect(body).toHaveBeenCalledOnce();

		expect(info).toHaveBeenCalledWith(
			'[schedule] resuming job "resuming-drain"',
		);
	});
});
