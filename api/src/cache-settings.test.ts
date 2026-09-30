import { useEnv } from '@directus/env';
import { ForbiddenError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	assertUsableCacheSettings,
	assertUsableCacheSettingsPatch,
	cacheEnabled,
	cacheSetting,
	flushBeforeEnabling,
	initCacheSettings,
	markEnablingFlushed,
	refreshCacheSettings,
	resolveCacheSettings,
	responseCacheWanted,
	seedCacheSettings,
	usableCacheSettings,
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
	vi.mocked(readSharedSettings).mockResolvedValue({ response: false });

	await refreshCacheSettings();

	expect(cacheEnabled()).toBe(false);
});

test('switches serving on over an environment that disables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ response: true });

	await refreshCacheSettings();

	expect(cacheEnabled()).toBe(true);
});

test.each([
	[{ response: true }, { CACHE_RESPONSE: false }, true],
	[null, { CACHE_RESPONSE: true, CACHE_ENABLED: false }, true],
	[null, { CACHE_RESPONSE: false, CACHE_ENABLED: true }, false],
	[null, { CACHE_ENABLED: true }, true],
	[null, {}, false],
])('reads response from %o over %o as %s', async (stored, env, serving) => {
	vi.mocked(useEnv).mockReturnValue(env);
	vi.mocked(readSharedSettings).mockResolvedValue(stored);

	await refreshCacheSettings();

	expect(cacheSetting('response')).toBe(serving);
});

test('reads a null response as unset', async () => {
	vi.mocked(readSharedSettings).mockResolvedValue({ response: null });

	await refreshCacheSettings();

	expect(cacheEnabled()).toBe(true);
});

test.each([
	{ response: true },
	{ value_max_size: false },
	{ value_max_size: '2mb' },
	{ stats_max_bytes: '2gb' },
	{ stats_max_bytes: false },
	{ audit_limit: 0 },
	{ audit_max_duration: '10m' },
	{ audit_max_duration: '24h' },
	{ scoped_index_scan_count: 1000 },
	{ scoped_index_scan_count: 100000 },
	{ scoped_index_ttl_factor: 1 },
	{ scoped_index_ttl_factor: 1.5 },
	{ scoped_index_ttl_factor: 100 },
	{ audit_limit: null },
	{
		audit_limit: 40,
		setBy: 'writer-id',
		setAt: '2026-09-30T08:00:00.000Z',
		setFrom: 'admin',
	},
	{ setBy: null },
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
			false, a size such as "2gb", or null
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
			a duration such as "10m", up to "24h", or null
		`,
	],
	[
		{ audit_max_duration: '0' },
		oneLine`
			'cache_settings.audit_max_duration' has to be
			a duration such as "10m", up to "24h", or null
		`,
	],
	[
		{ scoped_index_scan_count: '1000' },
		oneLine`
			'cache_settings.scoped_index_scan_count' has to be
			an integer from 1 to 100000, or null
		`,
	],
	[
		{ scoped_index_ttl_factor: 0.5 },
		oneLine`
			'cache_settings.scoped_index_ttl_factor' has to be
			a number from 1 to 100, or null
		`,
	],
	[{ ttl: '1h' }, `'cache_settings.ttl' is not a cache setting`],
	[{ setAt: 7 }, `'cache_settings.setAt' has to be a string`],
])('refuses %o', (document, reason) => {
	expect(() => assertUsableCacheSettings(document)).toThrowError(reason);
});

test.each([
	[{ setBy: 'writer-id' }, `'cache_settings.setBy' is not a cache setting`],
	[
		{ audit_limit: 40, setAt: '2026-09-30T08:00:00.000Z' },
		`'cache_settings.setAt' is not a cache setting`,
	],
	[{ setFrom: 'admin' }, `'cache_settings.setFrom' is not a cache setting`],
	[{ audit_limit: -1 }, `'cache_settings.audit_limit' has to be`],
])('refuses the patch %o', (patch, reason) => {
	expect(() => assertUsableCacheSettingsPatch(patch)).toThrowError(reason);
});

test('accepts a patch of cache settings alone', () => {
	expect(() => assertUsableCacheSettingsPatch({ audit_limit: 40 }))
		.not
		.toThrow();
});

test('leaves the stamp out of the fields the mirror applies', () => {
	expect(usableCacheSettings({
		audit_limit: 40,
		setBy: 'writer-id',
		setAt: '2026-09-30T08:00:00.000Z',
		setFrom: 'admin',
	})).toEqual({ audit_limit: 40 });
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

test('resolves every field against the environment', () => {
	vi.mocked(useEnv).mockReturnValue({
		CACHE_ENABLED: false,
		CACHE_VALUE_MAX_SIZE: false,
		CACHE_STATS_MAX_BYTES: '2gb',
		CACHE_AUDIT_LIMIT: 0,
		CACHE_AUDIT_MAX_DURATION: '10m',
		CACHE_SCOPED_INDEX_SCAN_COUNT: 500,
		CACHE_SCOPED_INDEX_TTL_FACTOR: 3,
	});

	expect(resolveCacheSettings({ audit_limit: 40, scoped_index_ttl_factor: 0.5 }))
		.toEqual({
			response: { value: false, source: 'env', fallback: false },
			value_max_size: { value: false, source: 'env', fallback: false },
			stats_max_bytes: { value: '2gb', source: 'env', fallback: '2gb' },
			audit_limit: { value: 40, source: 'settings', fallback: 0 },
			audit_max_duration: { value: '10m', source: 'env', fallback: '10m' },
			scoped_index_scan_count: { value: 500, source: 'env', fallback: 500 },
			scoped_index_ttl_factor: { value: 3, source: 'env', fallback: 3 },
		});
});

// A factor below 1 expires the index before its entries, and a purge misses
// them: the environment is held to the rule the layer is.
test('reads a scoped variable its rule refuses as the built-in value', () => {
	vi.mocked(useEnv).mockReturnValue({
		CACHE_SCOPED_INDEX_SCAN_COUNT: 0,
		CACHE_SCOPED_INDEX_TTL_FACTOR: 0.5,
	});

	expect(resolveCacheSettings(null)).toMatchObject({
		scoped_index_scan_count: { value: 1000, source: 'env', fallback: 1000 },
		scoped_index_ttl_factor: { value: 2, source: 'env', fallback: 2 },
	});
});

test('reads the cache_settings column', async () => {
	await refreshCacheSettings();

	expect(readSharedSettings).toHaveBeenCalledWith('cache_settings');
});

test(oneLine`
	keeps the later read of two overlapping ones, whichever answers last
`, async () => {
	let resolveEarlierRead!: (settings: SharedSettings | null) => void;
	let resolveLaterRead!: (settings: SharedSettings | null) => void;

	const earlierRead = new Promise<SharedSettings | null>((resolve) => {
		resolveEarlierRead = resolve;
	});

	const laterRead = new Promise<SharedSettings | null>((resolve) => {
		resolveLaterRead = resolve;
	});

	vi.mocked(readSharedSettings)
		.mockClear()
		.mockReturnValueOnce(earlierRead)
		.mockReturnValueOnce(laterRead);

	const earlierRefresh = refreshCacheSettings();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(1));
	const laterRefresh = refreshCacheSettings();
	await vi.waitFor(() => expect(readSharedSettings).toHaveBeenCalledTimes(2));

	resolveLaterRead({ response: false });
	await laterRefresh;
	resolveEarlierRead({ response: true });
	await earlierRefresh;

	expect(cacheEnabled()).toBe(false);
});

test('keeps the response tier where the layer switched serving off', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false, CACHE_STORE: 'redis' });
	vi.mocked(readSharedSettings).mockResolvedValue({ response: false });

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
	vi.mocked(readSharedSettings).mockResolvedValue({ response: false });

	await refreshCacheSettings();

	expect(responseCacheWanted()).toBe(false);
});

test('holds a response tier where only the layer enables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ response: true });

	await refreshCacheSettings();

	expect(responseCacheWanted()).toBe(true);
});

test.each([
	[{ CACHE_RESPONSE: true, CACHE_ENABLED: false, CACHE_STORE: 'memory' }, true],
	[{ CACHE_RESPONSE: false, CACHE_ENABLED: true, CACHE_STORE: 'memory' }, false],
	[{ CACHE_ENABLED: true, CACHE_STORE: 'memory' }, true],
	[{ CACHE_RESPONSE: false, CACHE_ENABLED: true, CACHE_STORE: 'redis' }, true],
])('holds a response tier over %o: %s', (env, wanted) => {
	vi.mocked(useEnv).mockReturnValue(env);

	expect(responseCacheWanted()).toBe(wanted);
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
		{ cache_settings: { response: true } },
		{ accountability: null },
	);

	expect(buildResponseCache).toHaveBeenCalledTimes(1);
	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

test('clears it from a document handed over as text', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling(
		{ cache_settings: '{"response":true}' },
		{ accountability: null },
	);

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

// Every node there holds an instance whatever the layer says, so every write
// made while serving was off purged what it had to.
test('clears nothing where the environment enables the cache', async () => {
	await flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing where CACHE_RESPONSE enables the cache', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_RESPONSE: true, CACHE_ENABLED: false });

	await flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears where CACHE_RESPONSE disables what CACHE_ENABLED enables', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_RESPONSE: false, CACHE_ENABLED: true });

	await flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

test('clears nothing where the layer already enables it', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ response: true });
	await refreshCacheSettings();

	await flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write switching the cache off', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await flushBeforeEnabling(
		{ cache_settings: { response: false } },
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
		{ cache_settings: { response: true, ttl: '1h' } },
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
		{ cache_settings: { response: true } },
		{ accountability: null },
	))
		.rejects.toThrowError('Cache clear refused by response');
});

// This node may have missed the write that switched serving off.
test('clears where the stored row is off though this node reads it on', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ response: true });
	await refreshCacheSettings();
	vi.mocked(readSharedSettings).mockResolvedValue({ response: false });

	await flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

// Serving is already on elsewhere, and this node has not heard of it yet.
test('clears nothing where the stored row is already on', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	vi.mocked(readSharedSettings).mockResolvedValue({ response: true });

	await flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{ accountability: null },
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

// A role granted update on directus_settings passes the access check that runs
// after this filter, and switching on without the clear would serve what the
// period the tier was off left behind.
test('refuses a switch-on from a caller who is not an admin', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await expect(flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{ accountability: { user: 'editor', admin: false } as never },
	))
		.rejects
		.toThrowError(ForbiddenError);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

// The service clears before it opens the transaction, and the write inside it
// fires this filter again.
test('clears nothing for a write that was cleared ahead', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });
	const settingsTrx = {} as never;
	markEnablingFlushed(settingsTrx);

	await flushBeforeEnabling(
		{ cache_settings: { response: true } },
		{
			accountability: { user: 'admin', admin: true } as never,
			database: settingsTrx,
		},
	);

	expect(clearCacheTargets).not.toHaveBeenCalled();
});

test('clears nothing for a write the guard refuses for another column', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await expect(flushBeforeEnabling(
		{
			cache_settings: { response: true },
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

	vi.mocked(readSharedSettings).mockResolvedValue({ response: false });
	vi.mocked(onSharedSettingsChanged).mock.calls[0]![1]();
	await vi.waitFor(() => expect(cacheEnabled()).toBe(false));
});

test('re-reads the layer on the shared-settings floor', async () => {
	vi.useFakeTimers();

	await initCacheSettings();

	vi.mocked(readSharedSettings).mockResolvedValue({ response: false });
	await vi.advanceTimersByTimeAsync(30000);

	expect(cacheEnabled()).toBe(false);

	vi.useRealTimers();
});

test('clears ahead of the create as well as the update', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await initCacheSettings();

	expect(vi.mocked(emitter.onFilter).mock.calls.map(([event]) => event))
		.toEqual(['settings.create', 'settings.update']);

	const write = { cache_settings: { response: true } };

	await expect(vi.mocked(emitter.onFilter).mock.calls[0]![1](
		write,
		{} as never,
		{ accountability: null } as never,
	)).resolves.toEqual({ cache_settings: { response: true } });

	await expect(vi.mocked(emitter.onFilter).mock.calls[1]![1](
		write,
		{} as never,
		{ accountability: null } as never,
	)).resolves.toEqual({ cache_settings: { response: true } });

	expect(clearCacheTargets).toHaveBeenCalledTimes(2);
	expect(clearCacheTargets).toHaveBeenCalledWith(['response']);
});

test('hands the filter the caller the event carries', async () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_ENABLED: false });

	await initCacheSettings();

	await expect(vi.mocked(emitter.onFilter).mock.calls[1]![1](
		{ cache_settings: { response: true } },
		{} as never,
		{ accountability: { user: 'editor', admin: false } } as never,
	))
		.rejects
		.toThrowError(ForbiddenError);
});
