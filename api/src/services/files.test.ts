import { InvalidPayloadError } from '@directus/errors';
import { Driver, StorageManager } from '@directus/storage';
import type { Knex } from 'knex';
import knex from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { PassThrough } from 'node:stream';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockInstance,
} from 'vitest';
import { getStorage } from '../storage/index.js';
import { withMeta } from '../utils/read-meta.js';
import { FilesService, ItemsService } from './index.js';

vi.mock('../storage/index.js');
vi.mock('@directus/storage');
vi.mock('./files/lib/extract-metadata.js');

describe('Integration Tests', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
		vi.clearAllMocks();
	});

	describe('Services / Files', () => {
		describe('createMany', () => {
			let service: FilesService;
			let superCreateMany: MockInstance;

			beforeEach(() => {
				service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				superCreateMany = vi.spyOn(ItemsService.prototype, 'createMany').mockReturnValue(Promise.resolve([1]));
			});

			it('throws InvalidPayloadError when "type" is not provided', async () => {
				try {
					await service.createMany([
						{
							title: 'Test File',
							storage: 'local',
							filename_download: 'test_file',
						},
					]);
				} catch (err: any) {
					expect(err).toBeInstanceOf(InvalidPayloadError);
					expect(err.message).toBe('Invalid payload. "type" is required.');
				}

				expect(superCreateMany).not.toHaveBeenCalled();
			});

			it('creates a file entry when "type" is provided', async () => {
				await service.createMany([
					{
						title: 'Test File',
						storage: 'local',
						filename_download: 'test_file',
						type: 'application/octet-stream',
					},
				]);

				expect(superCreateMany).toHaveBeenCalled();
			});

			it('throws InvalidPayloadError when any file in a multi-file payload is missing "type"', async () => {
				try {
					await service.createMany([
						{ type: 'application/octet-stream', filename_download: 'good.txt' },
						{ storage: 'local', filename_download: 'no-type.txt' },
					]);
				} catch (err: any) {
					expect(err).toBeInstanceOf(InvalidPayloadError);
					expect(err.message).toBe('Invalid payload. "type" is required.');
				}

				expect(superCreateMany).not.toHaveBeenCalled();
			});

			it('creates multiple file entries when all "type" fields are provided', async () => {
				await service.createMany([
					{ type: 'application/octet-stream', filename_download: 'first.txt' },
					{ type: 'image/jpeg', filename_download: 'second.jpg' },
				]);

				expect(superCreateMany).toHaveBeenCalled();
			});
		});

		describe('uploadOne', () => {
			let service: FilesService;
			let superUpdateOne: MockInstance;
			let superCreateOne: MockInstance;
			let mockDriver: Partial<Driver>;

			let sample: {
				id: string;
				filesize: number;
			};

			beforeEach(() => {
				service = new FilesService({
					knex: db,
					schema: {
						collections: {},
						relations: [],
					},
				});

				sample = {
					id: 'test-file-id-123',
					filesize: 500,
				};

				mockDriver = {
					read: vi.fn().mockResolvedValue(new PassThrough()),
					write: vi.fn(),
					stat: vi.fn().mockReturnValue({ size: sample.filesize }),
					exists: vi.fn().mockResolvedValue(false),
					list: vi.fn(async function* () {}),
					move: vi.fn(),
				};

				const mockStorage: Partial<StorageManager> = {
					location: vi.fn(() => mockDriver as Driver),
				};

				vi.mocked(getStorage).mockResolvedValue(mockStorage as StorageManager);

				tracker.on.select('select "storage_default_folder" from "directus_settings"').response([]);

				superCreateOne = vi
					.spyOn(ItemsService.prototype, 'createOne')
					.mockResolvedValue(sample.id);

				superUpdateOne = vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue(sample.id);
			});

			it('should set the `uploaded_on` field to the current date', async () => {
				tracker.on
					.select(
						'select "folder", "filename_download", "filename_disk", "title", "description", "metadata" from "directus_files" where "id" = ?',
					)
					.response(null);

				const mockData = {
					storage: 'local',
					type: 'image/jpeg',
					filename_download: 'test.jpg',
				};

				const mockDate = new Date();

				vi.setSystemTime(mockDate);

				await service.uploadOne(new PassThrough(), mockData);

				vi.useRealTimers();

				expect(superUpdateOne).toHaveBeenCalledWith(
					sample.id,
					expect.objectContaining({
						...mockData,
						uploaded_on: mockDate.toISOString(),
					}),
					{ emitEvents: false },
				);
			});

			it('should update the `filename_disk` extension to the correct mimetype', async () => {
				tracker.on
					.select(
						'select "folder", "filename_download", "filename_disk", "title", "description", "metadata" from "directus_files" where "id" = ?',
					)
					.response(null);

				const mockDataJPG = {
					storage: 'local',
					type: 'image/jpeg',
					filename_download: 'test.jpg',
				};

				const mockDataPNG = {
					storage: 'local',
					type: 'image/png',
					filename_download: 'test.png',
				};

				const mockDate = new Date();

				vi.setSystemTime(mockDate);

				await service.uploadOne(new PassThrough(), mockDataJPG);

				expect(superUpdateOne).toHaveBeenCalledWith(
					sample.id,
					expect.objectContaining({
						...mockDataJPG,
						uploaded_on: mockDate.toISOString(),
						filename_disk: `${sample.id}.jpg`,
					}),
					{ emitEvents: false },
				);

				await service.uploadOne(new PassThrough(), mockDataPNG);

				expect(superUpdateOne).toHaveBeenCalledWith(
					sample.id,
					expect.objectContaining({
						...mockDataPNG,
						uploaded_on: mockDate.toISOString(),
						filename_disk: `${sample.id}.png`,
					}),
					{ emitEvents: false },
				);

				vi.useRealTimers();
			});

			it('refuses a filename_disk another file holds, writing nothing', async () => {
				tracker.on
					.select('from "directus_files" where "id" = ?')
					.response(null);

				vi.mocked(mockDriver.exists!).mockResolvedValue(true);

				await expect(
					service.uploadOne(new PassThrough(), {
						storage: 'local',
						type: 'text/plain',
						filename_download: 'notes.txt',
						filename_disk: 'held.txt',
					}),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "held.txt" is already used by another file',
					}),
				);

				expect(mockDriver.exists).toHaveBeenCalledWith('held.txt');
				expect(superCreateOne).not.toHaveBeenCalled();
				expect(mockDriver.write).not.toHaveBeenCalled();
			});

			it('lets a replacement keep its own disk name', async () => {
				tracker.on
					.select('from "directus_files" where "id" = ?')
					.response({ filename_disk: 'test-file-id-123.txt' });

				vi.mocked(mockDriver.exists!).mockResolvedValue(true);

				await service.uploadOne(
					new PassThrough(),
					{
						storage: 'local',
						type: 'text/plain',
						filename_download: 'notes.txt',
						filename_disk: 'test-file-id-123.txt',
					},
					sample.id,
				);

				expect(mockDriver.move).toHaveBeenCalledWith(
					'temp_test-file-id-123.txt',
					'test-file-id-123.txt',
				);
			});
		});

		describe('disk names held by rows', () => {
			let service: FilesService;

			beforeEach(() => {
				service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				vi.spyOn(ItemsService.prototype, 'createMany').mockResolvedValue(['new-id']);

				vi.spyOn(ItemsService.prototype, 'updateGroups')
					.mockResolvedValue(['own-id']);
			});

			it('refuses a created row naming a disk name another row holds', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([{ id: 'held-id', filename_disk: 'held.txt' }]);

				await expect(
					service.createMany([{ type: 'text/plain', filename_disk: 'held.txt' }]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "held.txt" is already used by another file',
					}),
				);

				expect(ItemsService.prototype.createMany).not.toHaveBeenCalled();
			});

			it('refuses two created rows sharing a disk name', async () => {
				await expect(
					service.createMany([
						{ type: 'text/plain', filename_disk: 'twin.txt' },
						{ type: 'text/plain', filename_disk: 'twin.txt' },
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "twin.txt" is already used by another file',
					}),
				);

				expect(ItemsService.prototype.createMany).not.toHaveBeenCalled();
			});

			it('creates a row for a file only the disk holds', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([]);

				await service.createMany([
					{ type: 'text/plain', filename_disk: 'stored.txt' },
				]);

				expect(ItemsService.prototype.createMany).toHaveBeenCalledWith(
					[{ type: 'text/plain', filename_disk: 'stored.txt' }],
					{},
				);
			});

			it('refuses an update naming a disk name another row holds', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([{ id: 'held-id', filename_disk: 'held.txt' }]);

				await expect(
					service.updateGroups([
						{ keys: ['own-id'], data: { filename_disk: 'held.txt' } },
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "held.txt" is already used by another file',
					}),
				);

				expect(ItemsService.prototype.updateGroups).not.toHaveBeenCalled();
			});

			it('refuses an update giving several rows one disk name', async () => {
				await expect(
					service.updateGroups([
						{ keys: ['first-id', 'second-id'], data: { filename_disk: 'twin.txt' } },
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "twin.txt" is already used by another file',
					}),
				);

				expect(ItemsService.prototype.updateGroups).not.toHaveBeenCalled();
			});

			it('updates a row keeping its own disk name', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([{ id: 'own-id', filename_disk: 'own.txt' }]);

				await service.updateGroups(
					[{ keys: ['own-id'], data: { filename_disk: 'own.txt', title: 'Own' } }],
					{},
				);

				expect(ItemsService.prototype.updateGroups).toHaveBeenCalledWith(
					[{ keys: ['own-id'], data: { filename_disk: 'own.txt', title: 'Own' } }],
					{},
				);
			});
		});

		describe('deleteMany', () => {
			it('deletes a file and its thumbnails, nothing else', async () => {
				const service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				const thumbnailHash = 'a'.repeat(40);

				const mockDriver: Partial<Driver> = {
					list: vi.fn(async function* (listedPrefix: string) {
						if (listedPrefix === 'photos/a') {
							yield* ['photos/a.jpg', 'photos/a1.jpg'];

							return;
						}

						yield* [
							'a.jpg',
							`a__${thumbnailHash}.webp`,
							`A__${thumbnailHash}.webp`,
							'a1b2c3.jpg',
							'A9f0e1.jpg',
							'albums/cover.jpg',
							'a__short.jpg',
						];
					}),
					delete: vi.fn(),
				};

				vi.mocked(getStorage).mockResolvedValue({
					location: vi.fn(() => mockDriver as Driver),
				} as Partial<StorageManager> as StorageManager);

				vi.spyOn(ItemsService.prototype, 'readMany').mockResolvedValue(withMeta(
					[
						{ id: 'root-id', storage: 'local', filename_disk: 'a.jpg' },
						{ id: 'folder-id', storage: 'local', filename_disk: 'photos/a.jpg' },
					],
					{ scopedCacheFingerprints: [] },
				));

				vi.spyOn(ItemsService.prototype, 'deleteMany').mockResolvedValue([]);

				await service.deleteMany(['root-id', 'folder-id']);

				expect(vi.mocked(mockDriver.delete!).mock.calls).toStrictEqual([
					['a.jpg'],
					[`a__${thumbnailHash}.webp`],
					['photos/a.jpg'],
					[`a__${thumbnailHash}.webp`],
				]);
			});
		});
	});
});
