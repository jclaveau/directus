import {
	ForbiddenError,
	InvalidPayloadError,
	UnprocessableContentError,
} from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	validateAccess,
} from '../permissions/modules/validate-access/validate-access.js';
import { purgeScopedCache } from '../scoped-cache/index.js';
import { withMeta } from '../utils/read-meta.js';
import { shouldClearCache } from '../utils/should-clear-cache.js';
import { ItemsService } from './items.js';
import { PayloadService } from './payload.js';
import { VersionsService } from './versions.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../permissions/modules/validate-access/validate-access.js', () => {
	return {
		validateAccess: vi.fn(),
	};
});

vi.mock('../utils/should-clear-cache.js', () => {
	return {
		shouldClearCache: vi.fn(),
	};
});

vi.mock('../scoped-cache/index.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../scoped-cache/index.js')>(),
		purgeScopedCache: vi.fn(),
	};
});

const { readCollection } = vi.hoisted(() => {
	return { readCollection: vi.fn() };
});

vi.mock('./collections.js', () => {
	return {
		CollectionsService: vi.fn(function () {
			return { readOne: readCollection };
		}),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_versions', (c) => {
		c.field('id').id();
	})
	.build();

let db: Knex;

beforeAll(() => {
	db = knex.default({ client: MockClient });
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(validateAccess).mockReset();
	vi.mocked(shouldClearCache).mockReset();
	vi.mocked(purgeScopedCache).mockReset();
	readCollection.mockReset();
});

describe('Services / Versions', () => {
	describe('createOne', () => {
		it('creates a version stamped with the main item hash', async () => {
			readCollection.mockResolvedValue({ meta: { versioning: true } });

			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ count: 0 }],
					{ scopedCacheFingerprints: [] },
				));

			const readOne = vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{ id: 1, title: 'Hello' },
					{ scopedCacheFingerprints: [] },
				));

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['version-id-1']);

			const service = new VersionsService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			});

			await expect(service.createOne({
				key: 'draft',
				collection: 'articles',
				item: '1',
			})).resolves.toBe('version-id-1');

			expect(validateAccess).toHaveBeenCalledWith(
				{
					accountability: { user: 'user-1' },
					action: 'read',
					collection: 'articles',
					primaryKeys: ['1'],
				},
				{ schema, knex: db },
			);

			expect(readOne).toHaveBeenCalledWith('1', undefined);

			expect(createMany).toHaveBeenCalledWith(
				[
					{
						key: 'draft',
						collection: 'articles',
						item: '1',
						hash: 'ce8201426743c9507d62708c34f1afbb8bab637d',
					},
				],
				{},
			);
		});

		it('creates without an access check when no caller is set', async () => {
			readCollection.mockResolvedValue({ meta: { versioning: true } });

			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ count: 0 }],
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{ id: 1, title: 'Hello' },
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['version-id-2']);

			await expect(new VersionsService({ knex: db, schema }).createOne({
				key: 'draft',
				collection: 'articles',
				item: '1',
			})).resolves.toBe('version-id-2');

			expect(validateAccess).not.toHaveBeenCalled();
		});

		it('refuses a version missing its item', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['version-id-3']);

			await expect(new VersionsService({ knex: db, schema }).createOne({
				key: 'draft',
				collection: 'articles',
			})).rejects.toStrictEqual(new InvalidPayloadError({
				reason: '"item" is required',
			}));

			expect(createMany).not.toHaveBeenCalled();
		});

		it('refuses the reserved "main" key', async () => {
			await expect(new VersionsService({ knex: db, schema }).createOne({
				key: 'main',
				collection: 'articles',
				item: '1',
			})).rejects.toStrictEqual(new InvalidPayloadError({
				reason: '"main" is a reserved version key',
			}));
		});

		it('refuses a caller who cannot read the item', async () => {
			vi.mocked(validateAccess).mockRejectedValue(new Error('no read'));

			await expect(new VersionsService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			}).createOne({
				key: 'draft',
				collection: 'articles',
				item: '1',
			})).rejects.toStrictEqual(new ForbiddenError());
		});

		it('refuses a collection without content versioning', async () => {
			readCollection.mockResolvedValue({ meta: { versioning: false } });

			await expect(new VersionsService({ knex: db, schema }).createOne({
				key: 'draft',
				collection: 'articles',
				item: '1',
			})).rejects.toStrictEqual(new UnprocessableContentError({
				reason: 'Content Versioning is not enabled for collection "articles"',
			}));
		});

		it('refuses a key the item already has a version under', async () => {
			readCollection.mockResolvedValue({ meta: { versioning: true } });

			const readByQuery = vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ count: 1 }],
					{ scopedCacheFingerprints: [] },
				));

			await expect(new VersionsService({ knex: db, schema }).createOne({
				key: 'draft',
				collection: 'articles',
				item: '1',
			})).rejects.toStrictEqual(new UnprocessableContentError({
				reason: oneLine`
					Version "draft" already exists for item "1"
					in collection "articles"
				`,
			}));

			expect(readByQuery).toHaveBeenCalledWith({
				aggregate: { count: ['*'] },
				filter: {
					key: { _eq: 'draft' },
					collection: { _eq: 'articles' },
					item: { _eq: '1' },
				},
			});
		});
	});

	describe('createMany', () => {
		it('refuses a payload that is not an array', async () => {
			await expect(new VersionsService({ knex: db, schema })
				.createMany({ key: 'draft' } as any))
				.rejects.toStrictEqual(new InvalidPayloadError({
					reason: 'Input should be an array of items',
				}));
		});

		it('refuses two versions of one item under the same key', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue([1, 2]);

			await expect(new VersionsService({ knex: db, schema }).createMany([
				{ key: 'draft', collection: 'articles', item: 1 },
				{ key: 'draft', collection: 'articles', item: '1' },
			])).rejects.toStrictEqual(new UnprocessableContentError({
				reason: oneLine`
					Cannot create multiple versions on "1" in collection "articles"
					with the same key "draft"
				`,
			}));

			expect(createMany).not.toHaveBeenCalled();
		});

		it('stamps each version with its main item hash', async () => {
			readCollection.mockResolvedValue({ meta: { versioning: true } });

			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ count: 0 }],
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValueOnce(withMeta(
					{ id: 1, title: 'Hello' },
					{ scopedCacheFingerprints: [] },
				))
				.mockResolvedValueOnce(withMeta(
					{ id: 2, title: 'World' },
					{ scopedCacheFingerprints: [] },
				));

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue([1, 2]);

			await expect(new VersionsService({ knex: db, schema }).createMany([
				{ key: 'draft', collection: 'articles', item: '1' },
				{ key: 'draft', collection: 'articles', item: '2' },
			])).resolves.toStrictEqual([1, 2]);

			expect(createMany).toHaveBeenCalledWith(
				[
					{
						key: 'draft',
						collection: 'articles',
						item: '1',
						hash: 'ce8201426743c9507d62708c34f1afbb8bab637d',
					},
					{
						key: 'draft',
						collection: 'articles',
						item: '2',
						hash: '00e31c5b4136a9882aa709dcee785754e5e1d09b',
					},
				],
				undefined,
			);
		});

		it('refuses a batch whose second version lacks its item', async () => {
			readCollection.mockResolvedValue({ meta: { versioning: true } });

			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ count: 0 }],
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{ id: 1, title: 'Hello' },
					{ scopedCacheFingerprints: [] },
				));

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue([1, 2]);

			await expect(new VersionsService({ knex: db, schema }).createMany([
				{ key: 'draft', collection: 'articles', item: '1' },
				{ key: 'review', collection: 'articles' },
			])).rejects.toStrictEqual(new InvalidPayloadError({
				reason: '"item" is required',
			}));

			expect(createMany).not.toHaveBeenCalled();
		});
	});

	describe('verifyHash', () => {
		it('reports a hash matching the main item as current', async () => {
			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{ id: 1, title: 'Hello' },
					{ scopedCacheFingerprints: [] },
				));

			await expect(new VersionsService({ knex: db, schema }).verifyHash(
				'articles',
				1,
				'ce8201426743c9507d62708c34f1afbb8bab637d',
			)).resolves.toStrictEqual({
				outdated: false,
				mainHash: 'ce8201426743c9507d62708c34f1afbb8bab637d',
			});
		});

		it('reports a hash differing from the main item as outdated', async () => {
			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{ id: 1, title: 'Hello' },
					{ scopedCacheFingerprints: [] },
				));

			await expect(new VersionsService({ knex: db, schema }).verifyHash(
				'articles',
				1,
				'stale-hash',
			)).resolves.toStrictEqual({
				outdated: true,
				mainHash: 'ce8201426743c9507d62708c34f1afbb8bab637d',
			});
		});
	});

	describe('getVersionSaves', () => {
		it('returns the delta of the version of that item', async () => {
			const readByQuery = vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ delta: { title: 'Draft' } }],
					{ scopedCacheFingerprints: [] },
				));

			await expect(new VersionsService({ knex: db, schema })
				.getVersionSaves('draft', 'articles', '1'))
				.resolves.toStrictEqual([{ title: 'Draft' }]);

			expect(readByQuery).toHaveBeenCalledWith({
				filter: {
					key: { _eq: 'draft' },
					collection: { _eq: 'articles' },
					item: { _eq: '1' },
				},
			});
		});

		it('returns null for a version holding no delta', async () => {
			const readByQuery = vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ delta: null }],
					{ scopedCacheFingerprints: [] },
				));

			await expect(new VersionsService({ knex: db, schema })
				.getVersionSaves('draft', 'articles', undefined))
				.resolves.toBe(null);

			expect(readByQuery).toHaveBeenCalledWith({
				filter: {
					key: { _eq: 'draft' },
					collection: { _eq: 'articles' },
				},
			});
		});

		it('returns null when no version has that key', async () => {
			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta([], { scopedCacheFingerprints: [] }));

			await expect(new VersionsService({ knex: db, schema })
				.getVersionSaves('draft', 'articles', '1'))
				.resolves.toBe(null);
		});
	});

	describe('save', () => {
		it('records the save and merges it into the version delta', async () => {
			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{
						collection: 'articles',
						item: '1',
						delta: { title: 'Draft', body: 'Old' },
					},
					{ scopedCacheFingerprints: [] },
				));

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValueOnce(['activity-id-1'])
				.mockResolvedValueOnce(['revision-id-1']);

			vi.spyOn(PayloadService.prototype, 'prepareDelta')
				.mockResolvedValue('{"body":"New"}');

			const updateOne = vi.spyOn(ItemsService.prototype, 'updateOne')
				.mockResolvedValue('version-id-4');

			vi.mocked(shouldClearCache).mockReturnValue(true);

			const service = new VersionsService({
				knex: db,
				schema,
				accountability: {
					user: 'user-1',
					ip: '10.0.0.1',
					userAgent: 'test-agent',
					origin: 'https://app.example.com',
				} as Accountability,
			});

			await expect(service.save('version-id-4', { body: 'New' }))
				.resolves.toStrictEqual({ title: 'Draft', body: 'New' });

			expect(createMany).toHaveBeenNthCalledWith(1, [{
				action: 'version_save',
				user: 'user-1',
				collection: 'articles',
				ip: '10.0.0.1',
				user_agent: 'test-agent',
				origin: 'https://app.example.com',
				item: '1',
			}], {});

			expect(createMany).toHaveBeenNthCalledWith(
				2,
				[
					{
						activity: 'activity-id-1',
						version: 'version-id-4',
						collection: 'articles',
						item: '1',
						data: '{"body":"New"}',
						delta: '{"body":"New"}',
					},
				],
				{ autoPurgeCache: false, bypassLimits: true },
			);

			expect(updateOne).toHaveBeenCalledWith('version-id-4', {
				delta: { title: 'Draft', body: 'New' },
			});

			expect(purgeScopedCache).toHaveBeenCalledWith(null, 'articles', null);
		});

		it('records an anonymous save and leaves the cache alone', async () => {
			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{ collection: 'articles', item: '1', delta: null },
					{ scopedCacheFingerprints: [] },
				));

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValueOnce(['activity-id-2'])
				.mockResolvedValueOnce(['revision-id-2']);

			vi.spyOn(PayloadService.prototype, 'prepareDelta')
				.mockResolvedValue(null);

			vi.spyOn(ItemsService.prototype, 'updateOne')
				.mockResolvedValue('version-id-5');

			vi.mocked(shouldClearCache).mockReturnValue(false);

			await expect(new VersionsService({ knex: db, schema })
				.save('version-id-5', {}))
				.resolves.toStrictEqual({});

			expect(createMany).toHaveBeenNthCalledWith(1, [{
				action: 'version_save',
				user: null,
				collection: 'articles',
				ip: null,
				user_agent: null,
				origin: null,
				item: '1',
			}], {});

			expect(purgeScopedCache).not.toHaveBeenCalled();
		});
	});

	describe('promote', () => {
		it('refuses a version whose delta holds no change', async () => {
			const version = { collection: 'articles', item: '1', delta: null };

			const readOne = vi
				.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(version, { scopedCacheFingerprints: [] }));

			const service = new VersionsService({ knex: db, schema });

			await expect(service.promote(1, 'main-hash'))
				.rejects.toThrowError(UnprocessableContentError);

			await expect(service.promote(1, 'main-hash'))
				.rejects.toThrowError('No changes to promote');

			expect(readOne).toHaveBeenCalledWith(1);
		});
	});

	describe('updateBatch', () => {
		it('refuses a row renaming its version to "main"', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1]);

			await expect(new VersionsService({ knex: db, schema })
				.updateBatch([{ id: 1, key: 'main' }]))
				.rejects.toThrowError('"main" is a reserved version key');

			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('refuses two rows giving versions of one item the same key', async () => {
			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue(withMeta(
					{ collection: 'articles', item: '1' },
					{ scopedCacheFingerprints: [] },
				));

			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta(
					[{ count: 0 }],
					{ scopedCacheFingerprints: [] },
				));

			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1, 2]);

			await expect(new VersionsService({ knex: db, schema }).updateBatch([
				{ id: 1, key: 'draft' },
				{ id: 2, key: 'draft' },
			])).rejects.toThrowError(oneLine`
				Cannot update multiple versions on "1" in collection "articles"
				to the same key "draft"
			`);

			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('refuses a row changing a field a version cannot change', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1]);

			await expect(new VersionsService({ knex: db, schema })
				.updateBatch([{ id: 1, delta: {} }]))
				.rejects.toThrowError('"delta" is not allowed');

			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('writes a row keeping its version key without reading it', async () => {
			const readOne = vi.spyOn(ItemsService.prototype, 'readOne');

			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1]);

			const keys = await new VersionsService({ knex: db, schema })
				.updateBatch([{ id: 1, name: 'Renamed' }]);

			expect(keys).toEqual([1]);
			expect(readOne).not.toHaveBeenCalled();

			expect(updateGroups).toHaveBeenCalledWith(
				[{ data: { name: 'Renamed' }, keys: [1] }],
				{},
			);
		});
	});
});
