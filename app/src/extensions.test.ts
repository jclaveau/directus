import { afterEach, expect, test, vi } from 'vitest';
import {
	loadExtensions,
	onDehydrateExtensions,
	onHydrateExtensions,
	registerExtensions,
} from './extensions';
import { registerInterfaces } from './interfaces';
import { readAppChunkUrl, watchAppChunk } from './utils/sync-app-chunk';

vi.mock('./displays', () => {
	return { getInternalDisplays: () => [], registerDisplays: vi.fn() };
});

vi.mock('./interfaces', () => {
	return { getInternalInterfaces: () => [], registerInterfaces: vi.fn() };
});

vi.mock('./layouts', () => {
	return { getInternalLayouts: () => [], registerLayouts: vi.fn() };
});

vi.mock('./operations', () => {
	return { getInternalOperations: () => [], registerOperations: vi.fn() };
});

vi.mock('./panels', () => {
	return { getInternalPanels: () => [], registerPanels: vi.fn() };
});

vi.mock('./themes/register', () => ({ registerThemes: vi.fn() }));
vi.mock('./utils/get-root-path', () => ({ getRootPath: () => '/' }));

vi.mock('./utils/translate-object-values', () => {
	return { translate: (value: unknown) => value };
});

vi.mock('./utils/sync-app-chunk', () => {
	return { readAppChunkUrl: vi.fn(), watchAppChunk: vi.fn() };
});

vi.mock('@directus-extensions', () => {
	return {
		interfaces: [{ id: 'dev-interface' }],
		displays: [],
		layouts: [],
		modules: [],
		panels: [],
		operations: [],
		themes: [],
	};
});

vi.mock('./lang', async () => {
	const { ref } = await import('vue');

	return { i18n: { global: { locale: ref('en-US') } } };
});

vi.mock('./modules', async () => {
	const { ref } = await import('vue');

	return {
		getInternalModules: () => [],
		registerModules: () => {
			return {
				registeredModules: ref([]),
				onHydrateModules: async () => undefined,
				onDehydrateModules: async () => undefined,
			};
		},
	};
});

afterEach(() => {
	vi.resetAllMocks();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test('watches the app chunk while hydrated', async () => {
	const stopWatching = vi.fn();
	vi.mocked(watchAppChunk).mockReturnValue(stopWatching);

	registerExtensions({} as never);

	await onHydrateExtensions();

	expect(watchAppChunk).toHaveBeenCalledWith({});
	expect(stopWatching).not.toHaveBeenCalled();

	await onDehydrateExtensions();

	expect(stopWatching).toHaveBeenCalledTimes(1);
});

test('registers the extensions of the app chunk the server serves', async () => {
	vi.stubEnv('DEV', false);

	vi.mocked(readAppChunkUrl).mockResolvedValue(
		'data:text/javascript,export const interfaces = [{ id: "chunk-interface" }];'
		+ 'export const displays = [], layouts = [], modules = [], panels = [],'
		+ ' operations = [], themes = [];',
	);

	await loadExtensions();
	registerExtensions({} as never);

	expect(registerInterfaces).toHaveBeenCalledWith([{ id: 'chunk-interface' }], {});
});

test('registers the extensions the dev server builds', async () => {
	vi.stubEnv('DEV', true);

	await loadExtensions();
	registerExtensions({} as never);

	expect(registerInterfaces).toHaveBeenCalledWith([{ id: 'dev-interface' }], {});
});
