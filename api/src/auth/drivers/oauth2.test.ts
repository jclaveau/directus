import { InvalidCredentialsError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import emitter from '../../emitter.js';
import { OAuth2AuthDriver } from './oauth2.js';

const mockedDeps = vi.hoisted(() => {
	return {
		logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		createOne: vi.fn(),
		createIdentity: vi.fn(),
		updateIdentity: vi.fn(),
		updateOne: vi.fn(),
		profileGroups: [] as string[],
		emailVerified: true as unknown,
	};
});

vi.mock('openid-client', () => {
	return {
		Issuer: function () {
			return {
				Client: function () {
					return {
						oauthCallback: async () => {
							return { access_token: 'access', refresh_token: 'refresh' };
						},
						userinfo: async () => {
							return {
								login: 'Ada',
								email: 'ada@example.com',
								groups: mockedDeps.profileGroups,
								verified: mockedDeps.emailVerified,
							};
						},
					};
				},
			};
		},
		generators: { codeChallenge: () => 'challenge' },
		errors: { OPError: class {}, RPError: class {} },
	};
});

vi.mock('../../utils/get-config-from-env.js', () => {
	return { getConfigFromEnv: vi.fn(() => ({})) };
});

vi.mock('../../auth.js', () => ({ getAuthProvider: vi.fn() }));

vi.mock('../../logger/index.js', () => {
	return {
		useLogger: () => mockedDeps.logger,
	};
});

vi.mock('../../database/index.js', () => {
	return {
		default: vi.fn(() => 'database-handle'),
	};
});

vi.mock('../../emitter.js', () => {
	return {
		default: { emitFilter: vi.fn() },
	};
});

vi.mock('../../services/users.js', () => {
	return {
		UsersService: vi.fn(function () {
			return {
				createOne: mockedDeps.createOne,
				updateOne: mockedDeps.updateOne,
			};
		}),
	};
});

vi.mock('../../services/items.js', () => {
	return {
		ItemsService: vi.fn(function () {
			return {
				createOne: mockedDeps.createIdentity,
				updateOne: mockedDeps.updateIdentity,
			};
		}),
	};
});

vi.mock('../../utils/transaction.js', () => {
	return {
		transaction: vi.fn((trxKnex, runInTransaction) => runInTransaction(trxKnex)),
	};
});

vi.mock('../../services/authentication.js', () => {
	return { AuthenticationService: vi.fn() };
});

vi.mock('../../middleware/respond.js', () => ({ respond: vi.fn() }));

let mockedKnex: Knex;
let knexTracker: Tracker;

beforeAll(() => {
	mockedKnex = knex.default({ client: MockClient });
	knexTracker = createTracker(mockedKnex);
});

beforeEach(() => {
	vi.mocked(emitter.emitFilter).mockImplementation(
		async (_eventName: any, eventPayload: any) => eventPayload,
	);
});

afterEach(() => {
	knexTracker.reset();
	vi.resetAllMocks();
	mockedDeps.profileGroups = [];
	mockedDeps.emailVerified = true;
});

describe('OAuth2AuthDriver getUserID with a verified email required', () => {
	test('a first login with an unverified email creates no user', async () => {
		knexTracker.on.select('directus_user_identities').response(undefined);
		mockedDeps.emailVerified = false;

		await expect(new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				emailVerifiedKey: 'verified',
				allowPublicRegistration: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' }))
			.rejects.toThrow(new InvalidCredentialsError());

		expect(mockedDeps.logger.warn).toHaveBeenCalledExactlyOnceWith(
			'[OAuth2] Unverified email can\'t create a user for provider "github"',
		);

		expect(mockedDeps.createOne).not.toHaveBeenCalled();
		expect(mockedDeps.createIdentity).not.toHaveBeenCalled();
	});

	test('a first login without the key creates no user', async () => {
		knexTracker.on.select('directus_user_identities').response(undefined);

		await expect(new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				allowPublicRegistration: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' }))
			.rejects.toThrow(new InvalidCredentialsError());

		expect(mockedDeps.createOne).not.toHaveBeenCalled();
		expect(mockedDeps.createIdentity).not.toHaveBeenCalled();
	});

	test('a first login creates the user when not required', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'github',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createOne.mockResolvedValue('user-1');

		mockedDeps.createIdentity
			.mockResolvedValueOnce('identity-1')
			.mockResolvedValueOnce('identity-2');

		mockedDeps.emailVerified = false;

		const userId = await new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				requireVerifiedEmail: false,
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(userId).toBe('user-1');

		expect(mockedDeps.createOne.mock.calls).toEqual([[{
			first_name: undefined,
			last_name: undefined,
			role: 'role-default',
		}]]);

		expect(mockedDeps.createIdentity.mock.calls).toEqual([
			[{
				user: 'user-1',
				kind: 'github',
				value: 'Ada',
				verified: true,
				auth_data: '{"refreshToken":"refresh"}',
				user_info: {
					login: 'Ada',
					email: 'ada@example.com',
					groups: [],
					verified: false,
				},
				scope: 'email',
			}],
			[{
				user: 'user-1',
				kind: 'email',
				value: 'ada@example.com',
				verified: false,
			}],
		]);

		expect(knexTracker.history.update).toMatchObject([{
			sql: 'update "directus_users" set "primary_identity" = ? where "id" = ?',
			bindings: ['identity-2', 'user-1'],
		}]);
	});

	test('a known user login syncs a verified email', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'github',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').responseOnce({
			id: 'identity-1',
			user: 'user-1',
			kind: 'github',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createIdentity.mockResolvedValue('identity-2');

		const userId = await new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				emailVerifiedKey: 'verified',
				syncUserInfo: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(userId).toBe('user-1');
		expect(mockedDeps.updateOne).not.toHaveBeenCalled();

		expect(mockedDeps.updateIdentity.mock.calls).toEqual([[
			'identity-1',
			{
				user_info: {
					login: 'Ada',
					email: 'ada@example.com',
					groups: [],
					verified: true,
				},
				scope: 'email',
				auth_data: '{"refreshToken":"refresh"}',
			},
		]]);

		expect(mockedDeps.createIdentity.mock.calls).toEqual([[{
			user: 'user-1',
			kind: 'email',
			value: 'ada@example.com',
			verified: true,
		}]]);

		expect(knexTracker.history.update).toMatchObject([{
			sql: 'update "directus_users" set "primary_identity" = ?'
				+ ' where "id" = ? and "primary_identity" is null',
			bindings: ['identity-2', 'user-1'],
		}]);
	});

	test('a known user login adds an unverified email as unverified', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'github',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').responseOnce({
			id: 'identity-1',
			user: 'user-1',
			kind: 'github',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createIdentity.mockResolvedValue('identity-2');
		mockedDeps.emailVerified = false;

		const userId = await new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				emailVerifiedKey: 'verified',
				syncUserInfo: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(userId).toBe('user-1');
		expect(mockedDeps.updateOne).not.toHaveBeenCalled();

		expect(mockedDeps.createIdentity.mock.calls).toEqual([[{
			user: 'user-1',
			kind: 'email',
			value: 'ada@example.com',
			verified: false,
		}]]);

		expect(mockedDeps.logger.warn).not.toHaveBeenCalled();
	});

	test('an unverified email identifier logs no one in', async () => {
		mockedDeps.emailVerified = false;

		await expect(new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'id',
				emailVerifiedKey: 'verified',
				syncUserInfo: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' }))
			.rejects.toThrow(new InvalidCredentialsError());

		expect(mockedDeps.logger.warn).toHaveBeenCalledExactlyOnceWith(
			'[OAuth2] Unverified email can\'t be the identifier for provider "github"',
		);

		expect(knexTracker.history.all).toEqual([]);
		expect(mockedDeps.updateOne).not.toHaveBeenCalled();
		expect(mockedDeps.updateIdentity).not.toHaveBeenCalled();
	});
});
