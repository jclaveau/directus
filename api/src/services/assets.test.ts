import { ServiceUnavailableError } from '@directus/errors';
import type { SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { PassThrough, Readable } from 'node:stream';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AssetsService } from './assets.js';
import {
	getSharpCounters,
	getSharpInstance,
} from './files/lib/get-sharp-instance.js';

const env = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('./files/lib/get-sharp-instance.js', () => {
	return {
		getSharpCounters: vi.fn(),
		getSharpInstance: vi.fn(),
	};
});

const file = {
	id: 'a1b2c3d4-0000-4000-8000-000000000001',
	storage: 'local',
	filename_disk: 'photo.jpg',
	type: 'image/jpeg',
	width: 100,
	height: 100,
	filesize: 1000,
};

const readOne = vi.hoisted(() => vi.fn());

vi.mock('./files.js', () => {
	return { FilesService: vi.fn(() => ({ readOne })) };
});

const location = vi.hoisted(() => {
	return {
		exists: vi.fn(),
		read: vi.fn(),
		write: vi.fn(),
		stat: vi.fn(),
	};
});

vi.mock('../storage/index.js', () => {
	return { getStorage: async () => ({ location: () => location }) };
});

const knex = {
	select: () => ({ from: () => ({ first: async () => ({}) }) }),
} as unknown as Knex;

const service = () =>
	new AssetsService({ knex, schema: {} as SchemaOverview, accountability: null });

const transformation = { transformationParams: { width: 50 } };

beforeEach(() => {
	vi.mocked(readOne).mockResolvedValue(file);

	// the source file exists, the transformed derivative does not
	vi.mocked(location.exists).mockImplementation(
		async (name) => name === file.filename_disk,
	);

	vi.mocked(location.read).mockResolvedValue(Readable.from(['jpeg-bytes']));
	vi.mocked(location.write).mockResolvedValue(undefined);
	vi.mocked(location.stat).mockResolvedValue({ size: 10, modified: new Date() });
	env['ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION'] = 6000;
	env['ASSETS_TRANSFORM_MAX_CONCURRENT'] = 25;
	env['ASSETS_TRANSFORM_TIMEOUT'] = '7500ms';
});

describe('getAsset transformations', () => {
	test('refuses to transform while sharp is already saturated', async () => {
		vi.mocked(getSharpCounters).mockResolvedValue({ queue: 20, process: 6 });

		await expect(service().getAsset(file.id, transformation)).rejects.toThrow(
			ServiceUnavailableError,
		);

		expect(getSharpInstance).not.toHaveBeenCalled();
	});

	test('builds a transformer once there is capacity for it', async () => {
		vi.mocked(getSharpCounters).mockResolvedValue({ queue: 0, process: 0 });

		const transformer = Object.assign(new PassThrough(), {
			timeout: vi.fn(),
			rotate: vi.fn(),
			resize: vi.fn(),
		});

		vi.mocked(getSharpInstance).mockResolvedValue(transformer as never);

		const { file: served } = await service().getAsset(file.id, transformation);

		expect(getSharpInstance).toHaveBeenCalled();
		expect(transformer.resize).toHaveBeenCalled();
		expect(served.id).toBe(file.id);
	});
});
