import { oneLine } from '@directus/utils';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		readByQuery: vi.fn(),
		createMany: vi.fn(),
	};
});

vi.mock('node:crypto', () => ({ randomUUID: () => 'generated-id' }));
vi.mock('../../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../../utils/get-schema.js', () => ({ getSchema: vi.fn() }));

vi.mock('../../services/extensions.js', () => {
	return {
		ExtensionsService: class {
			extensionsItemService = {
				readByQuery: mocks.readByQuery,
				createMany: mocks.createMany,
			};
		},
	};
});

import { getExtensionsSettings } from './get-extensions-settings.js';

afterEach(() => {
	vi.restoreAllMocks();
});

test(oneLine`
	a module extension without a settings row gets a new enabled one
`, async () => {
	mocks.readByQuery.mockResolvedValue([]);

	const extensionsSettings = await getExtensionsSettings({
		module: new Map([
			['module-folder', { type: 'endpoint', name: 'module-package' } as any],
		]),
	});

	expect(mocks.createMany).toHaveBeenCalledExactlyOnceWith([
		{
			id: 'generated-id',
			enabled: true,
			source: 'module',
			bundle: null,
			folder: 'module-folder',
		},
	]);

	expect(extensionsSettings).toStrictEqual([
		{
			id: 'generated-id',
			enabled: true,
			source: 'module',
			bundle: null,
			folder: 'module-folder',
		},
	]);
});
