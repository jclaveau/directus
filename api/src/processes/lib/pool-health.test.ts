import { beforeEach, expect, test, vi } from 'vitest';
import type { PoolHealth } from './pool-health.js';

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

/**
 * The module with its picture of the pool empty, which is every process before
 * the first reading reaches it.
 */
async function freshMirror() {
	vi.resetModules();

	const { useBus } = await import('../../bus/index.js');
	vi.mocked(useBus).mockReturnValue({ publish, subscribe } as never);

	return await import('./pool-health.js');
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
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

	deliver({ failedWorkers: 2, onlineWorkers: 3 });

	expect(poolHealthReading()).toEqual({ failedWorkers: 2, onlineWorkers: 3 });
});

test('drops a reading nothing has refreshed', async () => {
	vi.useFakeTimers();

	const { initPoolHealthMirror, poolHealthReading } = await freshMirror();

	initPoolHealthMirror();
	subscribe.mock.calls[0]![1]({ failedWorkers: 2, onlineWorkers: 3 });

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

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5 });

	expect(publish).toHaveBeenCalledWith(
		'poolHealth',
		{ failedWorkers: 1, onlineWorkers: 5 },
	);

	// The reporter is a process of the deployment too, and an unreachable bus
	// should not leave it knowing less than it has just measured.
	expect(poolHealthReading()).toEqual({ failedWorkers: 1, onlineWorkers: 5 });
});

test('repeats a reading on a floor rather than on the tick', async () => {
	vi.useFakeTimers();

	const { reportPoolHealth } = await freshMirror();

	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5 });
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5 });
	expect(publish).toHaveBeenCalledTimes(1);

	// Repeated while it is still true, so a worker that booted after it was
	// first sent is answered, and so it never expires under a live reporter.
	vi.advanceTimersByTime(61_000);
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5 });
	expect(publish).toHaveBeenCalledTimes(2);
});

test('reports a change straight away', async () => {
	const { reportPoolHealth } = await freshMirror();

	reportPoolHealth({ failedWorkers: 0, onlineWorkers: 6 });
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5 });

	expect(publish).toHaveBeenCalledTimes(2);
});

test('says what an unreachable bus costs, and carries on', async () => {
	const { initPoolHealthMirror, reportPoolHealth } = await freshMirror();

	subscribe.mockRejectedValueOnce(new Error('no redis'));
	publish.mockRejectedValueOnce(new Error('no redis'));

	initPoolHealthMirror();
	reportPoolHealth({ failedWorkers: 1, onlineWorkers: 5 });

	await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
});
