import { ERRORS, Upload } from '@tus/utils';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import { Readable } from 'node:stream';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import getDatabase from '../../database/index.js';
import { ItemsService } from '../items.js';
import { TusDataStore } from './data-store.js';

const mockedDeps = vi.hoisted(() => {
	return {
		storageDriver: {
			tusExtensions: ['creation', 'termination', 'expiration'],
			createChunkedUpload: vi.fn(),
			writeChunk: vi.fn(),
			finishChunkedUpload: vi.fn(),
			deleteChunkedUpload: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			move: vi.fn(),
			exists: vi.fn(),
		},
		filesService: {
			createOne: vi.fn(),
			updateOne: vi.fn(),
			deleteOne: vi.fn(),
			readOne: vi.fn(),
			readByQuery: vi.fn(),
		},
		logger: { warn: vi.fn(), error: vi.fn() },
	};
});

vi.mock('../items.js', () => {
	return {
		ItemsService: vi.fn(function () {
			return mockedDeps.filesService;
		}),
	};
});

vi.mock('../../database/index.js', () => ({ default: vi.fn() }));

vi.mock('../../logger/index.js', () => {
	return {
		useLogger: () => mockedDeps.logger,
	};
});

let mockedKnex: Knex;
let knexTracker: Tracker;

beforeAll(() => {
	mockedKnex = knex.default({ client: MockClient });
	knexTracker = createTracker(mockedKnex);
});

beforeEach(() => {
	vi.mocked(getDatabase).mockReturnValue(mockedKnex);
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
});

afterEach(() => {
	knexTracker.reset();
	vi.useRealTimers();
	vi.resetAllMocks();
});

describe('TusDataStore constructor', () => {
	test('keeps the configured chunk and max sizes', () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: 5242880,
				MAX_SIZE: 104857600,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		expect(tusStore).toMatchObject({
			chunkSize: 5242880,
			maxSize: 104857600,
			extensions: ['creation', 'termination', 'expiration'],
		});

		expect(tusStore.getExpiration()).toBe(600000);
	});

	test('leaves unlimited chunk and max sizes undefined', () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		expect(tusStore).toMatchObject({ chunkSize: undefined, maxSize: undefined });
	});
});

describe('TusDataStore.create', () => {
	test('refuses an upload without size', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			metadata: { filename_download: 'photo.jpg' },
		}))).rejects.toBe(ERRORS.INVALID_METADATA);

		expect(mockedDeps.filesService.createOne).not.toHaveBeenCalled();
	});

	test('refuses an upload without metadata', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
		}))).rejects.toBe(ERRORS.INVALID_METADATA);
	});

	test('refuses an upload without filename_download', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { type: 'image/jpeg' },
		}))).rejects.toBe(ERRORS.INVALID_METADATA);
	});

	test('creates the file row, then the chunked upload under its pk', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: { user: 'user-1' } as any,
		});

		knexTracker.on.select('directus_settings').response({
			storage_default_folder: 'folder-default',
		});

		mockedDeps.filesService.createOne.mockImplementationOnce(async (createdFile) => {
			expect(createdFile).toEqual({
				filename_download: 'my_photo.jpg',
				type: 'application/octet-stream',
				title: 'My Photo.jpg',
				tus_id: 'tus-1',
				tus_data: {
					id: 'tus-1',
					size: 1024,
					offset: 0,
					storage: undefined,
					creation_date: '2026-01-01T00:00:00.000Z',
					metadata: {
						filename_download: 'my_photo.jpg',
						type: 'application/octet-stream',
						title: 'My Photo.jpg',
					},
				},
				filesize: 1024,
				storage: 'local',
				folder: 'folder-default',
			});

			return 'file-1';
		});

		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({
			id: 'tus-1',
			size: 1024,
			offset: 0,
			metadata: { id: 'file-1' },
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { filename_download: 'my_photo.jpg' },
		}))).resolves.toEqual({
			id: 'tus-1',
			size: 1024,
			offset: 0,
			metadata: { id: 'file-1' },
		});

		expect(ItemsService).toHaveBeenCalledWith('directus_files', {
			accountability: { user: 'user-1' },
			schema: { collections: {}, relations: [] },
			knex: mockedKnex,
		});

		expect(mockedDeps.filesService.createOne).toHaveBeenCalledOnce();

		expect(mockedDeps.filesService.createOne).toHaveBeenCalledWith(
			expect.anything(),
			{ emitEvents: false },
		);

		expect(mockedDeps.storageDriver.createChunkedUpload).toHaveBeenCalledWith(
			'file-1.jpg',
			{
				id: 'tus-1',
				size: 1024,
				offset: 0,
				storage: undefined,
				creation_date: '2026-01-01T00:00:00.000Z',
				metadata: {
					id: 'file-1',
					filename_download: 'my_photo.jpg',
					type: 'application/octet-stream',
					title: 'My Photo.jpg',
				},
			},
		);

		expect(mockedDeps.filesService.updateOne).toHaveBeenCalledWith(
			'file-1',
			{
				filename_download: 'my_photo.jpg',
				type: 'application/octet-stream',
				title: 'My Photo.jpg',
				tus_id: 'tus-1',
				tus_data: {
					id: 'tus-1',
					size: 1024,
					offset: 0,
					metadata: { id: 'file-1' },
				},
				filesize: 1024,
				storage: 'local',
				folder: 'folder-default',
				filename_disk: 'file-1.jpg',
			},
			{ emitEvents: false },
		);
	});

	test('keeps the given folder, type and title', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.createOne.mockImplementationOnce(async (createdFile) => {
			expect(createdFile).toEqual({
				filename_download: 'scan',
				type: 'image/png',
				title: 'Scanned page',
				folder: 'folder-given',
				tus_id: 'tus-1',
				tus_data: {
					id: 'tus-1',
					size: 1024,
					offset: 0,
					storage: undefined,
					creation_date: '2026-01-01T00:00:00.000Z',
					metadata: {
						filename_download: 'scan',
						type: 'image/png',
						title: 'Scanned page',
						folder: 'folder-given',
					},
				},
				filesize: 1024,
				storage: 'local',
			});

			return 'file-1';
		});

		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({
			id: 'tus-1',
		});

		await tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				filename_download: 'scan',
				type: 'image/png',
				title: 'Scanned page',
				folder: 'folder-given',
			},
		}));

		expect(knexTracker.history.select).toEqual([]);

		expect(mockedDeps.storageDriver.createChunkedUpload).toHaveBeenCalledWith(
			'file-1.png',
			expect.anything(),
		);
	});

	test('sets no folder when settings have no default folder', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_settings').response({
			storage_default_folder: null,
		});

		mockedDeps.filesService.createOne.mockImplementationOnce(async (createdFile) => {
			expect(createdFile).not.toHaveProperty('folder');
			return 'file-1';
		});

		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({
			id: 'tus-1',
		});

		await tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { filename_download: 'notes.txt', type: 'text/plain' },
		}));

		expect(mockedDeps.filesService.createOne).toHaveBeenCalledOnce();
	});

	test('refuses a filename_disk that names no file, before any row', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { filename_download: 'notes.txt', filename_disk: '/' },
		}))).rejects.toStrictEqual({
			status_code: 400,
			body: '"filename_disk" must name a file, not a directory',
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { filename_download: 'notes.txt', filename_disk: 'notes/' },
		}))).rejects.toStrictEqual({
			status_code: 400,
			body: '"filename_disk" must name a file, not a directory',
		});

		expect(mockedDeps.filesService.createOne).not.toHaveBeenCalled();
	});

	test('keeps a filename_disk given in the metadata', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-1');

		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({
			id: 'tus-1',
		});

		await tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				filename_download: 'notes.txt',
				filename_disk: 'custom-name.txt',
			},
		}));

		expect(mockedDeps.storageDriver.createChunkedUpload).toHaveBeenCalledWith(
			'custom-name.txt',
			expect.anything(),
		);
	});

	test('refuses a filename_disk another file holds, before any row', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.storageDriver.exists.mockResolvedValueOnce(true);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-1');

		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({
			id: 'tus-1',
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				filename_download: 'notes.txt',
				filename_disk: 'file-9.jpg',
			},
		}))).rejects.toStrictEqual({
			status_code: 400,
			body: '"filename_disk" "file-9.jpg" is already used by another file',
		});

		expect(mockedDeps.storageDriver.exists).toHaveBeenCalledWith('file-9.jpg');
		expect(mockedDeps.filesService.createOne).not.toHaveBeenCalled();
		expect(mockedDeps.storageDriver.createChunkedUpload).not.toHaveBeenCalled();
	});

	test('lets a replacement keep the disk name of the file it replaces', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_files').response({
			folder: null,
			filename_download: 'photo.jpg',
			filename_disk: 'file-9.jpg',
			title: 'Photo',
			description: null,
			metadata: null,
			tus_id: null,
		});

		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.storageDriver.exists.mockResolvedValueOnce(true);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-10');

		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({
			id: 'tus-1',
		});

		await tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				id: 'file-9',
				filename_download: 'photo.jpg',
				filename_disk: 'file-9.jpg',
			},
		}));

		expect(mockedDeps.storageDriver.createChunkedUpload).toHaveBeenCalledWith(
			'file-9.jpg',
			expect.anything(),
		);
	});

	test('refuses to replace a file another upload is still writing', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_files').response({
			folder: null,
			filename_download: 'photo.jpg',
			filename_disk: 'file-9.jpg',
			title: 'Photo',
			description: null,
			metadata: null,
			tus_id: 'tus-other',
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { id: 'file-9', filename_download: 'photo.jpg' },
		}))).rejects.toBe(ERRORS.INVALID_METADATA);

		expect(knexTracker.history.select[0]!.bindings).toEqual(['file-9', 1]);
		expect(mockedDeps.filesService.createOne).not.toHaveBeenCalled();
	});

	test('creates a temp row recording which existing file it replaces', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_files').response({
			folder: null,
			filename_download: 'photo.jpg',
			filename_disk: 'file-9.jpg',
			title: 'Photo',
			description: null,
			metadata: null,
			tus_id: null,
		});

		knexTracker.on.select('directus_settings').response(undefined);

		mockedDeps.filesService.createOne.mockImplementationOnce(async (createdFile) => {
			expect(createdFile).toEqual({
				filename_download: 'photo.jpg',
				type: 'image/jpeg',
				title: 'Photo',
				replace_id: 'file-9',
				tus_id: 'tus-1',
				tus_data: {
					id: 'tus-1',
					size: 1024,
					offset: 0,
					storage: undefined,
					creation_date: '2026-01-01T00:00:00.000Z',
					metadata: {
						id: 'file-9',
						filename_download: 'photo.jpg',
						type: 'image/jpeg',
						title: 'Photo',
						replace_id: 'file-9',
					},
				},
				filesize: 1024,
				storage: 'local',
			});

			return 'file-temp';
		});

		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({
			id: 'tus-1',
		});

		await tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				id: 'file-9',
				filename_download: 'photo.jpg',
				type: 'image/jpeg',
				title: 'Photo',
			},
		}));

		expect(mockedDeps.storageDriver.createChunkedUpload).toHaveBeenCalledWith(
			'file-temp.jpg',
			{
				id: 'tus-1',
				size: 1024,
				offset: 0,
				storage: undefined,
				creation_date: '2026-01-01T00:00:00.000Z',
				metadata: {
					id: 'file-9',
					filename_download: 'photo.jpg',
					type: 'image/jpeg',
					title: 'Photo',
					replace_id: 'file-9',
				},
			},
		);
	});

	test('deletes the new row when the chunked upload cannot start', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_files').response(undefined);
		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-1');

		mockedDeps.storageDriver.createChunkedUpload.mockRejectedValueOnce(
			new Error('disk full'),
		);

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { id: 'file-unknown', filename_download: 'photo.jpg' },
		}))).rejects.toBe(ERRORS.UNKNOWN_ERROR);

		expect(mockedDeps.filesService.deleteOne).toHaveBeenCalledWith(
			'file-1',
			{ emitEvents: false },
		);

		expect(mockedDeps.filesService.updateOne).not.toHaveBeenCalled();

		expect(mockedDeps.logger.warn).toHaveBeenCalledWith(
			'Couldn\'t create chunked upload for file-1.jpg',
		);

		expect(mockedDeps.logger.warn).toHaveBeenCalledWith(new Error('disk full'));
	});

	test('refuses a replacement whose chunked upload cannot start', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_files').response({
			folder: null,
			filename_download: 'photo.jpg',
			filename_disk: 'file-9.jpg',
			title: 'Photo',
			description: null,
			metadata: null,
			tus_id: null,
		});

		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-temp');

		mockedDeps.storageDriver.createChunkedUpload.mockRejectedValueOnce(
			new Error('disk full'),
		);

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: { id: 'file-9', filename_download: 'photo.jpg' },
		}))).rejects.toBe(ERRORS.UNKNOWN_ERROR);

		expect(mockedDeps.filesService.deleteOne).toHaveBeenCalledWith(
			'file-temp',
			{ emitEvents: false },
		);

		expect(mockedDeps.filesService.updateOne).not.toHaveBeenCalled();
	});

	test('refuses a filename_disk below a file, leaving no row', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_files').response(undefined);
		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-1');
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-2');

		mockedDeps.storageDriver.createChunkedUpload.mockRejectedValueOnce(
			Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' }),
		);

		mockedDeps.storageDriver.createChunkedUpload.mockRejectedValueOnce(
			Object.assign(new Error('ENOTDIR: not a directory'), { code: 'ENOTDIR' }),
		);

		await expect(tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				filename_download: 'notes.txt',
				filename_disk: 'kept.txt/below-a-file',
			},
		}))).rejects.toStrictEqual({
			status_code: 400,
			body: '"filename_disk" must not name a path below an existing file',
		});

		await expect(tusStore.create(new Upload({
			id: 'tus-2',
			offset: 0,
			size: 1024,
			metadata: {
				filename_download: 'notes.txt',
				filename_disk: 'kept.txt/deeper/below-a-file',
			},
		}))).rejects.toStrictEqual({
			status_code: 400,
			body: '"filename_disk" must not name a path below an existing file',
		});

		expect(mockedDeps.filesService.deleteOne).toHaveBeenNthCalledWith(
			1,
			'file-1',
			{ emitEvents: false },
		);

		expect(mockedDeps.filesService.deleteOne).toHaveBeenNthCalledWith(
			2,
			'file-2',
			{ emitEvents: false },
		);
	});

	test('names the disk file by its pk alone for an unknown type', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-1');
		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({});

		await tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				filename_download: 'noext',
				type: 'application/x-unknown-thing',
			},
		}));

		expect(mockedDeps.storageDriver.createChunkedUpload).toHaveBeenCalledWith(
			'file-1',
			expect.anything(),
		);
	});

	test('reports the created pk for an id no file holds', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		knexTracker.on.select('directus_files').response(undefined);
		knexTracker.on.select('directus_settings').response(undefined);
		mockedDeps.filesService.createOne.mockResolvedValueOnce('file-1');
		mockedDeps.storageDriver.createChunkedUpload.mockResolvedValueOnce({});

		await tusStore.create(new Upload({
			id: 'tus-1',
			offset: 0,
			size: 1024,
			metadata: {
				id: 'file-unknown',
				filename_download: 'photo.jpg',
				type: 'image/jpeg',
			},
		}));

		expect(mockedDeps.storageDriver.createChunkedUpload).toHaveBeenCalledWith(
			'file-1.jpg',
			{
				id: 'tus-1',
				size: 1024,
				offset: 0,
				storage: undefined,
				creation_date: '2026-01-01T00:00:00.000Z',
				metadata: {
					id: 'file-1',
					filename_download: 'photo.jpg',
					type: 'image/jpeg',
					title: 'Photo.jpg',
				},
			},
		);
	});
});

describe('TusDataStore.write', () => {
	test('refuses an unknown upload', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: { user: 'user-1' } as any,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([]);

		await expect(tusStore.write(Readable.from(['abc']), 'tus-1', 0))
			.rejects.toBe(ERRORS.FILE_NOT_FOUND);

		expect(mockedDeps.filesService.readByQuery).toHaveBeenCalledWith({
			filter: {
				tus_id: { _eq: 'tus-1' },
				storage: { _eq: 'local' },
				uploaded_by: { _eq: 'user-1' },
			},
		});
	});

	test('records the new offset of a partial chunk', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-1',
			tus_id: 'tus-1',
			filename_disk: 'file-1.jpg',
			filesize: 1024,
			tus_data: { id: 'tus-1', size: 1024, offset: 0, metadata: {} },
		}]);

		mockedDeps.storageDriver.writeChunk.mockResolvedValueOnce(512);
		const chunkStream = Readable.from(['abc']);

		await expect(tusStore.write(chunkStream, 'tus-1', 0)).resolves.toBe(512);

		expect(mockedDeps.filesService.readByQuery).toHaveBeenCalledWith({
			filter: { tus_id: { _eq: 'tus-1' }, storage: { _eq: 'local' } },
		});

		expect(ItemsService).toHaveBeenCalledWith('directus_files', {
			schema: { collections: {}, relations: [] },
		});

		expect(mockedDeps.storageDriver.writeChunk).toHaveBeenCalledWith(
			'file-1.jpg',
			chunkStream,
			0,
			{ id: 'tus-1', size: 1024, offset: 0, metadata: {} },
		);

		expect(mockedDeps.filesService.updateOne).toHaveBeenCalledWith('file-1', {
			tus_data: { id: 'tus-1', size: 1024, offset: 512, metadata: {} },
		});

		expect(mockedDeps.storageDriver.finishChunkedUpload).not.toHaveBeenCalled();
	});

	test('finishes the upload on its last chunk', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-1',
			tus_id: 'tus-1',
			filename_disk: 'file-1.jpg',
			filesize: '1024',
			tus_data: { id: 'tus-1', size: 1024, offset: 512, metadata: {} },
		}]);

		mockedDeps.storageDriver.writeChunk.mockResolvedValueOnce(1024);

		await expect(tusStore.write(Readable.from(['abc']), 'tus-1', 512))
			.resolves.toBe(1024);

		expect(mockedDeps.storageDriver.finishChunkedUpload).toHaveBeenCalledWith(
			'file-1.jpg',
			{ id: 'tus-1', size: 1024, offset: 512, metadata: {} },
		);

		expect(mockedDeps.filesService.readOne).not.toHaveBeenCalled();
		expect(mockedDeps.storageDriver.move).not.toHaveBeenCalled();
	});

	test('moves a finished replacement over the replaced file', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-temp',
			tus_id: 'tus-1',
			filename_disk: 'file-temp.jpg',
			filesize: 1024,
			tus_data: {
				id: 'tus-1',
				size: 1024,
				offset: 0,
				metadata: { replace_id: 'file-9' },
			},
		}]);

		mockedDeps.storageDriver.writeChunk.mockResolvedValueOnce(1024);

		mockedDeps.filesService.readOne.mockResolvedValueOnce({
			filename_disk: 'file-9.jpg',
		});

		mockedDeps.storageDriver.list.mockReturnValueOnce(
			(async function* () {
				yield 'file-9.jpg';
				yield 'file-9__thumbnail.webp';
			})(),
		);

		await expect(tusStore.write(Readable.from(['abc']), 'tus-1', 0))
			.resolves.toBe(1024);

		expect(mockedDeps.filesService.readOne).toHaveBeenCalledWith('file-9', {
			fields: ['filename_disk'],
		});

		expect(mockedDeps.storageDriver.list).toHaveBeenCalledWith('file-9');

		expect(mockedDeps.storageDriver.delete.mock.calls).toEqual([
			['file-9.jpg'],
			['file-9__thumbnail.webp'],
		]);

		expect(mockedDeps.storageDriver.move).toHaveBeenCalledWith(
			'file-temp.jpg',
			'file-9.jpg',
		);
	});

	test('removes the upload when it cannot be finished', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValue([{
			id: 'file-1',
			tus_id: 'tus-1',
			filename_disk: 'file-1.jpg',
			filesize: 1024,
			tus_data: { id: 'tus-1', size: 1024, offset: 0, metadata: {} },
		}]);

		mockedDeps.storageDriver.writeChunk.mockResolvedValueOnce(1024);

		mockedDeps.storageDriver.finishChunkedUpload.mockRejectedValueOnce(
			new Error('assemble failed'),
		);

		await expect(tusStore.write(Readable.from(['abc']), 'tus-1', 0))
			.rejects.toBe(ERRORS.FILE_WRITE_ERROR);

		expect(mockedDeps.storageDriver.deleteChunkedUpload).toHaveBeenCalledWith(
			'file-1.jpg',
			{ id: 'tus-1', size: 1024, offset: 0, metadata: {} },
		);

		expect(mockedDeps.filesService.deleteOne).toHaveBeenCalledWith('file-1');

		expect(mockedDeps.logger.error).toHaveBeenCalledWith(
			new Error('assemble failed'),
			'Error writing chunk for upload "%s" at offset %d',
			'tus-1',
			0,
		);
	});

	test('rethrows a tus server error as is', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-1',
			tus_id: 'tus-1',
			filename_disk: 'file-1.jpg',
			filesize: 1024,
			tus_data: { id: 'tus-1', size: 1024, offset: 0, metadata: {} },
		}]);

		mockedDeps.storageDriver.writeChunk.mockRejectedValueOnce(
			ERRORS.UNKNOWN_ERROR,
		);

		await expect(tusStore.write(Readable.from(['abc']), 'tus-1', 0))
			.rejects.toBe(ERRORS.UNKNOWN_ERROR);
	});

	test('reports a non-500 tus error as a file write error', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-1',
			tus_id: 'tus-1',
			filename_disk: 'file-1.jpg',
			filesize: 1024,
			tus_data: { id: 'tus-1', size: 1024, offset: 0, metadata: {} },
		}]);

		mockedDeps.storageDriver.writeChunk.mockRejectedValueOnce(
			ERRORS.INVALID_OFFSET,
		);

		await expect(tusStore.write(Readable.from(['abc']), 'tus-1', 0))
			.rejects.toBe(ERRORS.FILE_WRITE_ERROR);
	});
});

describe('TusDataStore.remove', () => {
	test('deletes the chunked upload, then the file row', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-1',
			tus_id: 'tus-1',
			filename_disk: 'file-1.jpg',
			tus_data: { id: 'tus-1', size: 1024, offset: 512 },
		}]);

		await tusStore.remove('tus-1');

		expect(mockedDeps.storageDriver.deleteChunkedUpload).toHaveBeenCalledWith(
			'file-1.jpg',
			{ id: 'tus-1', size: 1024, offset: 512 },
		);

		expect(mockedDeps.filesService.deleteOne).toHaveBeenCalledWith('file-1');
	});
});

describe('TusDataStore.deleteExpired', () => {
	test('removes only the incomplete uploads past their expiration', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery
			.mockResolvedValueOnce([
				{
					tus_id: 'tus-expired',
					modified_on: '2025-12-31T23:49:00.000Z',
					tus_data: { size: 1024, offset: 512 },
				},
				{
					tus_id: 'tus-recent',
					modified_on: '2025-12-31T23:51:00.000Z',
					tus_data: { size: 1024, offset: 512 },
				},
				{
					tus_id: 'tus-expiring-now',
					modified_on: '2025-12-31T23:50:00.000Z',
					tus_data: { size: 1024, offset: 512 },
				},
				{
					tus_id: 'tus-complete',
					modified_on: '2025-12-31T00:00:00.000Z',
					tus_data: { size: 1024, offset: 1024 },
				},
				{
					tus_id: 'tus-no-data',
					modified_on: '2025-12-31T00:00:00.000Z',
					tus_data: null,
				},
				{
					tus_id: 'tus-never-modified',
					modified_on: null,
					tus_data: { size: 1024, offset: 512 },
				},
				null,
			])
			.mockResolvedValueOnce([{
				id: 'file-expired',
				tus_id: 'tus-expired',
				filename_disk: 'file-expired.jpg',
				tus_data: { size: 1024, offset: 512 },
			}]);

		await expect(tusStore.deleteExpired()).resolves.toBe(1);

		expect(mockedDeps.filesService.readByQuery).toHaveBeenNthCalledWith(1, {
			fields: ['modified_on', 'tus_id', 'tus_data'],
			filter: { tus_id: { _nnull: true } },
		});

		expect(mockedDeps.filesService.readByQuery).toHaveBeenNthCalledWith(2, {
			filter: { tus_id: { _eq: 'tus-expired' }, storage: { _eq: 'local' } },
		});

		expect(mockedDeps.filesService.deleteOne).toHaveBeenCalledOnce();
		expect(mockedDeps.filesService.deleteOne).toHaveBeenCalledWith('file-expired');
	});

	test('counts a removal that fails', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery
			.mockResolvedValueOnce([{
				tus_id: 'tus-expired',
				modified_on: '2025-12-31T23:49:00.000Z',
				tus_data: { size: 1024, offset: 512 },
			}])
			.mockResolvedValueOnce([]);

		await expect(tusStore.deleteExpired()).resolves.toBe(1);
		expect(mockedDeps.filesService.deleteOne).not.toHaveBeenCalled();
	});

	test('keeps every upload when expiration is disabled', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 0,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			tus_id: 'tus-expired',
			modified_on: '2020-01-01T00:00:00.000Z',
			tus_data: { size: 1024, offset: 512 },
		}]);

		await expect(tusStore.deleteExpired()).resolves.toBe(0);
		expect(mockedDeps.filesService.readByQuery).toHaveBeenCalledOnce();
	});

	test('removes nothing when the read returns no list', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce(null);

		await expect(tusStore.deleteExpired()).resolves.toBe(0);
	});
});

describe('TusDataStore.getUpload', () => {
	test('rebuilds the upload from the stored tus data', async () => {
		const tusStore = new TusDataStore({
			constants: {
				ENABLED: true,
				CHUNK_SIZE: null,
				MAX_SIZE: null,
				EXPIRATION_TIME: 600000,
				SCHEDULE: '*/5 * * * *',
			},
			location: 'local',
			driver: mockedDeps.storageDriver as any,
			schema: { collections: {}, relations: [] },
			accountability: undefined,
		});

		mockedDeps.filesService.readByQuery.mockResolvedValueOnce([{
			id: 'file-1',
			tus_id: 'tus-1',
			tus_data: {
				id: 'tus-1',
				size: 1024,
				offset: 512,
				metadata: { id: 'file-1' },
				creation_date: '2025-12-31T00:00:00.000Z',
			},
		}]);

		await expect(tusStore.getUpload('tus-1')).resolves.toStrictEqual(
			new Upload({
				id: 'tus-1',
				size: 1024,
				offset: 512,
				metadata: { id: 'file-1' },
				creation_date: '2025-12-31T00:00:00.000Z',
			}),
		);
	});
});
