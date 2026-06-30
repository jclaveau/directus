import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { withMeta } from '../utils/read-meta.js';

// Isolate from redis/bus; force scoped mode on.
vi.mock('../cache.js', () => ({
	getCache: () => ({ cache: null }),
	clearSystemCache: vi.fn(),
	purgeCache: vi.fn(),
	scopedCachePurgeEnabled: vi.fn(() => true),
}));

// withAppMinimalPermissions returns a FRESH array — so without an explicit re-attach the rider would
// be lost. Returning a new array here is what makes this test meaningful.
vi.mock('../permissions/lib/with-app-minimal-permissions.js', () => ({
	withAppMinimalPermissions: (_acc: unknown, result: unknown[]) => [...result, { id: 'app-minimal' }],
}));

import { readMeta } from '../utils/read-meta.js';
import { ItemsService } from './items.js';
import { PermissionsService } from './permissions.js';

const db = knex({ client: MockClient });

describe('PermissionsService.readByQuery override', () => {
	beforeEach(() => vi.restoreAllMocks());

	test('carries the cache-tag rider across the withAppMinimalPermissions rebuild', async () => {
		// super.readByQuery returns a tagged array; the override rebuilds it (new array) and must
		// re-attach the rider so permissions reads stay scoped-invalidatable (not TTL-only).
		const tagged = withMeta([{ id: 1 }], {
			scopedCacheTags: [{ collection: 'directus_permissions' }],
		});

		vi.spyOn(ItemsService.prototype, 'readByQuery').mockResolvedValue(tagged);

		const service = new PermissionsService({ knex: db, schema: {} as any, accountability: null });
		const result = await service.readByQuery({});

		// rebuilt (app-minimal appended) AND the rider survived
		expect(result).toHaveLength(2);

		expect(readMeta(result)?.scopedCacheTags ?? []).toEqual([
			{ collection: 'directus_permissions' },
		]);
	});
});
