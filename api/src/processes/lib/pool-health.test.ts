import { beforeEach, expect, test, vi } from 'vitest';
import type { PoolHealth } from './pool-health.js';

vi.mock('@directus/env');
vi.mock('../../bus/index.js');

vi.mock('../../redis/index.js', () => {
	return { redisConfigAvailable: () => redisAvailable };
});

const warn = vi.fn();

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => ({ warn }) };
});

type Publish = (
	channel: string,
	message: PoolHealth | null | object,
) => Promise<void>;

type Subscribe = (
	channel: string,
	handler: (health: PoolHealth | null) => void,
) => Promise<void>;

const publish = vi.fn<Publish>(async () => {});
const subscribe = vi.fn<Subscribe>(async () => {});

let env: Record<string, unknown> = {};
let redisAvailable = true;

/**
 * The module with its picture of the pool empty, which is every process before
 * the first reading reaches it.
 */
async function freshMirror() {
	vi.resetModules();

	const { useBus } = await import('../../bus/index.js');
	vi.mocked(useBus).mockReturnValue({ publish, subscribe } as never);

	const { useEnv } = await import('@directus/env');
	vi.mocked(useEnv).mockReturnValue(env);

	return await import('./pool-health.js');
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
	env = {};
	redisAvailable = true;
});

test('answers nothing until something has reported a pool', async () => {
	const { poolHealthReading } = await freshMirror();

	expect(poolHealthReading()).toBeNull();
});

test('carries the reading the bus delivers', async () => {
	const { initPoolHealthMirror, poolHealthReading } = await freshMirror();

	initPoolHealthMirror();

	const [channel, deliver] = subscribe.mock.calls[0]!;
	expect(channel).toBe('poolHealth');

	deliver({ failedWorkers: 2, onlineWorkers: 3, targetWorkers: 5 });

	expect(poolHealthReading()).toEqual({
		failedWorkers: 2,
		onlineWorkers: 3,
		targetWorkers: 5,
	});
});

test('keeps a reading however long nothing changes it', async () => {
	vi.useFakeTimers();

	const { initPoolHealthMirror, poolHealthReading } = await freshMirror();

	initPoolHealthMirror();

	subscribe.mock.calls[0]![1]({
		failedWorkers: 2,
		onlineWorkers: 3,
		targetWorkers: 5,
	});

	vi.advanceTimersByTime(3_600_000);

	expect(poolHealthReading()).toEqual({
		failedWorkers: 2,
		onlineWorkers: 3,
		targetWorkers: 5,
	});
});

test('forgets a reading its reporter took back', async () => {
	const { initPoolHealthMirror, poolHealthReading } = await freshMirror();

	initPoolHealthMirror();
	const deliver = subscribe.mock.calls[0]![1];

	deliver({ failedWorkers: 2, onlineWorkers: 3, targetWorkers: 5 });

	// A pool that recovered while the reporter was down would otherwise leave
	// every worker answering for the failure that was true when it stopped.
	deliver(null);

	expect(poolHealthReading()).toBeNull();
});

test('asks for the reading once subscribed', async () => {
	const { initPoolHealthMirror } = await freshMirror();

	initPoolHealthMirror();

	await vi.waitFor(() => {
		expect(publish).toHaveBeenCalledWith('poolHealth:query', {});
	});
});

test('reports a pool, and reads its own report', async () => {
	const { reportPoolHealth, poolHealthReading } = await freshMirror();

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });

	expect(publish).toHaveBeenCalledWith(
		'poolHealth',
		{ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 },
	);

	// The reporter is a process of the deployment too, and an unreachable bus
	// should not leave it knowing less than it has just measured.
	expect(poolHealthReading()).toEqual({
		failedWorkers: 1,
		onlineWorkers: 5,
		targetWorkers: 6,
	});
});

test('sends an unchanged reading once, however long it holds', async () => {
	vi.useFakeTimers();

	const { reportPoolHealth } = await freshMirror();

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });

	// A pool holding still puts nothing on the bus, so a platform that stops an
	// idle service after ten minutes without traffic can stop this one.
	vi.advanceTimersByTime(3_600_000);
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });

	expect(publish).toHaveBeenCalledTimes(1);
});

test('answers a query with the last reading', async () => {
	const { answerPoolHealthQueries, reportPoolHealth } = await freshMirror();

	await answerPoolHealthQueries();
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });

	const [channel, answer] = subscribe.mock.calls[0]!;
	expect(channel).toBe('poolHealth:query');

	answer(null);

	expect(publish).toHaveBeenNthCalledWith(
		2,
		'poolHealth',
		{ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 },
	);
});

test('answers no query before the pool was measured', async () => {
	const { answerPoolHealthQueries } = await freshMirror();

	await answerPoolHealthQueries();
	subscribe.mock.calls[0]![1](null);

	expect(publish).not.toHaveBeenCalled();
});

test('takes the reading back, and sends it again on the next tick', async () => {
	const {
		answerPoolHealthQueries,
		reportPoolHealth,
		withdrawPoolHealth,
	} = await freshMirror();

	await answerPoolHealthQueries();
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });
	await withdrawPoolHealth();

	expect(publish).toHaveBeenLastCalledWith('poolHealth', null);

	// Taken back, nothing is left to answer a query with.
	subscribe.mock.calls[0]![1](null);
	expect(publish).toHaveBeenCalledTimes(2);

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });
	expect(publish).toHaveBeenCalledTimes(3);
});

test('sends a reading the bus refused again on the next tick', async () => {
	const { reportPoolHealth } = await freshMirror();

	publish.mockRejectedValueOnce(new Error('no redis'));

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });
	await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });

	expect(publish).toHaveBeenCalledTimes(2);
});

test('reports a change straight away', async () => {
	const { reportPoolHealth } = await freshMirror();

	reportPoolHealth({ failedWorkers: 0, onlineWorkers: 6, targetWorkers: 6 });
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });

	expect(publish).toHaveBeenCalledTimes(2);
});

test('reports a target that moved under an unchanged pool', async () => {
	const { reportPoolHealth } = await freshMirror();

	reportPoolHealth({ failedWorkers: 0, onlineWorkers: 2, targetWorkers: 2 });
	reportPoolHealth({ failedWorkers: 0, onlineWorkers: 2, targetWorkers: 4 });

	expect(publish).toHaveBeenCalledTimes(2);
});

test('says a pool has come up where none was asked for', async () => {
	const { poolHasComeUp } = await freshMirror();

	// Nothing has reported anything, which is every deployment that runs no
	// autoscaler: it must not be held down waiting for one.
	expect(poolHasComeUp()).toBe(true);
});

test('holds a deployment that asked for a prewarm it has not reached', async () => {
	env = { PM2_AUTOSCALE_PREWARM: 3 };

	const { initPoolHealthMirror, poolHasComeUp } = await freshMirror();

	initPoolHealthMirror();
	expect(poolHasComeUp()).toBe(false);

	subscribe.mock.calls[0]![1]({
		failedWorkers: 0,
		onlineWorkers: 2,
		targetWorkers: 3,
	});

	expect(poolHasComeUp()).toBe(false);
});

test('holds a prewarm the supervisor cannot complete', async () => {
	env = { PM2_AUTOSCALE_PREWARM: 3 };

	const { initPoolHealthMirror, poolHasComeUp } = await freshMirror();

	initPoolHealthMirror();

	// At the size it was asked for, but one of them is not running: the pool
	// serving is still short of the one the deployment was told to have.
	subscribe.mock.calls[0]![1]({
		failedWorkers: 1,
		onlineWorkers: 3,
		targetWorkers: 3,
	});

	expect(poolHasComeUp()).toBe(false);
});

test('lets a deployment through once its pool is up, for good', async () => {
	env = { PM2_AUTOSCALE_PREWARM: 3 };

	const { initPoolHealthMirror, poolHasComeUp } = await freshMirror();

	initPoolHealthMirror();
	const deliver = subscribe.mock.calls[0]![1];

	deliver({ failedWorkers: 0, onlineWorkers: 3, targetWorkers: 3 });
	expect(poolHasComeUp()).toBe(true);

	// A worker lost afterwards is the warning the other half of this carries.
	// Answering it with an error would take a serving deployment out of
	// rotation on a restart nothing is watching for.
	deliver({ failedWorkers: 1, onlineWorkers: 2, targetWorkers: 3 });
	expect(poolHasComeUp()).toBe(true);

	// Including once the reading it came up on was taken back.
	deliver(null);
	expect(poolHasComeUp()).toBe(true);
});

test('asks nothing of a deployment whose scaling is off', async () => {
	env = { PM2_AUTOSCALE_PREWARM: 3, PM2_AUTOSCALE_ENABLED: false };

	const { poolHasComeUp } = await freshMirror();

	// Prewarm is one of the things that does not run with scaling off, so
	// holding the deployment down for it would never be answered.
	expect(poolHasComeUp()).toBe(true);
});

test('asks nothing of a deployment with no bus to be told on', async () => {
	env = { PM2_AUTOSCALE_PREWARM: 3 };
	redisAvailable = false;

	const { poolHasComeUp } = await freshMirror();

	// Without Redis each process subscribes to an emitter it shares with
	// nobody, so the reading that lifts the hold is published where no worker
	// hears it. Held, this deployment would answer every probe with an error
	// for as long as it ran, and the platform gating on that would never
	// switch traffic onto it.
	expect(poolHasComeUp()).toBe(true);
});

test('says what an unreachable bus costs, and carries on', async () => {
	const { initPoolHealthMirror, reportPoolHealth } = await freshMirror();

	subscribe.mockRejectedValueOnce(new Error('no redis'));
	publish.mockRejectedValueOnce(new Error('no redis'));

	initPoolHealthMirror();
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });

	await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
});
