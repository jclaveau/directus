import { oneLine } from '@directus/utils';
import { useEnv } from '@directus/env';
import { supportsTus } from '@directus/storage';
import { Server } from '@tus/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import emitter from '../../emitter.js';
import { getStorage } from '../../storage/index.js';
import { extractMetadata } from '../files/lib/extract-metadata.js';
import { ItemsService } from '../index.js';
import { TusDataStore } from './data-store.js';
import { createTusServer } from './server.js';

const mockedDeps = vi.hoisted(() => {
	return {
		resumableUploads: {
			ENABLED: true,
			CHUNK_SIZE: null as number | null,
			MAX_SIZE: null as number | null,
			EXPIRATION_TIME: 600000,
			SCHEDULE: '*/5 * * * *',
		},
		tusServer: { on: vi.fn(), removeAllListeners: vi.fn() },
		filesService: {
			readByQuery: vi.fn(),
			readOne: vi.fn(),
			updateOne: vi.fn(),
			deleteOne: vi.fn(),
		},
		storageLocation: vi.fn(),
	};
});

vi.mock('@directus/env', () => ({ useEnv: vi.fn() }));

vi.mock('@directus/storage', () => ({ supportsTus: vi.fn() }));

vi.mock('@tus/server', async (importOriginal) => {
	return {
		...(await importOriginal<object>()),
		Server: vi.fn(function () {
			return mockedDeps.tusServer;
		}),
	};
});

vi.mock('../../constants.js', () => {
	return {
		RESUMABLE_UPLOADS: mockedDeps.resumableUploads,
	};
});

vi.mock('../../storage/index.js', () => ({ getStorage: vi.fn() }));

vi.mock('../files/lib/extract-metadata.js', () => {
	return {
		extractMetadata: vi.fn(),
	};
});

vi.mock('../index.js', () => {
	return {
		ItemsService: vi.fn(function () {
			return mockedDeps.filesService;
		}),
	};
});

vi.mock('./data-store.js', () => {
	return {
		TusDataStore: vi.fn(function () {
			return { name: 'tus-data-store' };
		}),
	};
});

vi.mock('./lockers.js', () => {
	return {
		getTusLocker: vi.fn(() => 'tus-locker'),
	};
});

vi.mock('../../emitter.js', () => ({ default: { emitAction: vi.fn() } }));

vi.mock('../../database/index.js', () => {
	return {
		default: vi.fn(() => 'database-handle'),
	};
});

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({
		STORAGE_LOCATIONS: 'local,s3',
		PUBLIC_URL: 'https://cms.example',
	});

	vi.mocked(getStorage).mockResolvedValue({
		location: mockedDeps.storageLocation,
	} as any);

	mockedDeps.storageLocation.mockReturnValue('local-driver');
	vi.mocked(supportsTus).mockReturnValue(true);
});

afterEach(() => {
	mockedDeps.resumableUploads.MAX_SIZE = null;
	vi.resetAllMocks();
});

describe('createTusServer', () => {
	test('refuses a first storage location without TUS support', async () => {
		vi.mocked(supportsTus).mockReturnValue(false);

		await expect(createTusServer({
			schema: { collections: {}, relations: [] },
		})).rejects.toStrictEqual(new Error(
			'Storage location local does not support the TUS protocol',
		));

		expect(mockedDeps.storageLocation).toHaveBeenCalledWith('local');
		expect(supportsTus).toHaveBeenCalledWith('local-driver');
	});

	test('serves /files/tus from the first storage location', async () => {
		const [tusServer] = await createTusServer({
			schema: { collections: {}, relations: [] },
			accountability: { user: 'user-1' } as any,
		});

		expect(tusServer).toBe(mockedDeps.tusServer);

		expect(TusDataStore).toHaveBeenCalledWith({
			constants: mockedDeps.resumableUploads,
			accountability: { user: 'user-1' },
			schema: { collections: {}, relations: [] },
			location: 'local',
			driver: 'local-driver',
		});

		expect(Server).toHaveBeenCalledWith({
			path: '/files/tus',
			datastore: { name: 'tus-data-store' },
			locker: 'tus-locker',
			onUploadFinish: expect.any(Function),
			generateUrl: expect.any(Function),
			relativeLocation: true,
		});
	});

	test('caps the upload size when a max size is set', async () => {
		mockedDeps.resumableUploads.MAX_SIZE = 104857600;

		await createTusServer({ schema: { collections: {}, relations: [] } });

		expect(vi.mocked(Server).mock.calls[0]![0]).toMatchObject({
			maxSize: 104857600,
		});
	});

	test('uses absolute locations when PUBLIC_URL is a path', async () => {
		vi.mocked(useEnv).mockReturnValue({
			STORAGE_LOCATIONS: 'local',
			PUBLIC_URL: '/',
		});

		await createTusServer({ schema: { collections: {}, relations: [] } });

		expect(vi.mocked(Server).mock.calls[0]![0]).toMatchObject({
			relativeLocation: false,
		});
	});

	test('builds upload urls under PUBLIC_URL', async () => {
		await createTusServer({ schema: { collections: {}, relations: [] } });

		const { generateUrl } = vi.mocked(Server).mock.calls[0]![0];

		expect(generateUrl!({} as any, { id: 'tus-1' } as any))
			.toBe('https://cms.example/files/tus/tus-1');
	});

	test('answers the new file id on upload creation', async () => {
		await createTusServer({ schema: { collections: {}, relations: [] } });

		expect(mockedDeps.tusServer.on).toHaveBeenCalledWith(
			'POST_CREATE',
			expect.any(Function),
		);

		const httpResponse = { setHeader: vi.fn() };

		await mockedDeps.tusServer.on.mock.calls[0]![1](
			{},
			httpResponse,
			{ metadata: { id: 'file-1' } },
		);

		expect(httpResponse.setHeader).toHaveBeenCalledWith(
			'Directus-File-Id',
			'file-1',
		);
	});

	test('cleanup removes every server listener', async () => {
		const [, cleanupServer] = await createTusServer({
			schema: { collections: {}, relations: [] },
		});

		cleanupServer();

		expect(mockedDeps.tusServer.removeAllListeners).toHaveBeenCalledOnce();
	});
});

describe('createTusServer onUploadFinish', () => {
	test('does nothing when no file holds the upload', async () => {
		await createTusServer({ schema: { collections: {}, relations: [] } });
		const { onUploadFinish } = vi.mocked(Server).mock.calls[0]![0];

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([]);

		await expect(onUploadFinish!(
			{ schema: { collections: {} } } as any,
			'response' as any,
			{ id: 'tus-1' } as any,
		)).resolves.toBe('response');

		expect(ItemsService).toHaveBeenCalledWith('directus_files', {
			schema: { collections: {} },
		});

		expect(mockedDeps.filesService.readByQuery).toHaveBeenCalledWith({
			filter: { tus_id: { _eq: 'tus-1' } },
			limit: 1,
		});

		expect(mockedDeps.filesService.updateOne).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('stores the metadata and clears the tus columns of a new file', async () => {
		await createTusServer({ schema: { collections: {}, relations: [] } });
		const { onUploadFinish } = vi.mocked(Server).mock.calls[0]![0];

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-1',
			storage: 'local',
			filename_disk: 'file-1.jpg',
			tus_id: 'tus-1',
			tus_data: { id: 'tus-1', metadata: {} },
		}]);

		vi.mocked(extractMetadata).mockResolvedValueOnce({
			width: 800,
			height: 600,
		});

		await expect(onUploadFinish!(
			{
				schema: { collections: {} },
				accountability: { user: 'user-1' },
			} as any,
			'response' as any,
			{ id: 'tus-1' } as any,
		)).resolves.toBe('response');

		expect(extractMetadata).toHaveBeenCalledWith('local', {
			id: 'file-1',
			storage: 'local',
			filename_disk: 'file-1.jpg',
			tus_id: 'tus-1',
			tus_data: { id: 'tus-1', metadata: {} },
		});

		expect(mockedDeps.filesService.updateOne).toHaveBeenCalledWith('file-1', {
			width: 800,
			height: 600,
			tus_id: null,
			tus_data: null,
		});

		expect(mockedDeps.filesService.deleteOne).not.toHaveBeenCalled();

		expect(emitter.emitAction).toHaveBeenCalledWith(
			'files.upload',
			{
				payload: {
					id: 'file-1',
					storage: 'local',
					filename_disk: 'file-1.jpg',
					width: 800,
					height: 600,
					tus_id: null,
					tus_data: null,
				},
				key: 'file-1',
				collection: 'directus_files',
			},
			{
				database: 'database-handle',
				schema: { collections: {} },
				accountability: { user: 'user-1' },
			},
		);
	});

	test(oneLine`
		moves a replacement onto the replaced file, then drops the temp row
	`, async () => {
		await createTusServer({ schema: { collections: {}, relations: [] } });
		const { onUploadFinish } = vi.mocked(Server).mock.calls[0]![0];

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-temp',
			storage: 'local',
			filename_download: 'new.png',
			filesize: 2048,
			type: 'image/png',
			title: 'Temp',
			tus_id: 'tus-1',
			tus_data: { id: 'tus-1', metadata: { replace_id: 'file-9' } },
		}]);

		mockedDeps.filesService.readOne.mockResolvedValueOnce({
			id: 'file-9',
			storage: 's3',
			filename_disk: 'file-9.jpg',
			filename_download: 'old.jpg',
			filesize: 1024,
			type: 'image/jpeg',
			title: 'Old',
		});

		vi.mocked(extractMetadata).mockResolvedValueOnce({
			width: 640,
			height: 480,
		});

		await expect(onUploadFinish!(
			{ schema: { collections: {} }, accountability: null } as any,
			'response' as any,
			{ id: 'tus-1' } as any,
		)).resolves.toBe('response');

		expect(mockedDeps.filesService.readOne).toHaveBeenCalledWith('file-9');

		expect(extractMetadata).toHaveBeenCalledWith('s3', {
			id: 'file-9',
			storage: 's3',
			filename_disk: 'file-9.jpg',
			filename_download: 'new.png',
			filesize: 2048,
			type: 'image/png',
			title: 'Old',
		});

		expect(mockedDeps.filesService.updateOne).toHaveBeenCalledWith('file-9', {
			filename_download: 'new.png',
			filesize: 2048,
			type: 'image/png',
			width: 640,
			height: 480,
		});

		expect(mockedDeps.filesService.deleteOne).toHaveBeenCalledWith('file-temp');

		expect(emitter.emitAction).toHaveBeenCalledWith(
			'files.upload',
			{
				payload: {
					id: 'file-9',
					storage: 's3',
					filename_disk: 'file-9.jpg',
					filename_download: 'new.png',
					filesize: 2048,
					type: 'image/png',
					title: 'Old',
					width: 640,
					height: 480,
				},
				key: 'file-9',
				collection: 'directus_files',
			},
			{
				database: 'database-handle',
				schema: { collections: {} },
				accountability: null,
			},
		);
	});
});
