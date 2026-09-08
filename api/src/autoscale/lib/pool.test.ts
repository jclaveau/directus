import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const connect = vi.fn((callback: (error: Error | null) => void) => callback(null));
const disconnect = vi.fn();
const list = vi.fn();
const scale = vi.fn();

vi.mock('pm2', () => {
	return { default: { connect, disconnect, list, scale } };
});

beforeEach(() => {
	vi.useFakeTimers();
	list.mockReset();
	scale.mockReset();
	connect.mockClear();
	disconnect.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

/**
 * A supervisor that takes the call and never answers it, which is what a
 * daemon replaced mid-call leaves behind: pm2 holds the callback for a reply
 * nothing will send.
 */
function neverAnswers(): void {
	// The callback is deliberately dropped.
}

test('a process list the supervisor never answers fails the tick', async () => {
	const { readPool } = await import('./pool.js');

	list.mockImplementation(neverAnswers);

	const reading = readPool('directus', 30);
	const failed = expect(reading).rejects.toThrow(/did not answer a process list/);

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;
});

test('a scale the supervisor never answers fails the tick', async () => {
	const { scaleTo } = await import('./pool.js');

	scale.mockImplementation(neverAnswers);

	const scaling = scaleTo('directus', 4);
	const failed = expect(scaling).rejects.toThrow(/did not answer a scale to 4/);

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;
});

// Whether the tick after this one reaches a daemon at all: the client is left
// holding the callback the dead one owed it, so giving up on the call without
// replacing the connection buys one skipped tick and then every tick after.
test('giving up on a call reconnects to the supervisor', async () => {
	const { readPool } = await import('./pool.js');

	list.mockImplementation(neverAnswers);

	const reading = readPool('directus', 30);
	const failed = expect(reading).rejects.toThrow();

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;

	expect(disconnect).toHaveBeenCalledOnce();
	expect(connect).toHaveBeenCalledOnce();
});

test('a scale the supervisor refuses keeps its connection', async () => {
	const { scaleTo } = await import('./pool.js');

	scale.mockImplementation((
		_app: string,
		_workers: number,
		callback: (error: Error) => void,
	) => {
		callback(new Error('App not found'));
	});

	await expect(scaleTo('directus', 4)).rejects.toThrow('App not found');

	expect(disconnect).not.toHaveBeenCalled();
});

test('a supervisor that answers keeps its connection', async () => {
	const { readPool } = await import('./pool.js');

	list.mockImplementation((
		callback: (error: Error | null, apps: unknown[]) => void,
	) => {
		callback(null, []);
	});

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		onlineWorkers: [],
		pendingWorkers: 0,
	});

	expect(disconnect).not.toHaveBeenCalled();
});
