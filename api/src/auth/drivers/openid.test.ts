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
import { OpenIDAuthDriver } from './openid.js';

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
		Issuer: {
			discover: async () => {
				return {
					metadata: { response_types_supported: ['code'] },
					Client: function () {
						return {
							issuer: { metadata: {} },
							callback: async () => {
								return {
									access_token: 'access',
									refresh_token: 'refresh',
									claims: () => {
										return {
											sub: 'Ada',
											email: 'ada@example.com',
											groups: mockedDeps.profileGroups,
											email_verified: mockedDeps.emailVerified,
										};
									},
								};
							},
						};
					},
				};
			},
		},
		custom: { http_options: 'http_options' },
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

describe('OpenIDAuthDriver getUserID with a verified email required', () => {
	test.each([false, 'false', undefined])(
		'a first login with email_verified %j creates no user',
		async (emailVerified) => {
			knexTracker.on.select('directus_user_identities').response(undefined);
			mockedDeps.emailVerified = emailVerified;

			await expect(new OpenIDAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					provider: 'oidc',
					issuerUrl: 'https://idp.example.com',
					clientId: 'client-id',
					clientSecret: 'client-secret',
					allowPublicRegistration: true,
				},
			).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' }))
				.rejects.toThrow(new InvalidCredentialsError());

			expect(mockedDeps.logger.warn).toHaveBeenCalledExactlyOnceWith(
				'[OpenID] Unverified email can\'t create a user for provider "oidc"',
			);

			expect(mockedDeps.createOne).not.toHaveBeenCalled();
			expect(mockedDeps.createIdentity).not.toHaveBeenCalled();
		},
	);

	test('a first login with email_verified "true" creates the user', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'oidc',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createOne.mockResolvedValue('user-1');

		mockedDeps.createIdentity
			.mockResolvedValueOnce('identity-1')
			.mockResolvedValueOnce('identity-2');

		mockedDeps.emailVerified = 'true';

		const userId = await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				allowPublicRegistration: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(userId).toBe('user-1');
		expect(mockedDeps.createOne).toHaveBeenCalledOnce();

		expect(mockedDeps.createIdentity.mock.calls).toEqual([
			[{
				user: 'user-1',
				kind: 'oidc',
				value: 'Ada',
				verified: true,
				auth_data: '{"refreshToken":"refresh"}',
				user_info: {
					sub: 'Ada',
					email: 'ada@example.com',
					groups: [],
					email_verified: 'true',
				},
				scope: 'openid profile email',
			}],
			[{
				user: 'user-1',
				kind: 'email',
				value: 'ada@example.com',
				verified: true,
			}],
		]);
	});

	test('a first login creates the user when not required', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'oidc',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createOne.mockResolvedValue('user-1');

		mockedDeps.createIdentity
			.mockResolvedValueOnce('identity-1')
			.mockResolvedValueOnce('identity-2');

		mockedDeps.emailVerified = false;

		const userId = await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
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
				kind: 'oidc',
				value: 'Ada',
				verified: true,
				auth_data: '{"refreshToken":"refresh"}',
				user_info: {
					sub: 'Ada',
					email: 'ada@example.com',
					groups: [],
					email_verified: false,
				},
				scope: 'openid profile email',
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

	test('a known user login adds an unverified email as unverified', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'oidc',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').responseOnce({
			id: 'identity-1',
			user: 'user-1',
			kind: 'oidc',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createIdentity.mockResolvedValue('identity-2');
		mockedDeps.emailVerified = false;

		const userId = await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
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

	test('a known user login syncs a verified email', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'oidc',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').responseOnce({
			id: 'identity-1',
			user: 'user-1',
			kind: 'oidc',
			value: 'Ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createIdentity.mockResolvedValue('identity-2');

		const userId = await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				syncUserInfo: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(userId).toBe('user-1');
		expect(mockedDeps.updateOne).not.toHaveBeenCalled();

		expect(mockedDeps.updateIdentity.mock.calls).toEqual([[
			'identity-1',
			{
				user_info: {
					sub: 'Ada',
					email: 'ada@example.com',
					groups: [],
					email_verified: true,
				},
				scope: 'openid profile email',
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

	test('an unverified email identifier logs no one in', async () => {
		mockedDeps.emailVerified = false;

		await expect(new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'oid',
				syncUserInfo: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' }))
			.rejects.toThrow(new InvalidCredentialsError());

		expect(mockedDeps.logger.warn).toHaveBeenCalledExactlyOnceWith(
			'[OpenID] Unverified email can\'t be the identifier for provider "oidc"',
		);

		expect(knexTracker.history.all).toEqual([]);
		expect(mockedDeps.updateOne).not.toHaveBeenCalled();
		expect(mockedDeps.updateIdentity).not.toHaveBeenCalled();
	});
});
