import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordCacheConfigEvent } from '../cache-events.js';
import { ItemsService } from './items.js';
import { SettingsService } from './settings.js';

vi.mock('../cache-events.js', () => {
	return { recordCacheConfigEvent: vi.fn(() => Promise.resolve()) };
});

const db = knex({ client: MockClient });

// Broadcasting the new value is not this service's job — it rides the
// `settings.update` action so it covers writers that never reach here (see
// cache-config.test.ts). What remains here is the validation gate and the marker.
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

	it('records the new cache_ttl on change', async () => {
		await service().upsertSingleton({ cache_ttl: '30s' });

		expect(recordCacheConfigEvent).toHaveBeenCalledWith('ttl_change', '30s');
	});

	it('records a cleared cache_ttl so the timeseries shows the reset', async () => {
		await service().upsertSingleton({ cache_ttl: null });

		expect(recordCacheConfigEvent).toHaveBeenCalledWith('ttl_change', null);
	});

	it.each(['abc', '30x', '-5m', '0'])(
		'rejects a malformed cache_ttl (%s) before persisting',
		async (bad) => {
			await expect(service().upsertSingleton({ cache_ttl: bad }))
				.rejects.toThrow(/Invalid cache_ttl/);

			// Gate runs before the write, so nothing is persisted and nothing is recorded.
			expect(ItemsService.prototype.upsertSingleton).not.toHaveBeenCalled();
			expect(recordCacheConfigEvent).not.toHaveBeenCalled();
		},
	);

	it('stays silent when the payload does not touch cache_ttl', async () => {
		await service().upsertSingleton({ project_name: 'Acme' });

		expect(recordCacheConfigEvent).not.toHaveBeenCalled();
	});
});
