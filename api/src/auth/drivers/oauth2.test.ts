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
import { syncProviderMemberships } from '../utils/provider-memberships.js';
import { OAuth2AuthDriver } from './oauth2.js';

const mockedDeps = vi.hoisted(() => {
	return {
		logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		createOne: vi.fn(),
		updateOne: vi.fn(),
		profileGroups: [] as string[],
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

vi.mock('../utils/provider-memberships.js', async (importOriginal) => {
	return {
		...await importOriginal<
			typeof import('../utils/provider-memberships.js')
		>(),
		syncProviderMemberships: vi.fn(),
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
});

describe('OAuth2AuthDriver getUserID', () => {
	test('a login of a known user syncs the default role', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });

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
				defaultRoleId: 'role-default',
				roleMapping: {},
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(userId).toBe('user-1');

		expect(mockedDeps.updateOne).toHaveBeenCalledWith(
			'user-1',
			{ auth_data: '{"refreshToken":"refresh"}' },
		);

		expect(syncProviderMemberships).toHaveBeenCalledWith(
			'user-1',
			'github',
			['role-default'],
			{
				knex: mockedKnex,
				schema: { collections: {}, relations: [] },
			},
		);
	});

	test('a login syncs the role of the group mapped first', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });
		mockedDeps.profileGroups = ['auditors', 'staff'];

		await new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				defaultRoleId: 'role-default',
				roleMapping: { staff: 'role-staff', auditors: 'role-auditors' },
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(syncProviderMemberships).toHaveBeenCalledWith(
			'user-1',
			'github',
			['role-staff'],
			{
				knex: mockedKnex,
				schema: { collections: {}, relations: [] },
			},
		);
	});

	test('the auth.update hook reads roles and is refused role', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });
		mockedDeps.profileGroups = ['staff'];
		let hookPayload: any;

		vi.mocked(emitter.emitFilter).mockImplementation(
			async (_eventName: any, eventPayload: any) => {
				hookPayload = eventPayload;
				return eventPayload;
			},
		);

		await new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				defaultRoleId: 'role-default',
				roleMapping: { staff: 'role-staff', auditors: 'role-auditors' },
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(JSON.parse(JSON.stringify(hookPayload))).toEqual({
			auth_data: '{"refreshToken":"refresh"}',
			roles: ['role-staff'],
		});

		expect(() => hookPayload.role).toThrow(new Error(
			'The "auth.update" payload has no "role" since multi-role (#746):'
			+ ' read or set "roles"',
		));
	});

	test('a login without a role mapping leaves the memberships', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });
		mockedDeps.profileGroups = ['staff'];

		await new OAuth2AuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'github',
				authorizeUrl: 'https://idp.example.com/authorize',
				accessUrl: 'https://idp.example.com/token',
				profileUrl: 'https://idp.example.com/profile',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				identifierKey: 'login',
				defaultRoleId: 'role-default',
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(syncProviderMemberships).not.toHaveBeenCalled();
	});

	test('a first unmapped login gives the admin the role', async () => {
		knexTracker.on.select('directus_users').response(undefined);
		mockedDeps.createOne.mockResolvedValue('user-1');

		await new OAuth2AuthDriver(
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
				defaultRoleId: 'role-default',
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(mockedDeps.createOne).toHaveBeenCalledWith({
			provider: 'github',
			email: 'ada@example.com',
			external_identifier: 'Ada',
			auth_data: '{"refreshToken":"refresh"}',
			roles: [{ role: 'role-default', managed_by: null }],
		});
		});

	test('a first login gives the provider the role mapped first', async () => {
		knexTracker.on.select('directus_users').response(undefined);
		mockedDeps.createOne.mockResolvedValue('user-1');
		mockedDeps.profileGroups = ['auditors', 'staff'];

		await new OAuth2AuthDriver(
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
				defaultRoleId: 'role-default',
				roleMapping: { staff: 'role-staff', auditors: 'role-auditors' },
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(mockedDeps.createOne).toHaveBeenCalledWith({
			provider: 'github',
			email: 'ada@example.com',
			external_identifier: 'Ada',
			auth_data: '{"refreshToken":"refresh"}',
			roles: [{ role: 'role-staff', managed_by: 'auth:github' }],
		});
	});

	test('refuses an auth.create hook returning its own role', async () => {
		knexTracker.on.select('directus_users').response(undefined);

		vi.mocked(emitter.emitFilter).mockImplementation(
			async (_eventName: any, eventPayload: any) => {
				return { ...eventPayload, role: 'role-hook' };
			},
		);

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
				defaultRoleId: 'role-default',
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' }))
			.rejects.toThrow(new Error(
				'The "auth.create" payload has no "role" since multi-role (#746):'
				+ ' read or set "roles"',
			));

		expect(mockedDeps.createOne).not.toHaveBeenCalled();
	});
});
