import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Every case here re-imports the module under test, which is the point of the
// file — the configuration it remembers is what it exists to check. That import
// pulls a fresh graph each time and lands on whichever case runs first, so the
// budget is the file's own cost and not the latency of anything it measures.
vi.setConfig({ testTimeout: 30_000 });

vi.mock('@directus/env');

const warn = vi.fn();
const info = vi.fn();

vi.mock('../../../logger/index.js', () => {
	return {
		useLogger: () => {
			return { warn, info, error: vi.fn() };
		},
	};
});

const readSharedSettings = vi.fn();
const onSharedSettingsChanged = vi.fn();

vi.mock('../../lib/shared-settings.js', () => {
	return {
		SHARED_SETTINGS_COLUMNS: {
			autoscale: 'autoscale_settings',
			supervisor: 'supervisor_settings',
		},
		readSharedSettings,
		onSharedSettingsChanged,
	};
});

/**
 * `resolveConfig` reads a mirror the module holds, which is the point of it —
 * so each case needs its own instance of the module rather than the one the
 * case before it left behind.
 */
async function freshModule() {
	vi.resetModules();

	const { useEnv } = await import('@directus/env');

	vi.mocked(useEnv).mockReturnValue({
		CACHE_NAMESPACE: 'scalabus',
		PM2_AUTOSCALE_MAX_WORKERS: 4,
	});

	return import('./resolve-config.js');
}

/** A module whose mirror already holds what the column was answering. */
async function mirroring(stored: Record<string, unknown> | null) {
	const module = await freshModule();
	readSharedSettings.mockResolvedValue(stored);
	await module.initSharedSettingsMirror();

	return module;
}

/** The re-read the bus asks for, called as a change to the column would. */
function announced(): void {
	onSharedSettingsChanged.mock.calls.at(-1)?.[1]();
}

beforeEach(() => {
	readSharedSettings.mockReset();
	readSharedSettings.mockResolvedValue(null);
	warn.mockClear();
	info.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('reads the shared settings laid over the env chain', async () => {
	const { resolveConfig, resolvedSources } = await mirroring({ maxWorkers: 8 });

	expect(resolveConfig()).toMatchObject({ maxWorkers: 8 });

	// A value the environment set and one the shared settings are holding read
	// identically, and an operator deciding whether a redeploy would move it
	// needs them apart.
	expect(resolvedSources()).toMatchObject({
		maxWorkers: 'sharedSettings',
		scaleCpuThreshold: 'default',
	});
});

// The band a deployment that configures nothing runs in: a threshold above the
// CPU a quiet worker spends on its own background work, and a floor of one so
// the pool can come all the way back down.
test('an unconfigured pool scales at 70% and releases to one worker', async () => {
	const { resolveConfig } = await mirroring(null);

	expect(resolveConfig()).toMatchObject({
		scaleCpuThreshold: 70,
		minWorkers: 1,
	});
});

// The page offers to clear a field, and the value waiting under the shared
// settings is knowable only here: everywhere else they have already won.
test('reports what the chain holds under the shared settings', async () => {
	const module = await mirroring({ maxWorkers: 8 });

	expect(module.resolveConfig()).toMatchObject({ maxWorkers: 8 });

	expect(module.resolvedWithoutSharedSettings()).toMatchObject({ maxWorkers: 4 });
});

// The rollback path: reverting to the rule production already ran is one write
// to the settings, which is the whole reason the strategy is a configuration
// field rather than a build.
test('switches strategy from the shared settings', async () => {
	const { resolveConfig } = await mirroring(null);

	expect(resolveConfig()).toMatchObject({ strategy: 'scalabus' });

	readSharedSettings.mockResolvedValue({ strategy: 'legacy' });
	announced();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(2));

	expect(resolveConfig()).toMatchObject({ strategy: 'legacy' });
});

// Taking the env chain back sounds like the safe answer and is not. An operator
// who has just raised the ceiling to survive a spike would have it dropped by a
// blip, and the ceiling is corrected with no cooldown — the pool loses the
// workers at once and takes them back when the database answers again.
test('holds the last settings read when the table stops answering', async () => {
	const { resolveConfig, resolvedSources } = await mirroring({ maxWorkers: 8 });

	readSharedSettings.mockRejectedValue(new Error('Connection terminated.'));
	announced();
	await vi.waitFor(() => expect(warn).toHaveBeenCalled());

	expect(resolveConfig()).toMatchObject({ maxWorkers: 8 });

	// Held together: a page saying the ceiling came from the environment while
	// the loop runs a stored one would send an operator to redeploy.
	expect(resolvedSources()).toMatchObject({ maxWorkers: 'sharedSettings' });
});

// A database that answers nothing answers nothing every second, and a line per
// tick would bury the one that says what the pool is actually running on.
test('says the table is unreadable once, not every read', async () => {
	await mirroring({ maxWorkers: 8 });

	readSharedSettings.mockRejectedValue(new Error('Connection terminated.'));
	announced();
	await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

	announced();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(3));

	expect(warn).toHaveBeenCalledTimes(1);
});

// A layer that went missing — a column cleared, a database restored from before
// it was written — reads exactly like a deployment that never had one, and the
// difference between them is a ceiling somebody raised during an incident.
test('says what the pool is tuned by, and again when that changes', async () => {
	await mirroring(null);

	expect(info).toHaveBeenCalledWith(
		'[autoscale] shared settings: nothing stored, so the environment chain alone',
	);

	readSharedSettings.mockResolvedValue({ maxWorkers: 8 });
	announced();
	await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(2));

	expect(info).toHaveBeenLastCalledWith('[autoscale] shared settings: maxWorkers');
});

// A write is judged against the whole configuration it would produce, and the
// fields nobody is changing come from the chain rather than from the patch.
test('lays would-be settings over the chain without storing them', async () => {
	const { configWithSharedSettings } = await freshModule();

	expect(configWithSharedSettings({ maxWorkers: 8 }))
		.toMatchObject({ maxWorkers: 8, minWorkers: 1 });
});

test('falls back to the env chain when the table answered nothing', async () => {
	const { resolveConfig, resolvedSources } = await mirroring(null);

	expect(resolveConfig()).toMatchObject({ maxWorkers: 4 });
	expect(resolvedSources()).toMatchObject({ maxWorkers: 'env' });
});

test('takes the env chain back once the shared settings are cleared', async () => {
	const { resolveConfig } = await mirroring({ maxWorkers: 8 });

	readSharedSettings.mockResolvedValue(null);
	announced();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(2));

	expect(resolveConfig()).toMatchObject({ maxWorkers: 4 });
});

// The shared settings are a document an operator edits, so they are exactly
// where a typed zero too many arrives.
test('shared settings past what is supported are clamped, not obeyed', async () => {
	const { resolveConfig } = await mirroring({ minWorkers: 10_000 });

	expect(resolveConfig()).toMatchObject({ minWorkers: 4, maxWorkers: 4 });
});

// A bus message is delivered at most once and nothing replays it, so a node
// that missed one would run the layer it last read until it restarted.
test('re-reads unprompted once the mirror is old enough', async () => {
	const { resolveConfig } = await mirroring({ maxWorkers: 8 });

	resolveConfig();
	expect(readSharedSettings).toHaveBeenCalledTimes(1);

	readSharedSettings.mockResolvedValue({ maxWorkers: 16 });
	vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);

	resolveConfig();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(2));

	expect(resolveConfig()).toMatchObject({ maxWorkers: 16 });
});

// A tick is the only thing standing between a pool and the size an outage
// caught it at, so the re-read it starts is one it must never wait on.
test('decides on the mirror while the re-read is still out', async () => {
	const { resolveConfig } = await mirroring({ maxWorkers: 8 });

	readSharedSettings.mockReturnValue(new Promise(() => {}));
	vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);

	expect(resolveConfig()).toMatchObject({ maxWorkers: 8 });
	expect(readSharedSettings).toHaveBeenCalledTimes(2);
});
