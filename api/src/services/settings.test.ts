import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishCacheConfigChanged } from '../cache-config.js';
import { recordCacheConfigEvent } from '../cache-events.js';
import { ItemsService } from './items.js';
import { SettingsService } from './settings.js';

vi.mock('../cache-config.js', () => ({ publishCacheConfigChanged: vi.fn() }));

vi.mock('../cache-events.js', () => {
	return { recordCacheConfigEvent: vi.fn(() => Promise.resolve()) };
});

const db = knex({ client: MockClient });

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

	it('broadcasts + records the new cache_ttl on change', async () => {
		await service().upsertSingleton({ cache_ttl: '30s' });

		expect(publishCacheConfigChanged).toHaveBeenCalledWith('30s');
		expect(recordCacheConfigEvent).toHaveBeenCalledWith('ttl_change', '30s');
	});

	it('broadcasts a cleared cache_ttl (null) so peers fall back to env', async () => {
		await service().upsertSingleton({ cache_ttl: null });

		expect(publishCacheConfigChanged).toHaveBeenCalledWith(null);
		expect(recordCacheConfigEvent).toHaveBeenCalledWith('ttl_change', null);
	});

	it.each(['abc', '30x', '-5m', '0'])(
		'rejects a malformed cache_ttl (%s) before persisting',
		async (bad) => {
			await expect(service().upsertSingleton({ cache_ttl: bad }))
				.rejects.toThrow(/Invalid cache_ttl/);

			// Gate runs before the write + broadcast, so nothing is persisted.
			expect(ItemsService.prototype.upsertSingleton).not.toHaveBeenCalled();
			expect(publishCacheConfigChanged).not.toHaveBeenCalled();
			expect(recordCacheConfigEvent).not.toHaveBeenCalled();
		},
	);

	it('stays silent when the payload does not touch cache_ttl', async () => {
		await service().upsertSingleton({ project_name: 'Acme' });

		expect(publishCacheConfigChanged).not.toHaveBeenCalled();
		expect(recordCacheConfigEvent).not.toHaveBeenCalled();
	});
});
