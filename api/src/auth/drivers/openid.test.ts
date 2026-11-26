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
			knexTracker.on.select('directus_users').response(undefined);
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
		},
	);

	test('a first login with email_verified "true" creates the user', async () => {
		knexTracker.on.select('directus_users').response(undefined);
		mockedDeps.createOne.mockResolvedValue('user-1');
		mockedDeps.emailVerified = 'true';

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				allowPublicRegistration: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(mockedDeps.createOne).toHaveBeenCalledOnce();
	});

	test('a first login creates the user when not required', async () => {
		knexTracker.on.select('directus_users').response(undefined);
		mockedDeps.createOne.mockResolvedValue('user-1');
		mockedDeps.emailVerified = false;

		await new OpenIDAuthDriver(
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

		expect(mockedDeps.createOne).toHaveBeenCalledWith({
			provider: 'oidc',
			email: 'ada@example.com',
			external_identifier: 'Ada',
			auth_data: '{"refreshToken":"refresh"}',
			role: 'role-default',
		});
	});

	test('a known user login never syncs an unverified email', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });
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

		expect(mockedDeps.updateOne).toHaveBeenCalledExactlyOnceWith('user-1', {
			auth_data: '{"refreshToken":"refresh"}',
			first_name: undefined,
			last_name: undefined,
		});

		expect(mockedDeps.logger.warn).toHaveBeenCalledExactlyOnceWith(
			'[OpenID] Unverified email not synced for provider "oidc"',
		);
	});

	test('a known user login syncs a verified email', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				syncUserInfo: true,
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(mockedDeps.updateOne).toHaveBeenCalledExactlyOnceWith('user-1', {
			auth_data: '{"refreshToken":"refresh"}',
			first_name: undefined,
			last_name: undefined,
			email: 'ada@example.com',
		});
	});

	test('an unverified email identifier logs no one in', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });
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

		expect(mockedDeps.updateOne).not.toHaveBeenCalled();
	});
});
