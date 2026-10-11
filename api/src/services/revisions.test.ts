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
