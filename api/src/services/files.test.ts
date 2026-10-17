import { InvalidPayloadError, RecordNotUniqueError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { Driver, StorageManager } from '@directus/storage';
import type { File } from '@directus/types';
import { oneLine } from '@directus/utils';
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
import emitter from '../emitter.js';
import { getStorage } from '../storage/index.js';
import { withMeta } from '../utils/read-meta.js';
import { FilesService, ItemsService } from './index.js';

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: () => 'postgres',
	};
});

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
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	describe('Services / Files', () => {
		describe('a disk name the unique index refuses', () => {
			it('refuses a created row with the guard reason', async () => {
				vi.spyOn(ItemsService.prototype, 'createMany')
					.mockRejectedValue(new RecordNotUniqueError({
						collection: 'directus_files',
						field: 'filename_disk',
						value: 'taken.txt',
					}));

				const service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				await expect(service.createMany([
					{ type: 'text/plain', filename_disk: 'taken.txt' },
				])).rejects.toStrictEqual(new InvalidPayloadError({
					reason: '"filename_disk" "taken.txt" is already used by another file',
				}));
			});

			it('refuses a batch insert naming no disk name', async () => {
				vi.spyOn(ItemsService.prototype, 'createMany')
					.mockRejectedValue(new RecordNotUniqueError({
						collection: 'directus_files',
						field: 'filename_disk',
						value: null,
					}));

				const service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				await expect(service.createMany([
					{ type: 'text/plain', filename_disk: 'one.txt' },
					{ type: 'text/plain', filename_disk: 'two.txt' },
				])).rejects.toStrictEqual(new InvalidPayloadError({
					reason: '"filename_disk" is already used by another file',
				}));
			});

			it('refuses an updated row with the guard reason', async () => {
				vi.spyOn(ItemsService.prototype, 'updateGroups')
					.mockRejectedValue(new RecordNotUniqueError({
						collection: 'directus_files',
						field: 'filename_disk',
						value: 'taken.txt',
					}));

				const service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				await expect(service.updateGroups([
					{ keys: ['file-1'], data: { filename_disk: 'taken.txt' } },
				])).rejects.toStrictEqual(new InvalidPayloadError({
					reason: '"filename_disk" "taken.txt" is already used by another file',
				}));
			});

			it('keeps a unique error on another field', async () => {
				const uniqueError = new RecordNotUniqueError({
					collection: 'directus_files',
					field: 'title',
					value: 'Same title',
				});

				vi.spyOn(ItemsService.prototype, 'updateGroups')
					.mockRejectedValue(uniqueError);

				const service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				await expect(service.updateGroups([
					{ keys: ['file-1'], data: { title: 'Same title' } },
				])).rejects.toBe(uniqueError);
			});
		});

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

			it('refuses a filename_disk that is not a normalised path', async () => {
				tracker.on
					.select('from "directus_files" where "id" = ?')
					.response(null);

				await expect(
					service.uploadOne(new PassThrough(), {
						storage: 'local',
						type: 'text/plain',
						filename_download: 'notes.txt',
						filename_disk: 'up/../notes.txt',
					}),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: oneLine`
							"filename_disk" "up/../notes.txt" must be a relative path
							without empty, "." or ".." segments
						`,
					}),
				);

				expect(mockDriver.exists).not.toHaveBeenCalled();
				expect(superCreateOne).not.toHaveBeenCalled();
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
					schema: new SchemaBuilder()
						.collection('directus_files', (collection) => {
							collection.field('id').uuid()
								.primary();

							collection.field('type').string();
							collection.field('title').string();
							collection.field('filename_disk').string();
						})
						.build(),
				});
			});

			it('refuses a created row naming a disk name another row holds', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000002',
							filename_disk: 'held.txt',
						}]);

				await expect(
					service.createMany([{ type: 'text/plain', filename_disk: 'held.txt' }]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "held.txt" is already used by another file',
					}),
				);

				expect(tracker.history.insert).toStrictEqual([]);
			});

			it('refuses a held disk name a create filter hook claims', async () => {
				vi.spyOn(emitter, 'emitFilter').mockResolvedValue([
					{ data: { type: 'text/plain', filename_disk: 'held.txt' } },
				]);

				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000002',
							filename_disk: 'held.txt',
						}]);

				tracker.on.insert('directus_files').response([
					{ id: '8e2b4c10-5d3a-4f6e-9a7b-000000000001' },
				]);

				await expect(
					service.createMany([{ type: 'text/plain' }]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "held.txt" is already used by another file',
					}),
				);

				expect(tracker.history.insert).toStrictEqual([]);
			});

			it('refuses a created row whose disk name is rooted', async () => {
				await expect(
					service.createMany([
						{ type: 'text/plain', filename_disk: '/rooted.txt' },
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: oneLine`
							"filename_disk" "/rooted.txt" must be a relative path
							without empty, "." or ".." segments
						`,
					}),
				);

				expect(tracker.history.select).toStrictEqual([]);
				expect(tracker.history.insert).toStrictEqual([]);
			});

			it('refuses an update to a disk name with a dot segment', async () => {
				await expect(
					service.updateGroups([
						{
							keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000001'],
							data: { filename_disk: 'folder/./dotted.txt' },
						},
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: oneLine`
							"filename_disk" "folder/./dotted.txt" must be a relative path
							without empty, "." or ".." segments
						`,
					}),
				);

				expect(tracker.history.update).toStrictEqual([]);
			});

			it('creates a row whose disk name sits in a folder', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([]);

				tracker.on.insert('directus_files').response([
					{ id: '8e2b4c10-5d3a-4f6e-9a7b-000000000005' },
				]);

				await expect(
					service.createMany([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000005',
							type: 'text/plain',
							filename_disk: 'folder/stored.txt',
						},
					]),
				).resolves.toStrictEqual(['8e2b4c10-5d3a-4f6e-9a7b-000000000005']);
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

				expect(tracker.history.insert).toStrictEqual([]);
			});

			it('creates a row for a file only the disk holds', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([]);

				tracker.on.insert('directus_files').response([
					{
						id: '8e2b4c10-5d3a-4f6e-9a7b-000000000005',
					}]);

				await expect(
					service.createMany([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000005',
							type: 'text/plain',
							filename_disk: 'stored.txt',
						},
					]),
				).resolves.toStrictEqual(['8e2b4c10-5d3a-4f6e-9a7b-000000000005']);
			});

			it('refuses an update naming a disk name another row holds', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000002',
							filename_disk: 'held.txt',
						}]);

				await expect(
					service.updateGroups([
						{
							keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000001'],
							data: { filename_disk: 'held.txt' },
						},
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "held.txt" is already used by another file',
					}),
				);

				expect(tracker.history.update).toStrictEqual([]);
			});

			it('refuses a held disk name an update filter hook claims', async () => {
				vi.spyOn(emitter, 'emitFilter').mockResolvedValue([
					{
						keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000001'],
						data: { filename_disk: 'held.txt' },
					},
				]);

				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000002',
							filename_disk: 'held.txt',
						}]);

				tracker.on.update('directus_files').response(1);

				await expect(
					service.updateGroups([
						{
							keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000001'],
							data: { title: 'Own' },
						},
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "held.txt" is already used by another file',
					}),
				);

				expect(tracker.history.update).toStrictEqual([]);
			});

			it('refuses an update giving several rows one disk name', async () => {
				await expect(
					service.updateGroups([
						{
							keys: [
								'8e2b4c10-5d3a-4f6e-9a7b-000000000003',
								'8e2b4c10-5d3a-4f6e-9a7b-000000000004',
							],
							data: { filename_disk: 'twin.txt' },
						},
					]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: '"filename_disk" "twin.txt" is already used by another file',
					}),
				);

				expect(tracker.history.update).toStrictEqual([]);
			});

			it('updates a row keeping its own disk name', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000001',
							filename_disk: 'own.txt',
						}]);

				tracker.on.update('directus_files').response(1);

				await expect(
					service.updateGroups(
						[
							{
								keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000001'],
								data: { filename_disk: 'own.txt', title: 'Own' },
							},
						],
					),
				).resolves.toStrictEqual(['8e2b4c10-5d3a-4f6e-9a7b-000000000001']);
			});

			it('updates a row keeping its disk name under an uppercase key', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([{
						id: '8e2b4c10-5d3a-4f6e-9a7b-00000000000a',
						filename_disk: 'own.txt',
					}]);

				tracker.on.update('directus_files').response(1);

				await expect(
					service.updateGroups([{
						keys: ['8E2B4C10-5D3A-4F6E-9A7B-00000000000A'],
						data: { filename_disk: 'own.txt' },
					}]),
				).resolves.toStrictEqual(['8E2B4C10-5D3A-4F6E-9A7B-00000000000A']);
			});

			it('refuses an update group holding no data object', async () => {
				await expect(
					service.updateGroups([{
						keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000001'],
						data: null as unknown as Partial<File>,
					}]),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: 'Each update group needs a "data" object',
					}),
				);
			});

			it('writes a disk name to a row one group names twice', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([]);

				tracker.on.update('directus_files').response(1);

				await expect(
					service.updateGroups([{
						keys: [
							'8e2b4c10-5d3a-4f6e-9a7b-000000000001',
							'8e2b4c10-5d3a-4f6e-9a7b-000000000001',
						],
						data: { filename_disk: 'renamed.txt' },
					}]),
				).resolves.toStrictEqual([
					'8e2b4c10-5d3a-4f6e-9a7b-000000000001',
					'8e2b4c10-5d3a-4f6e-9a7b-000000000001',
				]);
			});

			it('refuses two last-winning groups naming one row a disk name', async () => {
				await expect(
					service.updateGroups(
						[
							{
								keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000003'],
								data: { filename_disk: 'moved.txt' },
							},
							{
								keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000003'],
								data: { filename_disk: 'kept.txt' },
							},
						],
						{ onRepeatedPk: 'lastWins' },
					),
				).rejects.toStrictEqual(
					new InvalidPayloadError({
						reason: oneLine`
							Row 8e2b4c10-5d3a-4f6e-9a7b-000000000003 is sent more than
							once; send each row once
						`,
					}),
				);
			});

			it('lets last-winning groups name a row one disk name', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([]);

				tracker.on.update('directus_files').response(1);

				await expect(
					service.updateGroups(
						[
							{
								keys: [
									'8e2b4c10-5d3a-4f6e-9a7b-000000000003',
									'8e2b4c10-5d3a-4f6e-9a7b-000000000003',
								],
								data: { filename_disk: 'moved.txt' },
							},
							{
								keys: ['8e2b4c10-5d3a-4f6e-9a7b-000000000003'],
								data: { title: 'Moved' },
							},
						],
						{ onRepeatedPk: 'lastWins' },
					),
				).resolves.toStrictEqual([
					'8e2b4c10-5d3a-4f6e-9a7b-000000000003',
					'8e2b4c10-5d3a-4f6e-9a7b-000000000003',
					'8e2b4c10-5d3a-4f6e-9a7b-000000000003',
				]);
			});

			it('judges no disk name for an update naming no row', async () => {
				tracker.on
					.select('select "id", "filename_disk" from "directus_files"')
					.response([
						{
							id: '8e2b4c10-5d3a-4f6e-9a7b-000000000002',
							filename_disk: 'held.txt',
						}]);

				await expect(
					service.updateGroups([
						{ keys: [], data: { filename_disk: 'held.txt' } },
					]),
				).resolves.toStrictEqual([]);
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

			it('deletes a file a rooted bucket lists with a leading slash', async () => {
				const service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				const thumbnailHash = 'c'.repeat(40);

				const mockDriver: Partial<Driver> = {
					list: vi.fn(async function* (listedPrefix: string) {
						if (listedPrefix === 'photos/a') {
							yield* ['/photos/a.jpg', '/photos/a1.jpg'];

							return;
						}

						yield* ['/a.jpg', `/a__${thumbnailHash}.webp`, '/a1.jpg'];
					}),
					delete: vi.fn(),
				};

				vi.mocked(getStorage).mockResolvedValue({
					location: vi.fn(() => mockDriver as Driver),
				} as Partial<StorageManager> as StorageManager);

				vi.spyOn(ItemsService.prototype, 'readMany').mockResolvedValue(withMeta(
					[
						{ id: 'root-id', storage: 's3', filename_disk: 'a.jpg' },
						{ id: 'folder-id', storage: 's3', filename_disk: 'photos/a.jpg' },
					],
					{ scopedCacheFingerprints: [] },
				));

				vi.spyOn(ItemsService.prototype, 'deleteMany').mockResolvedValue([]);

				await service.deleteMany(['root-id', 'folder-id']);

				expect(vi.mocked(mockDriver.delete!).mock.calls).toStrictEqual([
					['/a.jpg'],
					[`/a__${thumbnailHash}.webp`],
					['/photos/a.jpg'],
					[`/a__${thumbnailHash}.webp`],
				]);
			});

			it('deletes the thumbnails of a file whose folder is gone', async () => {
				const service = new FilesService({
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				const thumbnailHash = 'b'.repeat(40);

				const mockDriver: Partial<Driver> = {
					list: vi.fn(async function* (listedPrefix: string) {
						if (listedPrefix === 'gone/x') {
							throw Object.assign(
								new Error('ENOENT: no such file or directory, opendir'),
								{ code: 'ENOENT' },
							);
						}

						yield* [`x__${thumbnailHash}.webp`];
					}),
					delete: vi.fn(),
				};

				vi.mocked(getStorage).mockResolvedValue({
					location: vi.fn(() => mockDriver as Driver),
				} as Partial<StorageManager> as StorageManager);

				vi.spyOn(ItemsService.prototype, 'readMany').mockResolvedValue(withMeta(
					[{ id: 'gone-id', storage: 'local', filename_disk: 'gone/x.jpg' }],
					{ scopedCacheFingerprints: [] },
				));

				vi.spyOn(ItemsService.prototype, 'deleteMany').mockResolvedValue([]);

				await expect(service.deleteMany(['gone-id']))
					.resolves.toStrictEqual(['gone-id']);

				expect(vi.mocked(mockDriver.delete!).mock.calls).toStrictEqual([
					[`x__${thumbnailHash}.webp`],
				]);
			});
		});
	});
});
