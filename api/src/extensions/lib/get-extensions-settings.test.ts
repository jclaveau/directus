import { oneLine } from '@directus/utils';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		readByQuery: vi.fn(),
		updateOne: vi.fn(),
	};
});

vi.mock('../../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../../utils/get-schema.js', () => ({ getSchema: vi.fn() }));
vi.mock('@directus/extensions-registry', () => ({ list: vi.fn() }));

vi.mock('../../services/extensions.js', () => {
	return {
		ExtensionsService: class {
			extensionsItemService = {
				readByQuery: mocks.readByQuery,
				updateOne: mocks.updateOne,
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
		registry: new Map(),
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
