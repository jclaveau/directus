import { ServiceUnavailableError } from '@directus/errors';
import { mkdir, rm } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		env: {
			EXTENSIONS_LOCATION: 'remote',
			TEMP_PATH: '/tmp/directus',
		} as Record<string, unknown>,
		list: vi.fn(),
		location: vi.fn(),
		remove: vi.fn(),
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => mocks.env }));

vi.mock('../../../storage/index.js', () => {
	return {
		getStorage: async () => ({ location: mocks.location }),
	};
});

vi.mock('@directus/extensions-registry', () => {
	return { download: vi.fn(async () => null) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('node:fs/promises')>()),
		mkdir: vi.fn(),
		rm: vi.fn(),
	};
});

vi.mock('../../../logger/index.js', () => {
	return { useLogger: () => ({ warn: vi.fn() }) };
});

import { InstallationManager } from './manager.js';

afterEach(() => {
	vi.restoreAllMocks();
});

test('uninstall deletes the version folder from the storage location', async () => {
	mocks.list.mockImplementation(async function* () {
		yield 'extensions/.registry/version-id/package.json';
		yield 'extensions/.registry/version-id/dist/api.js';
	});

	mocks.location.mockReturnValue({
		list: mocks.list,
		delete: mocks.remove,
	});

	await new InstallationManager().uninstall('version-id');

	expect(mocks.location).toHaveBeenCalledWith('remote');
	expect(mocks.list).toHaveBeenCalledWith('extensions/.registry/version-id');

	expect(mocks.remove.mock.calls).toEqual([
		['extensions/.registry/version-id/package.json'],
		['extensions/.registry/version-id/dist/api.js'],
	]);
});

test('install refuses a version the registry returns no tarball for', async () => {
	await expect(new InstallationManager().install('version-id'))
		.rejects
		.toThrow(new ServiceUnavailableError({
			service: 'marketplace',
			reason: 'Could not download and extract the extension',
		}));

	expect(mkdir).toHaveBeenCalledWith(
		'/tmp/directus/marketplace/version-id',
		{ recursive: true },
	);

	expect(rm).toHaveBeenCalledWith(
		'/tmp/directus/marketplace/version-id',
		{ recursive: true },
	);
});
