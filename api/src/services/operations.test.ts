import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemsService } from './items.js';
import { OperationsService } from './operations.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));

vi.mock('../flows.js', () => {
	return { getFlowManager: () => ({ reload }) };
});

const schema = new SchemaBuilder()
	.collection('directus_operations', (c) => {
		c.field('id').uuid()
			.primary();
	})
	.build();

afterEach(() => {
	vi.restoreAllMocks();
	reload.mockClear();
});

describe('Services / Operations', () => {
	describe('updateBatch', () => {
		it('reloads the flows once after the write', async () => {
			vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['id-1', 'id-2']);

			await new OperationsService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch([
				{ id: 'id-1', name: 'first' },
				{ id: 'id-2', name: 'second' },
			]);

			expect(reload).toHaveBeenCalledTimes(1);
		});
	});
});
