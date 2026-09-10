import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const connect = vi.fn((callback: (error: Error | null) => void) => callback(null));
const disconnect = vi.fn();
const list = vi.fn();
const scale = vi.fn();
const reload = vi.fn();
const sendDataToProcessId = vi.fn();

vi.mock('pm2', () => {
	return {
		default: { connect, disconnect, list, scale, reload, sendDataToProcessId },
	};
});

const platform = { ...process.env };

beforeEach(() => {
	vi.useFakeTimers();
	process.env['PM2_HOME'] = '/tmp/pm2';
	process.env['pm_id'] = '0';
	list.mockReset();
	scale.mockReset();
	reload.mockReset();
	sendDataToProcessId.mockReset();
	// Reset rather than cleared: an arm below holds a connection open to watch
	// a second one being asked for, and a mock left holding it would take the
	// rest of the file with it.
	connect.mockReset();
	disconnect.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	process.env = { ...platform };
});

/**
 * A supervisor that takes the call and never answers it, which is what a
 * daemon replaced mid-call leaves behind: pm2 holds the callback for a reply
 * nothing will send.
 */
function neverAnswers(): void {
	// The callback is deliberately dropped.
}

test('A supervised process carries both PM2_HOME and a pm id', async () => {
	const { supervisorAvailable } = await import('./client.js');

	expect(supervisorAvailable()).toBe(true);

	delete process.env['PM2_HOME'];
	expect(supervisorAvailable()).toBe(false);
});

// The Backend image exports PM2_HOME and then starts the server directly, which
// reported a broken supervisor where there is none — only PM2 sets `pm_id`.
test('PM2_HOME alone does not make a process supervised', async () => {
	const { supervisorAvailable } = await import('./client.js');

	delete process.env['pm_id'];
	expect(supervisorAvailable()).toBe(false);

	process.env['pm_id'] = '';
	expect(supervisorAvailable()).toBe(false);

	process.env['pm_id'] = 'not-a-number';
	expect(supervisorAvailable()).toBe(false);

	process.env['pm_id'] = '3';
	expect(supervisorAvailable()).toBe(true);
});

test('a process list the supervisor never answers fails the call', async () => {
	const { listSupervisedApps } = await import('./client.js');

	list.mockImplementation(neverAnswers);

	const listing = listSupervisedApps();
	const failed = expect(listing).rejects.toThrow(/did not answer a process list/);

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;
});

// pm2 finishes a connection it has already started against the client it finds
// when the socket lands, so a disconnect issued while one is in flight leaves
// that callback reading a client nothing holds. It throws from inside a socket
// handler, where no call is left to carry it, and the process dies — the freeze
// the reconnect exists to prevent, arriving by the other door. A supervisor
// restarted under a running caller asks for it from every call it left hanging.
test('a second call joins the reconnect rather than starting another', async () => {
	const { listSupervisedApps } = await import('./client.js');

	list.mockImplementation(neverAnswers);

	let landed: () => void = () => undefined;

	connect.mockImplementation((callback: (error: Error | null) => void) => {
		landed = () => callback(null);
	});

	const first = expect(listSupervisedApps()).rejects.toThrow();
	const second = expect(listSupervisedApps()).rejects.toThrow();

	await vi.advanceTimersByTimeAsync(15_000);

	// One connection taken down and one asked for, on behalf of both.
	expect(disconnect).toHaveBeenCalledOnce();
	expect(connect).toHaveBeenCalledOnce();

	landed();
	await first;
	await second;
});

// And the gate opens again whatever the reconnect did, or the first restart
// that finds no daemon to come back to freezes every call after it.
test('a reconnect that failed does not hold the next one', async () => {
	const { listSupervisedApps } = await import('./client.js');

	list.mockImplementation(neverAnswers);

	connect.mockImplementation((callback: (error: Error | null) => void) => {
		callback(new Error('no daemon to connect to'));
	});

	const failed = expect(listSupervisedApps())
		.rejects
		.toThrow(/did not answer a process list/);

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;

	const again = expect(listSupervisedApps()).rejects.toThrow();

	await vi.advanceTimersByTimeAsync(15_000);
	await again;

	expect(connect).toHaveBeenCalledTimes(2);
});

// Whether the call after this one reaches a daemon at all: the client is left
// holding the callback the dead one owed it, so giving up on the call without
// replacing the connection buys one skipped call and then every call after.
test('giving up on a call reconnects to the supervisor', async () => {
	const { listSupervisedApps } = await import('./client.js');

	list.mockImplementation(neverAnswers);

	const failed = expect(listSupervisedApps()).rejects.toThrow();

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;

	expect(disconnect).toHaveBeenCalledOnce();
	expect(connect).toHaveBeenCalledOnce();
});

test('a supervisor that answers keeps its connection', async () => {
	const { listSupervisedApps } = await import('./client.js');

	list.mockImplementation((
		callback: (error: Error | null, apps: unknown[]) => void,
	) => {
		callback(null, []);
	});

	await expect(listSupervisedApps()).resolves.toEqual([]);

	expect(disconnect).not.toHaveBeenCalled();
});

test('a scale the supervisor never answers fails the call', async () => {
	const { scaleApp } = await import('./client.js');

	scale.mockImplementation(neverAnswers);

	const scaling = scaleApp('directus', 4);
	const failed = expect(scaling).rejects.toThrow(/did not answer a scale to 4/);

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;
});

test('a scale the supervisor refuses keeps its connection', async () => {
	const { scaleApp } = await import('./client.js');

	scale.mockImplementation((
		_app: string,
		_workers: number,
		callback: (error: Error) => void,
	) => {
		callback(new Error('App not found'));
	});

	await expect(scaleApp('directus', 4)).rejects.toThrow('App not found');

	expect(disconnect).not.toHaveBeenCalled();
});

// pm2 answers a scale to the size the app already has with an error, and only
// its wording tells it apart from a real one.
test('a scale to the size the app already has is not a failure', async () => {
	const { scaleApp } = await import('./client.js');

	scale.mockImplementation((
		_app: string,
		_workers: number,
		callback: (error: Error) => void,
	) => {
		callback(new Error('Same process number'));
	});

	await expect(scaleApp('directus', 4)).resolves.toBeUndefined();
});

// pm2 checks a reload's options against its command-line schema and drops
// whatever it does not find there, so the declaration only survives while it
// is told the options have been checked already.
test('the options are handed to the reload as a checked declaration', async () => {
	const { reloadApp } = await import('./client.js');
	let flagDuringCall: string | undefined;

	reload.mockImplementation((
		_name: string,
		_options: unknown,
		callback: (error: Error | null) => void,
	) => {
		flagDuringCall = process.env['PM2_JSON_PROCESSING'];
		callback(null);
	});

	await reloadApp('directus', 30_000, { listen_timeout: 20_000 });

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
	const { reloadApp } = await import('./client.js');

	reload.mockImplementation(neverAnswers);

	const reloading = reloadApp('directus', 30_000, {});
	const failed = expect(reloading).rejects.toThrow(/did not answer a reload/);

	await vi.advanceTimersByTimeAsync(30_000);
	await failed;
});

test('a packet the supervisor never answers fails the send', async () => {
	const { sendToSupervisedProcess } = await import('./client.js');

	sendDataToProcessId.mockImplementation(neverAnswers);

	const sending = sendToSupervisedProcess(3, { topic: 'metrics' });

	const failed = expect(sending)
		.rejects
		.toThrow(/did not answer a packet to process 3/);

	await vi.advanceTimersByTimeAsync(15_000);
	await failed;
});
