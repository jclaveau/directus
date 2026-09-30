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
	type SharedSettings,
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
	{ stats_max_bytes: false },
	{ audit_limit: 0 },
	{ audit_max_duration: '10m' },
	{ audit_max_duration: '24h' },
	{ scoped_max_index_globs: 1 },
	{ scoped_max_index_globs: 10000 },
	{ scoped_index_scan_count: 1000 },
	{ scoped_index_scan_count: 100000 },
	{ scoped_index_ttl_factor: 1 },
	{ scoped_index_ttl_factor: 1.5 },
	{ scoped_index_ttl_factor: 100 },
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

// Past these Redis refuses the command a purge or a fill sends, and every purge
// is then recorded and retried while the reads keep serving.
test.each([
	[
		{ scoped_index_scan_count: 1e20 },
		`'cache_settings.scoped_index_scan_count' has to be`,
	],
	[
		{ scoped_index_scan_count: 100001 },
		`'cache_settings.scoped_index_scan_count' has to be`,
	],
	[
		{ scoped_max_index_globs: 10001 },
		`'cache_settings.scoped_max_index_globs' has to be`,
	],
	[
		{ scoped_index_ttl_factor: 101 },
		`'cache_settings.scoped_index_ttl_factor' has to be`,
	],
	[
		{ audit_max_duration: '25h' },
		`'cache_settings.audit_max_duration' has to be`,
	],
	[
		{ audit_max_duration: '1000000y' },
		`'cache_settings.audit_max_duration' has to be`,
	],
])('refuses %o past its bound', (document, reason) => {
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

test(oneLine`
	keeps the later read of two overlapping ones, whichever answers last
`, async () => {
	const earlierRead = Promise.withResolvers<SharedSettings | null>();
	const laterRead = Promise.withResolvers<SharedSettings | null>();

	vi.mocked(readSharedSettings)
		.mockClear()
		.mockReturnValueOnce(earlierRead.promise)
		.mockReturnValueOnce(laterRead.promise);

	const earlierRefresh = refreshCacheSettings();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(1));
	const laterRefresh = refreshCacheSettings();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(2));

	laterRead.resolve({ enabled: false });
	await laterRefresh;
	earlierRead.resolve({ enabled: true });
	await earlierRefresh;

	expect(cacheEnabled()).toBe(false);
});

test('keeps the response tier where the layer switched serving off', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false, CACHE_STORE: 'redis' });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });

	await refreshCacheSettings();

	expect(responseCacheWanted()).toBe(true);
});

test('holds no response tier where nothing enables it', () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	expect(responseCacheWanted()).toBe(false);
});

test(oneLine`
	holds no response tier on a memory store where neither the environment nor
	the layer enables it
`, async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false, CACHE_STORE: 'memory' });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });

	await refreshCacheSettings();

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

	await flushBeforeEnabling(
		{ cache_settings: { enabled: true } },
		{ accountability: null },
	);

	expect(buildResponseCache).toHaveBeenCalledTimes(1);
	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

test('clears it from a document handed over as text', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling(
		{ cache_settings: '{"enabled":true}' },
		{ accountability: null },
	);

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

// Every node there holds an instance whatever the layer says, so every write
// made while serving was off purged what it had to.
test('clears nothing where the environment enables the cache', async () => {
	await flushBeforeEnabling(
		{ cache_settings: { enabled: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing where the layer already enables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });
	await refreshCacheSettings();

	await flushBeforeEnabling(
		{ cache_settings: { enabled: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write switching the cache off', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling(
		{ cache_settings: { enabled: false } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write leaving the column alone', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling(
		{ project_name: 'planner' },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write the guard refuses', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await expect(flushBeforeEnabling(
		{ cache_settings: { enabled: true, ttl: '1h' } },
		{ accountability: null },
	))
		.rejects.toThrowError('\'cache_settings.ttl\' is not a cache setting');

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('refuses the write when the clear is refused', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	vi.mocked(clearCacheTargets).mockRejectedValue(
		new Error('Cache clear refused by response'),
	);

	await expect(flushBeforeEnabling(
		{ cache_settings: { enabled: true } },
		{ accountability: null },
	))
		.rejects.toThrowError('Cache clear refused by response');
});

// This node may have missed the write that switched serving off.
test('clears where the stored row is off though this node reads it on', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });
	await refreshCacheSettings();
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: false });

	await flushBeforeEnabling(
		{ cache_settings: { enabled: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

// Serving is already on elsewhere, and this node has not heard of it yet.
test('clears nothing where the stored row is already on', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ enabled: true });

	await flushBeforeEnabling(
		{ cache_settings: { enabled: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

// The access check runs after this filter, so a caller it would refuse must not
// clear the tier on its way there.
test('clears nothing for a caller who is not an admin', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling(
		{ cache_settings: { enabled: true } },
		{ accountability: { user: 'editor', admin: false } as never },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write the guard refuses for another column', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await expect(flushBeforeEnabling(
		{
			cache_settings: { enabled: true },
			autoscale_settings: { workers: 8 },
		},
		{ accountability: { user: 'admin', admin: true } as never },
	))
		.rejects
		.toThrowError(`'workers' is not a field of the autoscale configuration`);

	expect(clearCacheTargets).not.toHaveBeenCalled();
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

	await expect(vi.mocked(emitter.onFilter).mock.calls[0]![1](
		write,
		{} as never,
		{ accountability: null } as never,
	)).resolves.toEqual({ cache_settings: { enabled: true } });

	await expect(vi.mocked(emitter.onFilter).mock.calls[1]![1](
		write,
		{} as never,
		{ accountability: null } as never,
	)).resolves.toEqual({ cache_settings: { enabled: true } });

	expect(clearCacheTargets).toHaveBeenCalledTimes(2);
	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

test('hands the filter the caller the event carries', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await initCacheSettings();

	await vi.mocked(emitter.onFilter).mock.calls[1]![1](
		{ cache_settings: { enabled: true } },
		{} as never,
		{ accountability: { user: 'editor', admin: false } } as never,
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});
