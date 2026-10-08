import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import { AccessService } from './access.js';
import { ItemsService } from './items.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../cache.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../cache.js')>(),
		clearSystemCache: vi.fn(),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_access', (c) => {
		c.field('id').uuid()
			.primary();
	})
	.build();

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(clearSystemCache).mockClear();
});

describe('Services / Access', () => {
	describe('updateBatch', () => {
		it('requests every user integrity check and clears the caches', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['access-id-1']);

			const onRequireUserIntegrityCheck = vi.fn();

			await new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch(
				[{ id: 'access-id-1', policy: 'policy-id-1' }],
				{ onRequireUserIntegrityCheck },
			);

			expect(onRequireUserIntegrityCheck)
				.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

			expect(updateGroups).toHaveBeenCalledWith(
				[{ data: { policy: 'policy-id-1' }, keys: ['access-id-1'] }],
				{
					onRequireUserIntegrityCheck,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
				},
			);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});
	});
});
