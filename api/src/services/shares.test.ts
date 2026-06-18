import { ForbiddenError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { describe, expect, test, vi } from 'vitest';
import { SharesService } from './shares.js';

vi.mock('../cache.js', () => ({ getCache: vi.fn(() => ({ cache: null })) }));

vi.mock('../database/index.js', () => ({ default: vi.fn(), getDatabaseClient: vi.fn().mockReturnValue('postgres') }));

describe('SharesService', () => {
	const db = knex({ client: MockClient }) as unknown as Knex;

	test('invite throws a ForbiddenError with a reason for unauthenticated users', async () => {
		const service = new SharesService({ knex: db, schema: {} as any, accountability: null });

		const error = await service.invite({ emails: ['someone@example.com'], share: '1' }).catch((err) => err);

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.message).toBe('You must be authenticated to send a share invite.');
	});
});
