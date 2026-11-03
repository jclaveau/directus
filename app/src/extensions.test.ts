import { afterEach, expect, test, vi } from 'vitest';
import {
	onDehydrateExtensions,
	onHydrateExtensions,
	registerExtensions,
} from './extensions';
import { reportAppEntries, watchAppChunk } from './utils/sync-app-chunk';

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
	return { reportAppEntries: vi.fn(), watchAppChunk: vi.fn() };
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
});

test('watches the app chunk while hydrated, and reports its entries', async () => {
	const stopWatching = vi.fn();
	vi.mocked(watchAppChunk).mockReturnValue(stopWatching);

	registerExtensions({} as never);

	await onHydrateExtensions();

	expect(watchAppChunk).toHaveBeenCalledWith({});
	expect(reportAppEntries).toHaveBeenCalledWith({});
	expect(stopWatching).not.toHaveBeenCalled();

	await onDehydrateExtensions();

	expect(stopWatching).toHaveBeenCalledTimes(1);
});
