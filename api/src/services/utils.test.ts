import { ForbiddenError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { UtilsService } from './utils.js';

vi.mock('../cache.js', () => ({ getCache: vi.fn(() => ({ cache: null })), clearSystemCache: vi.fn() }));

vi.mock('../database/index.js', () => ({ default: vi.fn(), getDatabaseClient: vi.fn().mockReturnValue('postgres') }));

vi.mock('../permissions/modules/validate-access/validate-access.js', () => ({ validateAccess: vi.fn() }));

vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js', () => ({
	fetchAllowedFields: vi.fn(),
}));

describe('UtilsService', () => {
	const db = knex({ client: MockClient }) as unknown as Knex;
	const tracker: Tracker = createTracker(db);

	const nonAdmin = { role: 'test', admin: false, user: 'user-1' } as Accountability;

	afterEach(() => {
		tracker.reset();
		vi.clearAllMocks();
	});

	test('sort throws a ForbiddenError with a reason when the sort field is not readable', async () => {
		tracker.on.select('directus_collections').response({ sort_field: 'sort' });

		vi.mocked(validateAccess).mockResolvedValueOnce(undefined);
		vi.mocked(fetchAllowedFields).mockResolvedValueOnce(['id']);

		const service = new UtilsService({ knex: db, schema: {} as any, accountability: nonAdmin });

		const error = await service.sort('articles', { item: 1, to: 2 }).catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe(`'user-1' does not have permission to read the sort field 'articles.sort'`);
	});

	test('clearCache throws a ForbiddenError with a reason for non-admin users', async () => {
		const service = new UtilsService({ knex: db, schema: {} as any, accountability: nonAdmin });

		const error = await service.clearCache({ system: false }).catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe(`'user-1' does not have permission to clear the cache as not being an admin`);
	});
});
