import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import emitter from '../emitter.js';
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

		c.field('name').string();
		c.field('admin_access').boolean();
		c.field('app_access').boolean();
	})
	.build();

const db = knex.default({ client: MockClient });
const tracker = createTracker(db);

afterEach(() => {
	tracker.reset();
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
			tracker.on.update('directus_policies').response(1);

			const onRequireUserIntegrityCheck = vi.fn();

			await new PoliciesService({ knex: db, schema }).updateBatch([
				{ id: '7d3e5f40-1a2b-4c3d-9e8f-000000000002', admin_access: false },
				{ id: '7d3e5f40-1a2b-4c3d-9e8f-000000000003', app_access: true },
			], { onRequireUserIntegrityCheck });

			expect(onRequireUserIntegrityCheck)
				.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});

		it('clears the caches when a policies.update hook grants admin', async () => {
			tracker.on.update('directus_policies').response(1);

			const onRequireUserIntegrityCheck = vi.fn();

			const grantAdminAccess = () => {
				return [{
					data: { name: 'Editors', admin_access: true },
					keys: ['7d3e5f40-1a2b-4c3d-9e8f-000000000004'],
				}];
			};

			emitter.onFilter('policies.update', grantAdminAccess);

			try {
				await new PoliciesService({ knex: db, schema }).updateMany(
					['7d3e5f40-1a2b-4c3d-9e8f-000000000004'],
					{ name: 'Editors' },
					{ onRequireUserIntegrityCheck },
				);
			}
			finally {
				emitter.offFilter('policies.update', grantAdminAccess);
			}

			expect(onRequireUserIntegrityCheck)
				.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});
	});
});
