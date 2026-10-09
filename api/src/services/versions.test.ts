import { UnprocessableContentError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { withMeta } from '../utils/read-meta.js';
import { ItemsService } from './items.js';
import { VersionsService } from './versions.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
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
});

describe('Services / Versions', () => {
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
