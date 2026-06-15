import { ForbiddenError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { describe, expect, test, vi } from 'vitest';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { RelationsService } from './relations.js';

vi.mock('../cache.js', () => ({
	getCache: vi.fn(() => ({ cache: null, systemCache: null, localSchemaCache: null, lockCache: null })),
	clearSystemCache: vi.fn(),
	getCacheValue: vi.fn(),
	setCacheValue: vi.fn(),
}));

vi.mock('../database/index.js', () => ({ default: vi.fn(), getDatabaseClient: vi.fn().mockReturnValue('postgres') }));

vi.mock('@directus/schema', async () => {
	const { mockSchema } = await import('../test-utils/schema.js');
	return mockSchema();
});

vi.mock('./items.js', () => ({ ItemsService: vi.fn() }));

vi.mock('../permissions/modules/validate-access/validate-access.js', () => ({ validateAccess: vi.fn() }));

vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js', () => ({
	fetchAllowedFields: vi.fn(),
}));

describe('RelationsService', () => {
	const db = knex({ client: MockClient }) as unknown as Knex;

	const nonAdmin = { role: 'test', admin: false, user: 'user-1' } as Accountability;

	test('createOne throws a ForbiddenError with a reason for non-admin users', async () => {
		const service = new RelationsService({ knex: db, schema: {} as any, accountability: nonAdmin });

		const error = await service.createOne({ collection: 'test', field: 'rel' }).catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe(`'user-1' is not allowed to create a relation`);
	});

	test('updateOne throws a ForbiddenError with a reason for non-admin users', async () => {
		const service = new RelationsService({ knex: db, schema: {} as any, accountability: nonAdmin });

		const error = await service.updateOne('test', 'rel', {}).catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe(`'user-1' is not allowed to update a relation`);
	});

	test('deleteOne throws a ForbiddenError with a reason for non-admin users', async () => {
		const service = new RelationsService({ knex: db, schema: {} as any, accountability: nonAdmin });

		const error = await service.deleteOne('test', 'rel').catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe(`'user-1' is not allowed to delete a relation`);
	});

	test('readOne throws a ForbiddenError with a reason when the field is not readable', async () => {
		vi.mocked(validateAccess).mockResolvedValueOnce(undefined);
		vi.mocked(fetchAllowedFields).mockResolvedValueOnce(['id']);

		const service = new RelationsService({ knex: db, schema: {} as any, accountability: nonAdmin });

		const error = await service.readOne('articles', 'author').catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe(`'user-1' has no permission to read the field 'author' of 'articles'`);
	});
});
