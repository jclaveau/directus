import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const connect = vi.fn((callback: (error: Error | null) => void) => callback(null));
const disconnect = vi.fn();
const list = vi.fn();
const scale = vi.fn();
const reload = vi.fn();

vi.mock('pm2', () => {
	return { default: { connect, disconnect, list, scale, reload } };
});

beforeEach(() => {
	vi.useFakeTimers();
	list.mockReset();
	scale.mockReset();
	reload.mockReset();
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

// What the pool is running under is asked of the supervisor rather than of this
// process's environment: the api worker serving the page that shows it was
// started by the same declaration, but a deployment scaling an app it does not
// itself belong to would report its own.
test('the declaration is read off the workers the supervisor listed', async () => {
	const { readPool } = await import('./pool.js');

	list.mockImplementation((
		callback: (error: Error | null, apps: unknown[]) => void,
	) => {
		callback(null, [
			{
				name: 'directus',
				pm_id: 0,
				pid: 100,
				monit: { cpu: 10, memory: 0 },
				pm2_env: {
					status: 'online',
					pm_uptime: 0,
					instances: 2,
					exec_mode: 'cluster_mode',
					kill_timeout: 30_000,
					wait_ready: true,
				},
			},
		]);
	});

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		supervisor: {
			instances: 2,
			execMode: 'cluster_mode',
			killTimeout: 30_000,
			waitReady: true,
		},
	});
});

test('a pool with no worker reports no declaration', async () => {
	const { readPool } = await import('./pool.js');

	list.mockImplementation((
		callback: (error: Error | null, apps: unknown[]) => void,
	) => {
		callback(null, []);
	});

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		supervisor: null,
	});
});

// pm2 checks a reload's options against its command-line schema and drops
// whatever it does not find there, so the declaration only survives while it
// is told the options have been checked already.
test('the options are handed to the reload as a checked declaration', async () => {
	const { reloadPool } = await import('./pool.js');
	let flagDuringCall: string | undefined;

	reload.mockImplementation((
		_name: string,
		_options: unknown,
		callback: (error: Error | null) => void,
	) => {
		flagDuringCall = process.env['PM2_JSON_PROCESSING'];
		callback(null);
	});

	await reloadPool('directus', 30_000, { listen_timeout: 20_000 });

	expect(reload).toHaveBeenCalledWith(
		'directus',
		{ current_conf: { listen_timeout: 20_000 } },
		expect.any(Function),
	);

	expect(flagDuringCall).toBe('true');

	// The flag is process-wide, so a reload leaves it as it found it rather
	// than making every later pm2 call skip the same check.
	expect(process.env['PM2_JSON_PROCESSING']).toBeUndefined();
});

test('a reload the supervisor never answers fails the restart', async () => {
	const { reloadPool } = await import('./pool.js');

	reload.mockImplementation(neverAnswers);

	const reloading = reloadPool('directus', 30_000, {});
	const failed = expect(reloading).rejects.toThrow(/did not answer a reload/);

	await vi.advanceTimersByTimeAsync(30_000);
	await failed;
});
