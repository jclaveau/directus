import { InvalidCredentialsError } from '@directus/errors';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, test } from 'vitest';
import { AuthDriver } from './auth.js';

class UserIdDriver extends AuthDriver {
	async getUserID(): Promise<string> {
		return 'user-id-1';
	}

	async verify(): Promise<void> {}
}

const db = knex.default({ client: MockClient });
const tracker = createTracker(db);

afterEach(() => {
	tracker.reset();
});

describe('getIdentity of a driver that only finds the user id', () => {
	test('returns the identity of the provider kind', async () => {
		tracker.on.select('directus_user_identities').response({
			id: 'identity-1',
			user: 'user-id-1',
			kind: 'github',
			value: 'octocat',
		});

		const userIdDriver = new UserIdDriver(
			{ knex: db, schema: {} as any },
			{ provider: 'github' },
		);

		await expect(userIdDriver.getIdentity({}, { linkUser: null }))
			.resolves.toStrictEqual({
				id: 'identity-1',
				user: 'user-id-1',
				kind: 'github',
				value: 'octocat',
			});

		expect(tracker.history.select[0]!.bindings)
			.toStrictEqual(['user-id-1', 'github', 1]);
	});

	test('refuses a user without identity of the provider kind', async () => {
		tracker.on.select('directus_user_identities').response(undefined);

		const userIdDriver = new UserIdDriver(
			{ knex: db, schema: {} as any },
			{},
		);

		await expect(userIdDriver.getIdentity({}, { linkUser: null }))
			.rejects.toStrictEqual(new InvalidCredentialsError());

		expect(tracker.history.select[0]!.bindings)
			.toStrictEqual(['user-id-1', 'email', 1]);
	});
});
