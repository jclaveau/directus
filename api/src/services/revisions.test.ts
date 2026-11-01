import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemsService } from './items.js';
import { RevisionsService } from './revisions.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_revisions', (c) => {
		c.field('id').id();
	})
	.build();

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Services / Revisions', () => {
	describe('revert', () => {
		it('refuses a revision holding no data', async () => {
			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue({ id: 1, collection: 'articles', item: 7, data: null });

			await expect(new RevisionsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).revert(1)).rejects.toEqual(new InvalidPayloadError({
				reason: `Revision doesn't contain data to revert to`,
			}));
		});

		it('writes the revision\'s data back onto its item', async () => {
			vi.spyOn(ItemsService.prototype, 'readOne')
				.mockResolvedValue({
					id: 1,
					collection: 'articles',
					item: 7,
					data: { title: 'Old title' },
				});

			const updateOne = vi.spyOn(ItemsService.prototype, 'updateOne')
				.mockResolvedValue(7);

			const db = knex.default({ client: MockClient });

			await new RevisionsService({
				accountability: {
					admin: false,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'editor',
				},
				knex: db,
				schema,
			}).revert(1);

			expect(updateOne).toHaveBeenCalledWith(7, { title: 'Old title' });

			expect(updateOne.mock.contexts).toMatchObject([{
				accountability: {
					admin: false,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'editor',
				},
				collection: 'articles',
				knex: db,
			}]);
		});
	});

	describe('updateBatch', () => {
		it('skips the cache purge and the mutation limits', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1]);

			await new RevisionsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch([{ id: 1, delta: null }]);

			expect(updateGroups).toHaveBeenCalledWith(
				[{ data: { delta: null }, keys: [1] }],
				{ autoPurgeCache: false, bypassLimits: true },
			);
		});
	});
});
