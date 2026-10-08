import { SchemaBuilder } from '@directus/schema-builder';
import { type MutationOptions, UserIntegrityCheckFlag } from '@directus/types';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import { ItemsService } from './items.js';
import { PoliciesService } from './policies.js';

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
	.collection('directus_policies', (c) => {
		c.field('id').uuid()
			.primary();
	})
	.build();

const db = knex.default({ client: MockClient });

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(clearSystemCache).mockClear();
});

describe('Services / Policies', () => {
	describe('updateBatch', () => {
		it('refuses a row with an invalid ip_access', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['policy-id-1']);

			await expect(new PoliciesService({ knex: db, schema }).updateBatch([
				{ id: 'policy-id-1', ip_access: ['10.0.0.*'] },
			])).rejects.toThrowError('IP Access contains an incorrect value');

			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('requests the union of every row\'s integrity checks', async () => {
			vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['policy-id-2', 'policy-id-3']);

			const opts: MutationOptions = {};

			await new PoliciesService({ knex: db, schema }).updateBatch([
				{ id: 'policy-id-2', admin_access: false },
				{ id: 'policy-id-3', app_access: true },
			], opts);

			expect(opts.userIntegrityCheckFlags).toBe(UserIntegrityCheckFlag.All);
			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});
	});
});
