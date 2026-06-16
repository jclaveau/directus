import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemsService, PoliciesService } from './index.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

const clearPermissionsCacheMock = vi.hoisted(() => vi.fn());

vi.mock('../permissions/cache.js', async (importActual) => ({
	...(await importActual<typeof import('../permissions/cache.js')>()),
	clearCache: clearPermissionsCacheMock,
}));

vi.mock('../cache.js', async (importActual) => ({
	...(await importActual<typeof import('../cache.js')>()),
	clearSystemCache: vi.fn(),
}));

const schema = new SchemaBuilder()
	.collection('directus_policies', (c) => {
		c.field('id').uuid().primary();
	})
	.build();

describe('Integration Tests', () => {
	const db = vi.mocked(knex.default({ client: MockClient }));
	createTracker(db);

	describe('Services / Policies', () => {
		const service = new PoliciesService({ knex: db, schema });

		let superCreateManySpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			superCreateManySpy = vi.spyOn(ItemsService.prototype, 'createMany').mockResolvedValue(['policy-id-1']);
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it('validates IP access per item, delegates to super.createMany, and clears the permissions cache', async () => {
			const result = await service.createMany([{ name: 'Policy A' }, { name: 'Policy B' }]);

			expect(result).toEqual(['policy-id-1']);
			expect(superCreateManySpy).toHaveBeenCalledTimes(1);
			expect(clearPermissionsCacheMock).toHaveBeenCalledTimes(1);
		});
	});
});
