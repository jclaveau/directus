import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemsService } from './items.js';
import { SettingsService } from './settings.js';

const db = knex({ client: MockClient });

// Neither the broadcast nor the timeseries marker is this service's job — both ride
// the `settings.update` action so they cover writers that never reach here (see
// cache-config.test.ts). What remains is the validation, which has to run before the
// write and so cannot live on an after-the-fact action.
describe('SettingsService.upsertSingleton', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		// Stub the base write so no real DB round-trip runs; return the singleton key.
		vi.spyOn(ItemsService.prototype, 'upsertSingleton').mockResolvedValue(1);
	});

	function service() {
		return new SettingsService({
			knex: db,
			schema: {} as any,
			accountability: null,
		});
	}

	it('persists a valid cache_ttl', async () => {
		await service().upsertSingleton({ cache_ttl: '30s' });

		expect(ItemsService.prototype.upsertSingleton)
			.toHaveBeenCalledWith({ cache_ttl: '30s' }, undefined);
	});

	it('persists a cleared cache_ttl, which hands the TTL back to env', async () => {
		await service().upsertSingleton({ cache_ttl: null });

		expect(ItemsService.prototype.upsertSingleton)
			.toHaveBeenCalledWith({ cache_ttl: null }, undefined);
	});

	it.each(['abc', '30x', '-5m', '0'])(
		'rejects a malformed cache_ttl (%s) before persisting',
		async (bad) => {
			await expect(service().upsertSingleton({ cache_ttl: bad }))
				.rejects.toThrow(/Invalid cache_ttl/);

			// The gate runs before the write, so nothing is persisted.
			expect(ItemsService.prototype.upsertSingleton).not.toHaveBeenCalled();
		},
	);

	it('leaves a payload that does not touch cache_ttl alone', async () => {
		await service().upsertSingleton({ project_name: 'Acme' });

		expect(ItemsService.prototype.upsertSingleton)
			.toHaveBeenCalledWith({ project_name: 'Acme' }, undefined);
	});
});
