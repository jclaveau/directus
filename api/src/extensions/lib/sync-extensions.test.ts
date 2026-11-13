import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		env: {} as Record<string, unknown>,
		list: vi.fn(),
		location: vi.fn(),
		publish: vi.fn(),
		lockDelete: vi.fn(),
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => mocks.env }));

vi.mock('node-machine-id', () => {
	return {
		default: { machineId: async () => 'machine' },
	};
});

vi.mock('../../lock/index.js', () => {
	return {
		useLock: () => ({ increment: async () => 1, delete: mocks.lockDelete }),
	};
});

vi.mock('../../bus/index.js', () => {
	return {
		useBus: () => ({ publish: mocks.publish, subscribe: vi.fn() }),
	};
});

vi.mock('../../logger/index.js', () => {
	return {
		useLogger: () => ({ trace: vi.fn() }),
	};
});

vi.mock('../../storage/index.js', () => {
	return {
		getStorage: async () => ({ location: mocks.location }),
	};
});

import { syncExtensions } from './sync-extensions.js';

let tempPath: string;

beforeEach(async () => {
	tempPath = await mkdtemp(join(tmpdir(), 'sync-extensions-'));

	mocks.env = {
		EXTENSIONS_LOCATION: 'remote',
		TEMP_PATH: tempPath,
	};
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(tempPath, { recursive: true, force: true });
});

test('copies the registry of the storage location under TEMP_PATH', async () => {
	mocks.list.mockImplementation(async function* () {
		yield 'extensions/.registry/version-id/package.json';
	});

	mocks.location.mockReturnValue({
		list: mocks.list,
		read: async () => Readable.from(['{"name":"probe"}']),
	});

	await syncExtensions({ force: true });

	expect(mocks.location).toHaveBeenCalledWith('remote');
	expect(mocks.list).toHaveBeenCalledWith('./extensions');

	expect(
		await readFile(
			join(tempPath, 'extensions/.registry/version-id/package.json'),
			'utf8',
		),
	).toBe('{"name":"probe"}');

	expect(
		await readFile(join(tempPath, 'extensions/.status'), 'utf8'),
	).toBe('DONE');

	expect(mocks.publish).toHaveBeenCalledWith('extensions-sync/machine', {
		ready: true,
	});

	expect(mocks.lockDelete).toHaveBeenCalledWith('extensions-sync/machine');
});
