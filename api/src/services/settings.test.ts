import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishCacheConfigChanged } from '../cache-config.js';
import { ItemsService } from './items.js';
import { SettingsService } from './settings.js';

vi.mock('../cache-config.js', () => ({ publishCacheConfigChanged: vi.fn() }));

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

	it('broadcasts the new cache_ttl when the payload touches it', async () => {
		await service().upsertSingleton({ cache_ttl: '30s' });

		expect(publishCacheConfigChanged).toHaveBeenCalledWith('30s');
	});

	it('broadcasts a cleared cache_ttl (null) so peers fall back to env', async () => {
		await service().upsertSingleton({ cache_ttl: null });

		expect(publishCacheConfigChanged).toHaveBeenCalledWith(null);
	});

	it('stays silent when the payload does not touch cache_ttl', async () => {
		await service().upsertSingleton({ project_name: 'Acme' });

		expect(publishCacheConfigChanged).not.toHaveBeenCalled();
	});
});
