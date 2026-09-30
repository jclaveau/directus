import { useEnv } from '@directus/env';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	assertUsableCacheSettings,
	cacheEnabled,
	cacheSetting,
	flushBeforeEnabling,
	initCacheSettings,
	refreshCacheSettings,
	resolveCacheSettings,
	responseCacheWanted,
	seedCacheSettings,
} from './cache-settings.js';
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

	await refreshCacheSettings();
});

afterEach(() => {
	vi.resetAllMocks();
});

test('reads CACHE_ENABLED where the layer is unset', () => {
	expect(cacheEnabled()).toBe(true);
});

test('switches serving off over an environment that enables it', async () => {
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });

	await refreshCacheSettings();

	expect(cacheEnabled()).toBe(false);
});

test('switches serving on over an environment that disables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });

	await refreshCacheSettings();

	expect(cacheEnabled()).toBe(true);
});

test('reads a null enabled as unset', async () => {
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: null });

	await refreshCacheSettings();

	expect(cacheEnabled()).toBe(true);
});

test.each([
	{ enabled: true },
	{ value_max_size: false },
	{ value_max_size: '2mb' },
	{ stats_max_bytes: '2gb' },
	{ audit_limit: 0 },
	{ audit_max_duration: '10m' },
	{ scoped_max_index_globs: 1 },
	{ scoped_index_scan_count: 1000 },
	{ scoped_index_ttl_factor: 1 },
	{ scoped_index_ttl_factor: 1.5 },
	{ audit_limit: null },
])('accepts %o', (document) => {
	expect(() => assertUsableCacheSettings(document)).not.toThrow();
});

test.each([
	[
		{ value_max_size: true },
		oneLine`
			'cache_settings.value_max_size' has to be
			false, a size such as "2mb", or null
		`,
	],
	[
		{ value_max_size: 'big' },
		oneLine`
			'cache_settings.value_max_size' has to be
			false, a size such as "2mb", or null
		`,
	],
	[
		{ stats_max_bytes: '0' },
		oneLine`
			'cache_settings.stats_max_bytes' has to be
			a size such as "2gb", or null
		`,
	],
	[
		{ audit_limit: -1 },
		oneLine`
			'cache_settings.audit_limit' has to be
			an integer from 0, or null
		`,
	],
	[
		{ audit_limit: 2.5 },
		oneLine`
			'cache_settings.audit_limit' has to be
			an integer from 0, or null
		`,
	],
	[
		{ audit_max_duration: 'soon' },
		oneLine`
			'cache_settings.audit_max_duration' has to be
			a duration such as "10m", or null
		`,
	],
	[
		{ audit_max_duration: '0' },
		oneLine`
			'cache_settings.audit_max_duration' has to be
			a duration such as "10m", or null
		`,
	],
	[
		{ scoped_max_index_globs: 0 },
		oneLine`
			'cache_settings.scoped_max_index_globs' has to be
			an integer from 1, or null
		`,
	],
	[
		{ scoped_index_scan_count: '1000' },
		oneLine`
			'cache_settings.scoped_index_scan_count' has to be
			an integer from 1, or null
		`,
	],
	[
		{ scoped_index_ttl_factor: 0.5 },
		oneLine`
			'cache_settings.scoped_index_ttl_factor' has to be
			a number from 1, or null
		`,
	],
	[{ ttl: '1h' }, `'cache_settings.ttl' is not a cache setting`],
])('refuses %o', (document, reason) => {
	expect(() => assertUsableCacheSettings(document)).toThrowError(reason);
});

test('answers a field from the layer over the fallback', async () => {
	vi.mocked(useEnv).mockReturnValue({
		CACHE_AUDIT_LIMIT: 250,
		CACHE_AUDIT_MAX_DURATION: '10m',
	});

	vi.mocked(readSharedSettings).mockResolvedValue({ audit_limit: 40 });

	await refreshCacheSettings();

	expect(cacheSetting('audit_limit')).toBe(40);
	expect(cacheSetting('audit_max_duration')).toBe('10m');
});

test('keeps the usable fields of a row written around the guard', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_AUDIT_LIMIT: 250 });

	vi.mocked(readSharedSettings).mockResolvedValue({
		audit_limit: -1,
		value_max_size: '2mb',
		ttl: '1h',
	});

	await refreshCacheSettings();

	expect(cacheSetting('audit_limit')).toBe(250);
	expect(cacheSetting('value_max_size')).toBe('2mb');
});

test('resolves every field against the environment and the defaults', () => {
	vi.mocked(useEnv).mockReturnValue({
		CACHE_ENABLED: false,
		CACHE_VALUE_MAX_SIZE: false,
		CACHE_STATS_MAX_BYTES: '2gb',
		CACHE_AUDIT_LIMIT: 0,
		CACHE_AUDIT_MAX_DURATION: '10m',
	});

	expect(resolveCacheSettings({ audit_limit: 40, scoped_index_ttl_factor: 0.5 }))
		.toEqual({
			enabled: { value: false, source: 'env', fallback: false },
			value_max_size: { value: false, source: 'env', fallback: false },
			stats_max_bytes: { value: '2gb', source: 'env', fallback: '2gb' },
			audit_limit: { value: 40, source: 'settings', fallback: 0 },
			audit_max_duration: { value: '10m', source: 'env', fallback: '10m' },
			scoped_max_index_globs: { value: 64, source: 'default', fallback: 64 },
			scoped_index_scan_count: {
				value: 1000,
				source: 'default',
				fallback: 1000,
			},
			scoped_index_ttl_factor: { value: 2, source: 'default', fallback: 2 },
		});
});

test('reads the cache_settings column', async () => {
	await refreshCacheSettings();

	expect(readSharedSettings).toHaveBeenCalledWith('cache_settings');
});

test('keeps the response tier where the layer switched serving off', async () => {
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });

	await refreshCacheSettings();

	expect(responseCacheWanted()).toBe(true);
});

test('holds no response tier where nothing enables it', () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	expect(responseCacheWanted()).toBe(false);
});

test('holds a response tier where only the layer enables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });

	await refreshCacheSettings();

	expect(responseCacheWanted()).toBe(true);
});

test('leaves the environment in charge when the column is unreadable', async () => {
	vi.mocked(readSharedSettings).mockRejectedValue(
		new Error('column "cache_settings" does not exist'),
	);

	await seedCacheSettings();

	expect(cacheEnabled()).toBe(true);

	expect(vi.mocked(useLogger)().warn).toHaveBeenCalledWith(
		new Error('column "cache_settings" does not exist'),
		'[cache] cache_settings is unreadable; the environment alone is read',
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
	await refreshCacheSettings();

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

test('clears nothing for a write the guard refuses', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await expect(flushBeforeEnabling({
		cache_settings: { enabled: true, ttl: '1h' },
	}))
		.rejects.toThrowError('\'cache_settings.ttl\' is not a cache setting');

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
	await initCacheSettings();

	expect(vi.mocked(onSharedSettingsChanged).mock.calls[0]![0])
		.toBe('cache_settings');

	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });
	vi.mocked(onSharedSettingsChanged).mock.calls[0]![1]();
	await vi.waitFor(() => expect(cacheEnabled()).toBe(false));
});

test('re-reads the layer on the shared-settings floor', async () => {
	vi.useFakeTimers();

	await initCacheSettings();

	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });
	await vi.advanceTimersByTimeAsync(30000);

	expect(cacheEnabled()).toBe(false);

	vi.useRealTimers();
});

test('clears ahead of the create as well as the update', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await initCacheSettings();

	expect(vi.mocked(emitter.onFilter).mock.calls.map(([event]) => event))
		.toEqual(['settings.create', 'settings.update']);

	const write = { cache_settings: { enabled: true } };

	await expect(
		vi.mocked(emitter.onFilter).mock.calls[0]![1](write, {} as never, {} as never),
	).resolves.toEqual({ cache_settings: { enabled: true } });

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});
