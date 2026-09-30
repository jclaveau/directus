import { useEnv } from '@directus/env';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	cacheEnabled,
	flushBeforeEnabling,
	initCacheEnabled,
	refreshCacheEnabled,
	responseCacheWanted,
	seedCacheEnabled,
} from './cache-enabled.js';
import { buildResponseCache, clearCacheTargets } from './cache.js';
import emitter from './emitter.js';
import { useLogger } from './logger/index.js';
import {
	onSharedSettingsChanged,
	readSharedSettings,
} from './processes/lib/shared-settings.js';

vi.mock('@directus/env');
vi.mock('./bus/index.js', () => ({ useBus: vi.fn() }));

vi.mock('./cache.js', () => {
	return { buildResponseCache: vi.fn(), clearCacheTargets: vi.fn() };
});

vi.mock('./emitter.js', () => ({ default: { onFilter: vi.fn() } }));
vi.mock('./logger/index.js', () => ({ useLogger: vi.fn() }));

vi.mock('./processes/lib/shared-settings.js', async (importOriginal) => {
	const original = await importOriginal<
		typeof import('./processes/lib/shared-settings.js')
	>();

	return {
		...original,
		onSharedSettingsChanged: vi.fn(),
		readSharedSettings: vi.fn(),
		sharedSettingsPollMs: () => 30000,
	};
});

beforeEach(async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: true });
	vi.mocked(useLogger).mockReturnValue({ warn: vi.fn() } as never);
	vi.mocked(readSharedSettings).mockResolvedValue(null);

	await refreshCacheEnabled();
});

afterEach(() => {
	vi.resetAllMocks();
});

test('reads CACHE_ENABLED where the layer is unset', () => {
	expect(cacheEnabled()).toBe(true);
});

test('switches serving off over an environment that enables it', async () => {
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });

	await refreshCacheEnabled();

	expect(cacheEnabled()).toBe(false);
});

test('switches serving on over an environment that disables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });

	await refreshCacheEnabled();

	expect(cacheEnabled()).toBe(true);
});

test('reads a null enabled as unset', async () => {
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: null });

	await refreshCacheEnabled();

	expect(cacheEnabled()).toBe(true);
});

test('reads the cache_settings column', async () => {
	await refreshCacheEnabled();

	expect(readSharedSettings).toHaveBeenCalledWith('cache_settings');
});

test('keeps the response tier where the layer switched serving off', async () => {
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });

	await refreshCacheEnabled();

	expect(responseCacheWanted()).toBe(true);
});

test('holds no response tier where nothing enables it', () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	expect(responseCacheWanted()).toBe(false);
});

test('holds a response tier where only the layer enables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });

	await refreshCacheEnabled();

	expect(responseCacheWanted()).toBe(true);
});

test('leaves the environment in charge when the column is unreadable', async () => {
	vi.mocked(readSharedSettings).mockRejectedValue(
		new Error('column "cache_settings" does not exist'),
	);

	await seedCacheEnabled();

	expect(cacheEnabled()).toBe(true);

	expect(vi.mocked(useLogger)().warn).toHaveBeenCalledWith(
		new Error('column "cache_settings" does not exist'),
		'[cache] cache_settings is unreadable; CACHE_ENABLED alone is read',
	);
});

test('clears the response cache before switching it on', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling({ cache_settings: { enabled: true } });

	expect(buildResponseCache).toHaveBeenCalledTimes(1);
	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

test('clears it from a document handed over as text', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling({ cache_settings: '{"enabled":true}' });

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

// Every node there holds an instance whatever the layer says, so every write
// made while serving was off purged what it had to.
test('clears nothing where the environment enables the cache', async () => {
	await flushBeforeEnabling({ cache_settings: { enabled: true } });

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing where the layer already enables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });
	await refreshCacheEnabled();

	await flushBeforeEnabling({ cache_settings: { enabled: true } });

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write switching the cache off', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling({ cache_settings: { enabled: false } });

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write leaving the column alone', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling({ project_name: 'planner' });

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('refuses the write when the clear is refused', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	vi.mocked(clearCacheTargets).mockRejectedValue(
		new Error('Cache clear refused by response'),
	);

	await expect(flushBeforeEnabling({ cache_settings: { enabled: true } }))
		.rejects.toThrowError('Cache clear refused by response');
});

test('re-reads the layer when a change to it is announced', async () => {
	await initCacheEnabled();

	expect(vi.mocked(onSharedSettingsChanged).mock.calls[0]![0])
		.toBe('cache_settings');

	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });
	vi.mocked(onSharedSettingsChanged).mock.calls[0]![1]();
	await vi.waitFor(() => expect(cacheEnabled()).toBe(false));
});

test('re-reads the layer on the shared-settings floor', async () => {
	vi.useFakeTimers();

	await initCacheEnabled();

	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });
	await vi.advanceTimersByTimeAsync(30000);

	expect(cacheEnabled()).toBe(false);

	vi.useRealTimers();
});

test('clears ahead of the create as well as the update', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await initCacheEnabled();

	expect(vi.mocked(emitter.onFilter).mock.calls.map(([event]) => event))
		.toEqual(['settings.create', 'settings.update']);

	const write = { cache_settings: { enabled: true } };

	await expect(
		vi.mocked(emitter.onFilter).mock.calls[0]![1](write, {} as never, {} as never),
	).resolves.toEqual({ cache_settings: { enabled: true } });

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});
