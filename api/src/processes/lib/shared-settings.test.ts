import type { EventContext } from '@directus/types';
import { beforeEach, expect, test, vi } from 'vitest';
import { useEnv } from '@directus/env';
import {
	SHARED_SETTINGS_COLUMNS,
	initSharedSettings,
	onSharedSettingsChanged,
	readAllSharedSettings,
	readSharedSettings,
	sharedSettingsPollMs,
	writeSharedSettings,
	type SharedSettingsChange,
} from './shared-settings.js';

vi.mock('@directus/env');
vi.mock('../../database/index.js');
vi.mock('../../services/settings.js');
vi.mock('../../bus/index.js');
vi.mock('../../emitter.js');

const warn = vi.fn();

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => ({ warn }) };
});

const first = vi.fn();

// Typed as the bus declares them, so an arm can take the handler back off the
// call and answer with it — and so a floating promise here reads as one.
type Publish = (channel: string, message: SharedSettingsChange) => Promise<void>;

type Subscribe = (
	channel: string,
	handler: (change: SharedSettingsChange) => void,
) => Promise<void>;

const publish = vi.fn<Publish>(async () => {});
const subscribe = vi.fn<Subscribe>(async () => {});

const options = { schema: { collections: {} } } as never;

/** Stands in for the singleton row, whose column the read is taken from. */
async function settingsHolding(stored: unknown) {
	const { default: getDatabase } = await import('../../database/index.js');

	first.mockResolvedValue(
		stored === undefined
			? undefined
			: { [SHARED_SETTINGS_COLUMNS.autoscale]: stored },
	);

	vi.mocked(getDatabase).mockReturnValue({
		select: () => ({ from: () => ({ first }) }),
	} as never);
}

async function busReady() {
	const { useBus } = await import('../../bus/index.js');
	vi.mocked(useBus).mockReturnValue({ publish, subscribe } as never);
}

beforeEach(() => {
	vi.clearAllMocks();

	// A deployment that names no database never reaches one, so every arm below
	// that expects a read has to say that this one names one.
	vi.mocked(useEnv).mockReturnValue({ DB_CLIENT: 'pg' });
});

// `getDatabase` reports a missing connection by ending the process rather than
// by throwing, so a caller asking for a tuning value cannot catch it: the
// question has to be answered before the connection is reached for.
test('answers nothing where the deployment names no database', async () => {
	await settingsHolding({ maxWorkers: 8 });
	vi.mocked(useEnv).mockReturnValue({});

	await expect(readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale))
		.resolves.toBeNull();

	await expect(readAllSharedSettings()).resolves.toEqual({
		autoscale_settings: null,
		supervisor_settings: null,
	});

	expect(first).not.toHaveBeenCalled();
});

// A page reads both, and a value it shows could have come from either, so they
// are taken in one statement rather than a row at a time.
test('reads both columns in a single statement', async () => {
	const { default: getDatabase } = await import('../../database/index.js');

	first.mockResolvedValue({
		[SHARED_SETTINGS_COLUMNS.autoscale]: { maxWorkers: 8 },
		[SHARED_SETTINGS_COLUMNS.supervisor]: JSON.stringify({ listenTimeout: 20 }),
	});

	const select = vi.fn(() => ({ from: () => ({ first }) }));
	vi.mocked(getDatabase).mockReturnValue({ select } as never);

	await expect(readAllSharedSettings()).resolves.toEqual({
		autoscale_settings: { maxWorkers: 8 },
		supervisor_settings: { listenTimeout: 20 },
	});

	expect(select).toHaveBeenCalledTimes(1);
});

test('reads the column the way Postgres answers it', async () => {
	await settingsHolding({ maxWorkers: 8 });

	await expect(readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale))
		.resolves.toEqual({ maxWorkers: 8 });
});

// A JSON column comes back parsed on Postgres and as a string on sqlite, so a
// reader that took either one alone would work on one vendor and see nothing
// stored on the other.
test('reads the column the way sqlite answers it', async () => {
	await settingsHolding(JSON.stringify({ maxWorkers: 8 }));

	await expect(readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale))
		.resolves.toEqual({ maxWorkers: 8 });
});

test('answers nothing for a column edited into unparseable JSON', async () => {
	await settingsHolding('{ not json');

	await expect(readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale))
		.resolves.toBeNull();
});

// An array parses, so the JSON check alone would hand the loop something whose
// every field lookup answers undefined — read as an environment nobody set.
test('answers nothing for a column holding an array', async () => {
	await settingsHolding(JSON.stringify([{ maxWorkers: 8 }]));

	await expect(readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale))
		.resolves.toBeNull();
});

// The API image never runs migrations, so a node can boot against a singleton
// that has no such column and has to scale on its environment rather than not
// scale at all.
test('answers nothing where the singleton has no row', async () => {
	await settingsHolding(undefined);

	await expect(readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale))
		.resolves.toBeNull();
});

// Through the singleton and not a knex update: the revision is what answers who
// raised a ceiling once the stamp has been overwritten by the next change.
test('writes through the settings singleton', async () => {
	const { SettingsService } = await import('../../services/settings.js');

	await writeSharedSettings(
		SHARED_SETTINGS_COLUMNS.autoscale,
		{ maxWorkers: 8 },
		options,
	);

	expect(SettingsService).toHaveBeenCalledWith(options);

	expect(SettingsService.prototype.upsertSingleton)
		.toHaveBeenCalledWith({ autoscale_settings: { maxWorkers: 8 } });
});

test('clears the column by writing nothing into it', async () => {
	const { SettingsService } = await import('../../services/settings.js');

	await writeSharedSettings(SHARED_SETTINGS_COLUMNS.supervisor, null, options);

	expect(SettingsService.prototype.upsertSingleton)
		.toHaveBeenCalledWith({ supervisor_settings: null });
});

// One channel carries both columns, so a subscriber that answered every message
// would re-read the table each time the other one moved.
test('answers only the column it subscribed to', async () => {
	await busReady();

	const reread = vi.fn();
	onSharedSettingsChanged(SHARED_SETTINGS_COLUMNS.autoscale, reread);

	const [, announce] = vi.mocked(subscribe).mock.calls[0]!;

	announce({ column: SHARED_SETTINGS_COLUMNS.supervisor });
	expect(reread).not.toHaveBeenCalled();

	announce({ column: SHARED_SETTINGS_COLUMNS.autoscale });
	expect(reread).toHaveBeenCalledTimes(1);
});

// From the action rather than the service, so a config-sync import writing the
// singleton through a plain ItemsService announces like every other writer.
test('announces a write to either column, and nothing else', async () => {
	await busReady();

	const { default: emitter } = await import('../../emitter.js');
	await initSharedSettings();

	const [, written] = vi.mocked(emitter.onAction).mock.calls[0]!;

	// The handler is handed the transaction and the schema alongside the event,
	// and reads neither: what it announces is that a column moved.
	const context = {} as EventContext;

	written({ payload: { project_name: 'planner' } }, context);
	expect(publish).not.toHaveBeenCalled();

	written({ payload: { supervisor_settings: { listenTimeout: 20_000 } } }, context);

	expect(publish).toHaveBeenCalledWith(
		'sharedSettingsChanged',
		{ column: SHARED_SETTINGS_COLUMNS.supervisor },
	);
});

// A deployment coming up while Redis is unreachable subscribes to nothing. The
// process holding the pool has to outlive that — an outage that ended it would
// take the pool with it — and its own re-read floor is what keeps it current
// until the bus answers again.
test('outlives a bus it cannot subscribe to', async () => {
	await busReady();
	subscribe.mockRejectedValueOnce(new Error('the client is offline'));

	const reread = vi.fn();

	onSharedSettingsChanged(SHARED_SETTINGS_COLUMNS.autoscale, reread);

	await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
	expect(reread).not.toHaveBeenCalled();
});

// The value is already durable when the announcement goes out, so an
// unreachable bus costs the other nodes their floor rather than the change —
// and must not cost this one the request it has just answered.
test('outlives a bus it cannot announce on', async () => {
	await busReady();
	publish.mockRejectedValueOnce(new Error('the client is offline'));

	const { default: emitter } = await import('../../emitter.js');
	await initSharedSettings();

	const [, written] = vi.mocked(emitter.onAction).mock.calls[0]!;

	written(
		{ payload: { autoscale_settings: { maxWorkers: 8 } } },
		{} as EventContext,
	);

	await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
});

test('re-reads every thirty seconds where nothing says otherwise', () => {
	expect(sharedSettingsPollMs()).toBe(30_000);
});

// A deployment with no Redis has no bus to miss an announcement on, so this
// floor is the only thing that lands a change there at all.
test('takes the interval the deployment configured', () => {
	vi.mocked(useEnv).mockReturnValue({ SHARED_SETTINGS_POLL_SECONDS: 5 });

	expect(sharedSettingsPollMs()).toBe(5_000);
});

// The floor is read on the scaling tick, so a floor of none is a select every
// time the pool is sized — and a typo would ask for one just as loudly.
test.each([0, -5, 'often'])('refuses %o as an interval', (seconds) => {
	vi.mocked(useEnv).mockReturnValue({ SHARED_SETTINGS_POLL_SECONDS: seconds });

	expect(sharedSettingsPollMs()).toBe(30_000);
});
