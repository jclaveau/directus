import { oneLine } from '@directus/utils';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		readByQuery: vi.fn(),
		updateOne: vi.fn(),
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
				updateOne: mocks.updateOne,
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
	a settings row named after the package answers with the folder it takes
`, async () => {
	mocks.readByQuery.mockResolvedValue([
		{
			id: 'probe-id',
			enabled: true,
			source: 'local',
			bundle: null,
			folder: 'probe-package',
		},
	]);

	mocks.updateOne.mockResolvedValue('probe-id');

	const extensionsSettings = await getExtensionsSettings({
		local: new Map([
			['probe-folder', { type: 'endpoint', name: 'probe-package' } as any],
		]),
		module: new Map(),
	});

	expect(mocks.updateOne).toHaveBeenCalledWith('probe-id', {
		folder: 'probe-folder',
	});

	expect(extensionsSettings).toEqual([
		{
			id: 'probe-id',
			enabled: true,
			source: 'local',
			bundle: null,
			folder: 'probe-folder',
		},
	]);
});

test(oneLine`
	a module extension without a settings row gets a new enabled one
`, async () => {
	mocks.readByQuery.mockResolvedValue([]);

	const extensionsSettings = await getExtensionsSettings({
		local: new Map(),
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
