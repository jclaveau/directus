import { useEnv } from '@directus/env';
import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import type { Knex } from 'knex';
import knex from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { oneLine } from '@directus/utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import { getHelpers } from '../database/helpers/index.js';
import emitter from '../emitter.js';
import {
	validateAccess,
} from '../permissions/modules/validate-access/validate-access.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import { getSchema } from '../utils/get-schema.js';
import { withMeta } from '../utils/read-meta.js';
import { shouldClearCache } from '../utils/should-clear-cache.js';
import { CollectionsService } from './collections.js';
import { FieldsService } from './fields.js';
import { ItemsService } from './items.js';

vi.mock('directus/version', () => ({ version: '0.0.0' }));

vi.mock('@directus/env', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@directus/env')>();

	return { ...actual, useEnv: vi.fn(actual.useEnv) };
});

vi.mock('../../src/database/index.js', () => {
	return {
		__esModule: true,
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../database/helpers/index.js', () => ({
	getHelpers: vi.fn().mockReturnValue({}),
}));

vi.mock('@directus/schema', () => ({
	createInspector: () => ({ tableInfo: async () => [] }),
}));

vi.mock('../cache.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../cache.js')>(),
		clearSystemCache: vi.fn(),
	};
});

vi.mock('../scoped-cache/index.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../scoped-cache/index.js')>(),
		flushResponseCache: vi.fn(),
	};
});

vi.mock('../utils/should-clear-cache.js', () => {
	return {
		shouldClearCache: vi.fn(() => false),
	};
});

vi.mock('../utils/get-schema.js', () => ({ getSchema: vi.fn() }));

const fetchAllowedCollections = vi.hoisted(() => vi.fn());

vi.mock(
	'../permissions/modules/fetch-allowed-collections/fetch-allowed-collections.js',
	() => ({ fetchAllowedCollections }),
);

vi.mock('../permissions/modules/validate-access/validate-access.js', () => {
	return {
		validateAccess: vi.fn(),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_collections', (c) => {
		c.field('collection').string()
.primary();
	})
	.build();

let db: Knex;
let tracker: Tracker;

beforeAll(() => {
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

const nonAdmin = { role: 'test', admin: false, user: 'test-user' } as Accountability;

describe('Services / Collections', () => {
	describe('createOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: nonAdmin,
			});

			await expect(service.createOne({ collection: 'x' } as any)).rejects.toThrowError(ForbiddenError);

			await expect(service.createOne({ collection: 'x' } as any)).rejects.toThrowError(
				`'test-user' can't create the collection 'x' as it's not an admin`,
			);
		});
	});

	describe('updateOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: nonAdmin,
			});

			await expect(service.updateOne('x', {})).rejects.toThrowError(ForbiddenError);

			await expect(service.updateOne('x', {})).rejects.toThrowError(
				`'test-user' does not have permission to update collections`,
			);
		});
	});

	describe('updateBatch', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: nonAdmin,
			});

			await expect(service.updateBatch([])).rejects.toThrowError(ForbiddenError);

			await expect(service.updateBatch([])).rejects.toThrowError(
				`'test-user' does not have permission to update collections`,
			);
		});
	});

	describe('updateMany', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: nonAdmin,
			});

			await expect(service.updateMany(['x'], {})).rejects.toThrowError(ForbiddenError);

			await expect(service.updateMany(['x'], {})).rejects.toThrowError(
				`'test-user' does not have permission to update collections`,
			);
		});
	});

	describe('deleteOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: nonAdmin,
			});

			await expect(service.deleteOne('x')).rejects.toThrowError(ForbiddenError);

			await expect(service.deleteOne('x')).rejects.toThrowError(
				`'test-user' does not have permission to delete collections`,
			);
		});

		it(oneLine`
			should throw ForbiddenError when the collection does not exist (admin)
		`, async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: {
					role: 'admin',
					admin: true,
					user: 'admin-user',
				} as Accountability,
			});

			vi.spyOn(CollectionsService.prototype, 'readByQuery').mockResolvedValue([]);

			await expect(service.deleteOne('missing')).rejects.toThrowError(ForbiddenError);
			await expect(service.deleteOne('missing')).rejects.toThrowError(`Collection to delete 'missing' does not exist`);
		});
	});

	describe('deleteMany', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: nonAdmin,
			});

			await expect(service.deleteMany(['x'])).rejects.toThrowError(ForbiddenError);
			await expect(service.deleteMany(['x'])).rejects.toThrowError(`'test-user' can't delete many collections`);
		});
	});

	describe('readByQuery', () => {
		it('merges the system collections into the meta rows', async () => {
			const readByQuery = vi
				.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta([], { scopedCacheFingerprints: [] }));

			const service = new CollectionsService({ knex: db, schema });
			const collections = await service.readByQuery();

			expect(readByQuery).toHaveBeenCalledWith({ limit: -1 });

			const names = collections.map(({ collection }) => collection);

			expect(names).toContain('directus_collections');
		});
	});

	describe('readOne', () => {
		it('should throw ForbiddenError when the collection is not found', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: nonAdmin,
			});

			vi.spyOn(CollectionsService.prototype, 'readMany').mockResolvedValue([]);

			await expect(service.readOne('missing')).rejects.toThrowError(ForbiddenError);
			await expect(service.readOne('missing')).rejects.toThrowError(`Collection 'missing' not found`);
		});
	});
});

const admin = { role: 'admin', admin: true, user: 'admin-user' } as Accountability;

describe('Services / Collections / createOne payload checks', () => {
	it.each([
		[{}, 'Invalid payload. "collection" is required.'],
		[
			{ collection: 42 },
			'Invalid payload. "collection" must be a non-empty string.',
		],
		[
			{ collection: '' },
			'Invalid payload. "collection" must be a non-empty string.',
		],
		[
			{ collection: 'directus_x' },
			'Invalid payload. Collections can\'t start with "directus_".',
		],
	])('refuses %j', async (payload, message) => {
		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		const creation = service.createOne(payload as any);

		await expect(creation).rejects.toThrowError(InvalidPayloadError);
		await expect(creation).rejects.toHaveProperty('message', message);
	});

	it(oneLine`
		refuses a collection the schema knows but directus_collections lacks
	`, async () => {
		tracker.on.select('directus_collections').response(undefined);

		const service = new CollectionsService({
			knex: db,
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
				})
				.build(),
			accountability: admin,
		});

		const creation = service.createOne({ collection: 'articles' } as any);

		await expect(creation).rejects.toThrowError(InvalidPayloadError);

		await expect(creation).rejects.toHaveProperty(
			'message',
			'Invalid payload. Collection "articles" already exists.',
		);
	});

	it('refuses fields that are not an array', async () => {
		tracker.on.select('directus_collections').response([]);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		const creation = service.createOne({
			collection: 'articles',
			schema: {},
			fields: { field: 'title' },
		} as any);

		await expect(creation).rejects.toThrowError(InvalidPayloadError);

		await expect(creation).rejects.toHaveProperty(
			'message',
			'Invalid payload. "fields" must be an array.',
		);
	});
});

describe('Services / Collections / createOne with a bare schema', () => {
	it('injects an auto-increment id when no field is sent', async () => {
		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);

		pgTracker.on.select('directus_collections').response([]);
		pgTracker.on.any('create table').response(undefined);

		vi.mocked(getHelpers).mockReturnValueOnce({
			date: { fieldFlagForField: vi.fn(() => '') },
		} as any);

		vi.spyOn(FieldsService.prototype, 'addColumnToTable').mockReturnValue(
			undefined as any,
		);

		const createManySpy = vi
			.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue([]);

		const service = new CollectionsService({
			knex: pgDatabase,
			schema,
			accountability: admin,
		});

		await service.createOne({ collection: 'articles', schema: {} } as any);

		expect(createManySpy).toHaveBeenCalledWith(
			[
				{
					collection: 'articles',
					field: 'id',
					hidden: true,
					interface: 'numeric',
					readonly: true,
					sort: 1,
				},
			],
			{ bypassEmitAction: expect.any(Function), bypassLimits: true },
		);
	});
});

describe('Services / Collections / createOne with a schema', () => {
	it('flags, sorts per group and records the fields', async () => {
		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);

		pgTracker.on.select('directus_collections').response([]);
		pgTracker.on.any('create table').response(undefined);

		vi.mocked(getHelpers).mockReturnValueOnce({
			date: {
				fieldFlagForField: vi.fn((type) => {
					return type === 'timestamp'
? 'cast-timestamp'
: '';
				}),
			},
		} as any);

		const addColumnSpy = vi
			.spyOn(FieldsService.prototype, 'addColumnToTable')
			.mockReturnValue(undefined as any);

		const createManySpy = vi
			.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue([]);

		const service = new CollectionsService({
			knex: pgDatabase,
			schema,
			accountability: admin,
		});

		const createdName = await service.createOne({
			collection: 'articles',
			schema: {},
			meta: null,
			fields: [
				{ field: 'uuid', type: 'uuid', schema: { is_primary_key: true } },
				{ field: 'published_on', type: 'timestamp', meta: { hidden: false } },
				{ field: 'details', type: 'alias', meta: { special: ['group'] } },
				{ field: 'title', type: 'string', meta: { group: 'details' } },
				{ field: 'summary', type: 'text', meta: { group: 'details', sort: 9 } },
			],
		} as any);

		expect(createdName).toBe('articles');
		expect(addColumnSpy).toHaveBeenCalledTimes(4);

		expect(createManySpy).toHaveBeenCalledWith(
			[
				{
					collection: 'articles',
					field: 'published_on',
					hidden: false,
					special: ['cast-timestamp'],
					sort: 1,
				},
				{ collection: 'articles', field: 'details', special: ['group'], sort: 2 },
				{ collection: 'articles', field: 'title', group: 'details', sort: 1 },
				{ collection: 'articles', field: 'summary', group: 'details', sort: 9 },
			],
			{ bypassEmitAction: expect.any(Function), bypassLimits: true },
		);
	});
});

describe('Services / Collections / createMany', () => {
	it('creates each collection in one transaction and flushes once', async () => {
		vi.mocked(shouldClearCache).mockReturnValueOnce(true);

		const createOneSpy = vi
			.spyOn(CollectionsService.prototype, 'createOne')
			.mockResolvedValueOnce('articles')
			.mockResolvedValueOnce('authors');

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		const createdNames = await service.createMany(
			[{ collection: 'articles' }, { collection: 'authors' }] as any,
			{ autoPurgeSystemCache: false },
		);

		expect(createdNames).toEqual(['articles', 'authors']);

		expect(createOneSpy).toHaveBeenCalledWith(
			{ collection: 'articles' },
			{
				autoPurgeCache: false,
				autoPurgeSystemCache: false,
				bypassEmitAction: expect.any(Function),
			},
		);

		expect(createOneSpy).toHaveBeenCalledWith(
			{ collection: 'authors' },
			{
				autoPurgeCache: false,
				autoPurgeSystemCache: false,
				bypassEmitAction: expect.any(Function),
			},
		);

		expect(flushResponseCache).toHaveBeenCalledTimes(1);
		expect(clearSystemCache).not.toHaveBeenCalled();
	});
});

describe('Services / Collections / createMany defaults', () => {
	it('clears the system cache and keeps the response cache', async () => {
		vi.spyOn(CollectionsService.prototype, 'createOne')
			.mockResolvedValue('articles');

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		expect(await service.createMany([{ collection: 'articles' }] as any)).toEqual([
			'articles',
		]);

		expect(flushResponseCache).not.toHaveBeenCalled();
		expect(clearSystemCache).toHaveBeenCalledWith({ autoPurgeCache: undefined });
	});
});

describe('Services / Collections / readByQuery', () => {
	it('lets a non-admin read the group of a collection it may read', async () => {
		vi.spyOn(ItemsService.prototype, 'readByQuery').mockResolvedValue([
			{ collection: 'articles', group: 'blog' },
			{ collection: 'blog', group: null },
			{ collection: 'drafts', group: 'blog' },
		] as any);

		vi.mocked(fetchAllowedCollections).mockResolvedValueOnce(['articles']);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: nonAdmin,
		});

		expect(await service.readByQuery()).toEqual([
			{
				collection: 'articles',
				meta: { collection: 'articles', group: 'blog' },
				schema: null,
			},
			{
				collection: 'blog',
				meta: { collection: 'blog', group: null },
				schema: null,
			},
		]);
	});

	it('keeps every collection when DB_EXCLUDE_TABLES is unset', async () => {
		vi.spyOn(ItemsService.prototype, 'readByQuery').mockResolvedValue([
			{ collection: 'articles' },
		] as any);

		vi.mocked(fetchAllowedCollections).mockResolvedValueOnce(['articles']);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: nonAdmin,
		});

		vi.mocked(useEnv).mockReturnValueOnce({});

		expect(await service.readByQuery()).toEqual([
			{ collection: 'articles', meta: { collection: 'articles' }, schema: null },
		]);
	});
});

describe('Services / Collections / readMany', () => {
	it('checks read access to every requested collection', async () => {
		vi.spyOn(CollectionsService.prototype, 'readByQuery').mockResolvedValue([
			{ collection: 'articles', meta: null, schema: null },
			{ collection: 'authors', meta: null, schema: null },
		] as any);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: nonAdmin,
		});

		expect(await service.readMany(['articles'])).toEqual([
			{ collection: 'articles', meta: null, schema: null },
		]);

		expect(validateAccess).toHaveBeenCalledWith(
			{
				accountability: nonAdmin,
				action: 'read',
				collection: 'articles',
				skipCollectionExistsCheck: true,
			},
			{ schema, knex: db },
		);
	});

	it('skips the access check without an accountability', async () => {
		vi.spyOn(CollectionsService.prototype, 'readByQuery').mockResolvedValue([
			{ collection: 'articles', meta: null, schema: null },
		] as any);

		const service = new CollectionsService({ knex: db, schema });

		expect(await service.readMany(['articles'])).toEqual([
			{ collection: 'articles', meta: null, schema: null },
		]);

		expect(validateAccess).not.toHaveBeenCalled();
	});
});

describe('Services / Collections / updateOne', () => {
	it('returns the key untouched when there is no meta to write', async () => {
		const updateOneSpy = vi.spyOn(ItemsService.prototype, 'updateOne');

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		expect(await service.updateOne('articles', { schema: null } as any)).toBe(
			'articles',
		);

		expect(updateOneSpy).not.toHaveBeenCalled();
	});

	it('creates the meta row of a collection that has none', async () => {
		tracker.on.select('directus_collections').response(undefined);

		const createOneSpy = vi
			.spyOn(ItemsService.prototype, 'createOne')
			.mockImplementation(async (_data, opts) => {
				opts!.bypassEmitAction!({ event: 'collections.create' } as any);
				return 'articles';
			});

		const bypassEmitAction = vi.fn();

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		expect(
			await service.updateOne(
				'articles',
				{ meta: { note: 'Blog posts' } } as any,
				{ bypassEmitAction },
			),
		).toBe('articles');

		expect(createOneSpy).toHaveBeenCalledWith(
			{ note: 'Blog posts', collection: 'articles' },
			{ bypassEmitAction: expect.any(Function) },
		);

		expect(bypassEmitAction).toHaveBeenCalledWith({
			event: 'collections.create',
		});
	});
});

describe('Services / Collections / updateOne events', () => {
	it('emits the nested create events itself without a caller', async () => {
		tracker.on.select('directus_collections').response(undefined);
		vi.mocked(getSchema).mockResolvedValueOnce({ collections: {} } as any);

		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		vi.spyOn(ItemsService.prototype, 'createOne').mockImplementation(
			async (_data, opts) => {
				opts!.bypassEmitAction!({
					event: 'collections.create',
					meta: { key: 'articles' },
					context: { schema: null },
				} as any);

				return 'articles';
			},
		);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		await service.updateOne('articles', { meta: { note: 'Blog posts' } } as any);

		expect(emitActionSpy).toHaveBeenCalledWith(
			'collections.create',
			{ key: 'articles' },
			{ schema: { collections: {} } },
		);
	});
});

describe('Services / Collections / updateBatch', () => {
	it('refuses a payload that is not an array', async () => {
		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		const update = service.updateBatch({ collection: 'articles' } as any);

		await expect(update).rejects.toThrowError(InvalidPayloadError);

		await expect(update).rejects.toHaveProperty(
			'message',
			'Invalid payload. Input should be an array of collection changes.',
		);
	});

	it('refuses a change that misses its collection key', async () => {
		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		const update = service.updateBatch([{ meta: { note: 'Blog posts' } } as any]);

		await expect(update).rejects.toThrowError(InvalidPayloadError);

		await expect(update).rejects.toHaveProperty(
			'message',
			'Invalid payload. Collection in update misses collection key.',
		);
	});

	it('hands each nested event to the caller', async () => {
		vi.mocked(shouldClearCache).mockReturnValueOnce(true);

		const updateOneSpy = vi
			.spyOn(CollectionsService.prototype, 'updateOne')
			.mockImplementation(async (collectionKey, _data, opts) => {
				opts!.bypassEmitAction!({ event: 'collections.update' } as any);
				return collectionKey;
			});

		const bypassEmitAction = vi.fn();

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		expect(
			await service.updateBatch(
				[{ collection: 'articles', meta: { note: 'Blog posts' } }] as any,
				{ bypassEmitAction, autoPurgeSystemCache: false },
			),
		).toEqual(['articles']);

		expect(updateOneSpy).toHaveBeenCalledWith(
			'articles',
			{ meta: { note: 'Blog posts' } },
			{
				autoPurgeCache: false,
				autoPurgeSystemCache: false,
				bypassEmitAction: expect.any(Function),
			},
		);

		expect(bypassEmitAction).toHaveBeenCalledWith({ event: 'collections.update' });
		expect(flushResponseCache).toHaveBeenCalledTimes(1);
		expect(clearSystemCache).not.toHaveBeenCalled();
	});

	it('emits the nested events against the refreshed schema', async () => {
		vi.mocked(getSchema).mockResolvedValueOnce({ collections: {} } as any);

		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		vi.spyOn(CollectionsService.prototype, 'updateOne').mockImplementation(
			async (collectionKey, _data, opts) => {
				opts!.bypassEmitAction!({
					event: 'collections.update',
					meta: { keys: ['articles'] },
					context: { schema: null },
				} as any);

				return collectionKey;
			},
		);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		await service.updateBatch([{ collection: 'articles', meta: {} }] as any);

		expect(emitActionSpy).toHaveBeenCalledWith(
			'collections.update',
			{ keys: ['articles'] },
			{ schema: { collections: {} } },
		);
	});

	it('skips the emit when the caller turns events off', async () => {
		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		vi.spyOn(CollectionsService.prototype, 'updateOne').mockImplementation(
			async (collectionKey, _data, opts) => {
				opts!.bypassEmitAction!({ event: 'collections.update' } as any);
				return collectionKey;
			},
		);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		await service.updateBatch([{ collection: 'articles', meta: {} }] as any, {
			emitEvents: false,
		});

		expect(emitActionSpy).not.toHaveBeenCalled();
	});
});

describe('Services / Collections / updateMany', () => {
	it('updates every key with the same data, then emits once', async () => {
		vi.mocked(shouldClearCache).mockReturnValueOnce(true);
		vi.mocked(getSchema).mockResolvedValueOnce({ collections: {} } as any);

		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		const updateOneSpy = vi
			.spyOn(CollectionsService.prototype, 'updateOne')
			.mockImplementation(async (collectionKey, _data, opts) => {
				opts!.bypassEmitAction!({
					event: 'collections.update',
					meta: { keys: [collectionKey] },
					context: { schema: null },
				} as any);

				return collectionKey;
			});

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		expect(
			await service.updateMany(['articles', 'authors'], {
				meta: { hidden: true },
			} as any),
		).toEqual(['articles', 'authors']);

		expect(updateOneSpy).toHaveBeenCalledWith(
			'articles',
			{ meta: { hidden: true } },
			{
				autoPurgeCache: false,
				autoPurgeSystemCache: false,
				bypassEmitAction: expect.any(Function),
			},
		);

		expect(updateOneSpy).toHaveBeenCalledWith(
			'authors',
			{ meta: { hidden: true } },
			{
				autoPurgeCache: false,
				autoPurgeSystemCache: false,
				bypassEmitAction: expect.any(Function),
			},
		);

		expect(flushResponseCache).toHaveBeenCalledTimes(1);
		expect(clearSystemCache).toHaveBeenCalledWith({ autoPurgeCache: undefined });

		expect(emitActionSpy).toHaveBeenCalledWith(
			'collections.update',
			{ keys: ['articles'] },
			{ schema: { collections: {} } },
		);

		expect(emitActionSpy).toHaveBeenCalledWith(
			'collections.update',
			{ keys: ['authors'] },
			{ schema: { collections: {} } },
		);
	});

	it('leaves the caches and events alone when told to', async () => {
		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		vi.spyOn(CollectionsService.prototype, 'updateOne').mockImplementation(
			async (collectionKey, _data, opts) => {
				opts!.bypassEmitAction!({ event: 'collections.update' } as any);
				return collectionKey;
			},
		);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		await service.updateMany(['articles'], { meta: {} } as any, {
			autoPurgeSystemCache: false,
			emitEvents: false,
		});

		expect(flushResponseCache).not.toHaveBeenCalled();
		expect(clearSystemCache).not.toHaveBeenCalled();
		expect(emitActionSpy).not.toHaveBeenCalled();
	});
});

describe('Services / Collections / deleteMany', () => {
	it('deletes every key, then emits once', async () => {
		vi.mocked(shouldClearCache).mockReturnValueOnce(true);
		vi.mocked(getSchema).mockResolvedValueOnce({ collections: {} } as any);

		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		const deleteOneSpy = vi
			.spyOn(CollectionsService.prototype, 'deleteOne')
			.mockImplementation(async (collectionKey, opts) => {
				opts!.bypassEmitAction!({
					event: 'collections.delete',
					meta: { keys: [collectionKey] },
					context: { schema: null },
				} as any);

				return collectionKey;
			});

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		expect(await service.deleteMany(['articles', 'authors'])).toEqual([
			'articles',
			'authors',
		]);

		expect(deleteOneSpy).toHaveBeenCalledWith('articles', {
			autoPurgeCache: false,
			autoPurgeSystemCache: false,
			bypassEmitAction: expect.any(Function),
		});

		expect(deleteOneSpy).toHaveBeenCalledWith('authors', {
			autoPurgeCache: false,
			autoPurgeSystemCache: false,
			bypassEmitAction: expect.any(Function),
		});

		expect(flushResponseCache).toHaveBeenCalledTimes(1);
		expect(clearSystemCache).toHaveBeenCalledWith({ autoPurgeCache: undefined });

		expect(emitActionSpy).toHaveBeenCalledWith(
			'collections.delete',
			{ keys: ['articles'] },
			{ schema: { collections: {} } },
		);

		expect(emitActionSpy).toHaveBeenCalledWith(
			'collections.delete',
			{ keys: ['authors'] },
			{ schema: { collections: {} } },
		);
	});

	it('leaves the caches and events alone when told to', async () => {
		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		vi.spyOn(CollectionsService.prototype, 'deleteOne').mockImplementation(
			async (collectionKey, opts) => {
				opts!.bypassEmitAction!({ event: 'collections.delete' } as any);
				return collectionKey;
			},
		);

		const service = new CollectionsService({
			knex: db,
			schema,
			accountability: admin,
		});

		await service.deleteMany(['articles'], {
			autoPurgeSystemCache: false,
			emitEvents: false,
		});

		expect(flushResponseCache).not.toHaveBeenCalled();
		expect(clearSystemCache).not.toHaveBeenCalled();
		expect(emitActionSpy).not.toHaveBeenCalled();
	});
});

describe('Services / Collections / deleteOne', () => {
	it(oneLine`
		detaches the relations and duplication paths of the dropped table
	`, async () => {
		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);

		pgTracker.on.any('drop table').response(undefined);
		pgTracker.on.select('directus_revisions').response([]);

		pgTracker.on.select('directus_collections').response([
			{ collection: 'authors', item_duplication_fields: ['articles.title'] },
		]);

		pgTracker.on.update('directus_collections').response(1);
		pgTracker.on.update('directus_relations').response(1);
		pgTracker.on.delete(() => true).response(1);

		vi.spyOn(CollectionsService.prototype, 'readByQuery').mockResolvedValue([
			{
				collection: 'articles',
				meta: { collection: 'articles' },
				schema: { name: 'articles' },
			},
		] as any);

		const deleteOneSpy = vi
			.spyOn(ItemsService.prototype, 'deleteOne')
			.mockResolvedValue('articles');

		vi.spyOn(ItemsService.prototype, 'deleteByQuery').mockResolvedValue([]);

		const deleteFieldSpy = vi
			.spyOn(FieldsService.prototype, 'deleteField')
			.mockImplementation(async (_collection, _field, opts) => {
				opts!.bypassEmitAction!({ event: 'fields.delete' } as any);
			});

		const bypassEmitAction = vi.fn();

		const service = new CollectionsService({
			knex: pgDatabase,
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('title').string();
					c.field('author').m2o('authors', 'articles');
				})
				.collection('comments', (c) => {
					c.field('id').id();
					c.field('article').m2o('articles');
					c.field('item').m2a(['articles', 'pages']);
				})
				.build(),
			accountability: admin,
		});

		expect(await service.deleteOne('articles', { bypassEmitAction })).toBe(
			'articles',
		);

		expect(deleteOneSpy).toHaveBeenCalledWith('articles', {
			bypassEmitAction: expect.any(Function),
		});

		expect(deleteFieldSpy).toHaveBeenCalledWith('authors', 'articles', {
			autoPurgeCache: false,
			autoPurgeSystemCache: false,
			bypassEmitAction: expect.any(Function),
		});

		expect(deleteFieldSpy).toHaveBeenCalledWith('comments', 'article', {
			autoPurgeCache: false,
			autoPurgeSystemCache: false,
			bypassEmitAction: expect.any(Function),
		});

		expect(pgTracker.history.update).toMatchObject([
			{
				sql: 'update "directus_collections" set "group" = $1 where "group" = $2',
				bindings: [null, 'articles'],
			},
			{
				sql: oneLine`
					update "directus_collections" set "item_duplication_fields" = $1
					where "collection" = $2
				`,
				bindings: [null, 'authors'],
			},
			{
				sql: oneLine`
					update "directus_relations" set "one_allowed_collections" = $1
					where "id" = $2
				`,
				bindings: ['pages', 0],
			},
		]);

		expect(bypassEmitAction).toHaveBeenCalledWith({ event: 'fields.delete' });
	});
});

describe('Services / Collections / deleteOne of a table without meta', () => {
	it('drops a table the schema snapshot does not know yet', async () => {
		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);

		pgTracker.on.any('drop table').response(undefined);
		pgTracker.on.select('directus_revisions').response([]);
		pgTracker.on.select('directus_collections').response([]);
		pgTracker.on.update('directus_collections').response(1);
		pgTracker.on.delete(() => true).response(1);

		vi.spyOn(CollectionsService.prototype, 'readByQuery').mockResolvedValue([
			{ collection: 'legacy', meta: null, schema: { name: 'legacy' } },
		] as any);

		const deleteOneSpy = vi.spyOn(ItemsService.prototype, 'deleteOne');
		vi.spyOn(ItemsService.prototype, 'deleteByQuery').mockResolvedValue([]);
		vi.mocked(getSchema).mockResolvedValueOnce({ collections: {} } as any);

		const emitActionSpy = vi
			.spyOn(emitter, 'emitAction')
			.mockResolvedValue(undefined);

		vi.spyOn(FieldsService.prototype, 'deleteField').mockImplementation(
			async (collection, field, opts) => {
				opts!.bypassEmitAction!({
					event: 'fields.delete',
					meta: { collection, payload: [field] },
					context: { schema: null },
				} as any);
			},
		);

		const service = new CollectionsService({
			knex: pgDatabase,
			schema: {
				collections: {},
				relations: [
					{
						collection: 'notes',
						field: 'legacy',
						related_collection: 'legacy',
						schema: null,
						meta: { id: 1, one_field: 'notes' },
					},
				],
			} as any,
			accountability: admin,
		});

		expect(await service.deleteOne('legacy')).toBe('legacy');
		expect(deleteOneSpy).not.toHaveBeenCalled();

		expect(pgTracker.history.update).toMatchObject([
			{
				sql: 'update "directus_collections" set "group" = $1 where "group" = $2',
				bindings: [null, 'legacy'],
			},
		]);

		expect(emitActionSpy).toHaveBeenCalledWith(
			'fields.delete',
			{ collection: 'legacy', payload: ['notes'] },
			{ schema: { collections: {} } },
		);

		expect(emitActionSpy).toHaveBeenCalledWith(
			'fields.delete',
			{ collection: 'notes', payload: ['legacy'] },
			{ schema: { collections: {} } },
		);
	});
});
