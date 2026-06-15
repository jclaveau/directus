import { ForbiddenError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { describe, expect, test, vi } from 'vitest';
import { PermissionsService } from './permissions.js';

vi.mock('../cache.js', () => ({ getCache: vi.fn(() => ({ cache: null })) }));

vi.mock('../database/index.js', () => ({ default: vi.fn(), getDatabaseClient: vi.fn().mockReturnValue('postgres') }));

describe('PermissionsService', () => {
	const db = knex({ client: MockClient }) as unknown as Knex;

	test('getItemPermissions throws a ForbiddenError with a reason for unauthenticated users', async () => {
		const service = new PermissionsService({ knex: db, schema: {} as any, accountability: null });

		const error = await service.getItemPermissions('test').catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe('You must be authenticated to read item permissions.');
	});
});
