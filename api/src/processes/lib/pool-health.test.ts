import { beforeEach, expect, test, vi } from 'vitest';
import type { PoolHealth } from './pool-health.js';

vi.mock('@directus/env');
vi.mock('../../bus/index.js');

const warn = vi.fn();

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => ({ warn }) };
});

type Publish = (channel: string, message: PoolHealth) => Promise<void>;

type Subscribe = (
	channel: string,
	handler: (health: PoolHealth) => void,
) => Promise<void>;

const publish = vi.fn<Publish>(async () => {});
const subscribe = vi.fn<Subscribe>(async () => {});

let env: Record<string, unknown> = {};

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

test('drops a reading nothing has refreshed', async () => {
	vi.useFakeTimers();

	const { initPoolHealthMirror, poolHealthReading } = await freshMirror();

	initPoolHealthMirror();

	subscribe.mock.calls[0]![1]({
		failedWorkers: 2,
		onlineWorkers: 3,
		targetWorkers: 5,
	});

	vi.advanceTimersByTime(140_000);
	expect(poolHealthReading()).not.toBeNull();

	// The reporter stops with the process that holds the supervisor
	// connection, and a pool that recovered while it was down would otherwise
	// leave every worker answering for the failure that was true back then.
	vi.advanceTimersByTime(20_000);
	expect(poolHealthReading()).toBeNull();
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

test('repeats a reading on a floor rather than on the tick', async () => {
	vi.useFakeTimers();

	const { reportPoolHealth } = await freshMirror();

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5, targetWorkers: 6 });
	expect(publish).toHaveBeenCalledTimes(1);

	// Repeated while it is still true, so a worker that booted after it was
	// first sent is answered, and so it never expires under a live reporter.
	vi.advanceTimersByTime(11_000);
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
	vi.useFakeTimers();
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

	// Including once the reading it came up on has expired.
	vi.advanceTimersByTime(200_000);
	expect(poolHasComeUp()).toBe(true);
});

test('asks nothing of a deployment whose scaling is off', async () => {
	env = { PM2_AUTOSCALE_PREWARM: 3, PM2_AUTOSCALE_ENABLED: false };

	const { poolHasComeUp } = await freshMirror();

	// Prewarm is one of the things that does not run with scaling off, so
	// holding the deployment down for it would never be answered.
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
