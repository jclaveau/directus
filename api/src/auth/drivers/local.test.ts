import { InvalidCredentialsError } from '@directus/errors';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchPasswordLoginIdentity } from '../utils/user-identities.js';
import { LocalAuthDriver } from './local.js';

vi.mock('../../services/authentication.js', () => {
	return { AuthenticationService: vi.fn() };
});

vi.mock('../utils/user-identities.js', async (importOriginal) => {
	return {
		...(await importOriginal<object>()),
		fetchPasswordLoginIdentity: vi.fn(),
	};
});

const db = knex.default({ client: MockClient });

afterEach(() => {
	vi.clearAllMocks();
});

describe('LocalAuthDriver', () => {
	test('getUserID answers the user of the email identity', async () => {
		vi.mocked(fetchPasswordLoginIdentity).mockResolvedValue({
			id: 'identity-1',
			user: 'user-id-1',
			kind: 'email',
			value: 'ada@example.com',
		} as any);

		const localDriver = new LocalAuthDriver({ knex: db, schema: {} as any }, {});

		await expect(localDriver.getUserID({ email: 'ada@example.com' }))
			.resolves.toBe('user-id-1');

		expect(fetchPasswordLoginIdentity)
			.toHaveBeenCalledWith(db, 'ada@example.com');
	});

	test('refuses a payload without email before any lookup', async () => {
		const localDriver = new LocalAuthDriver({ knex: db, schema: {} as any }, {});

		await expect(localDriver.getIdentity({}, { linkUser: null }))
			.rejects.toStrictEqual(new InvalidCredentialsError());

		expect(fetchPasswordLoginIdentity).not.toHaveBeenCalled();
	});

	test('refuses an email no identity holds', async () => {
		vi.mocked(fetchPasswordLoginIdentity).mockResolvedValue(undefined);

		const localDriver = new LocalAuthDriver({ knex: db, schema: {} as any }, {});

		await expect(localDriver.getIdentity(
			{ email: 'nobody@example.com' },
			{ linkUser: null },
		)).rejects.toStrictEqual(new InvalidCredentialsError());
	});
});
