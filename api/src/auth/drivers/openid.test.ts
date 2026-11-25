import { InvalidPayloadError } from '@directus/errors';
import { oneLine } from '@directus/utils';
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
import { OpenIDAuthDriver } from './openid.js';

const mockedDeps = vi.hoisted(() => {
	return {
		logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		createOne: vi.fn(),
		updateOne: vi.fn(),
		readInvite: vi.fn(),
		grantInvitedRoles: vi.fn(),
		profileGroups: [] as string[],
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
				readInvite: mockedDeps.readInvite,
				grantInvitedRoles: mockedDeps.grantInvitedRoles,
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

describe('OpenIDAuthDriver getUserID', () => {
	test('a login of a known user syncs the default role', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });

		const userId = await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
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
			'oidc',
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

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				defaultRoleId: 'role-default',
				roleMapping: { staff: 'role-staff', auditors: 'role-auditors' },
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(syncProviderMemberships).toHaveBeenCalledWith(
			'user-1',
			'oidc',
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

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
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

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				defaultRoleId: 'role-default',
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(syncProviderMemberships).not.toHaveBeenCalled();
	});

	test('a first unmapped login gives the admin the role', async () => {
		knexTracker.on.select('directus_users').response(undefined);
		mockedDeps.createOne.mockResolvedValue('user-1');

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(mockedDeps.createOne).toHaveBeenCalledWith({
			provider: 'oidc',
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

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
				roleMapping: { staff: 'role-staff', auditors: 'role-auditors' },
			},
		).getUserID({ code: 'code', codeVerifier: 'verifier', state: 'state' });

		expect(mockedDeps.createOne).toHaveBeenCalledWith({
			provider: 'oidc',
			email: 'ada@example.com',
			external_identifier: 'Ada',
			auth_data: '{"refreshToken":"refresh"}',
			roles: [{ role: 'role-staff', managed_by: 'auth:oidc' }],
		});
	});

	test('refuses an auth.create hook returning its own role', async () => {
		knexTracker.on.select('directus_users').response(undefined);

		vi.mocked(emitter.emitFilter).mockImplementation(
			async (_eventName: any, eventPayload: any) => {
				return { ...eventPayload, role: 'role-hook' };
			},
		);

		await expect(new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
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

	test(oneLine`
		a first login with an invite creates the user, public registration off,
		and grants the invited roles
	`, async () => {
		knexTracker.on.select('directus_users').response(undefined);

		mockedDeps.readInvite.mockResolvedValue({
			email: 'ada@example.com',
			inviteRows: [{ id: 'invite-1', role: 'role-invited' }],
		});

		mockedDeps.createOne.mockResolvedValue('user-1');

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				defaultRoleId: 'role-default',
				allowPublicRegistration: false,
			},
		).getUserID({
			code: 'code',
			codeVerifier: 'verifier',
			state: 'state',
			invite: 'invite-token',
		});

		expect(mockedDeps.readInvite).toHaveBeenCalledExactlyOnceWith('invite-token');
		expect(mockedDeps.createOne).toHaveBeenCalledOnce();

		expect(mockedDeps.grantInvitedRoles).toHaveBeenCalledExactlyOnceWith(
			expect.anything(),
			'user-1',
			[{ id: 'invite-1', role: 'role-invited' }],
		);
	});

	test('a known user logging in with an invite gets its roles', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });

		mockedDeps.readInvite.mockResolvedValue({
			email: 'ada@example.com',
			inviteRows: [{ id: 'invite-1', role: 'role-invited' }],
		});

		await new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				defaultRoleId: 'role-default',
			},
		).getUserID({
			code: 'code',
			codeVerifier: 'verifier',
			state: 'state',
			invite: 'invite-token',
		});

		expect(mockedDeps.createOne).not.toHaveBeenCalled();

		expect(mockedDeps.grantInvitedRoles).toHaveBeenCalledExactlyOnceWith(
			expect.anything(),
			'user-1',
			[{ id: 'invite-1', role: 'role-invited' }],
		);
	});

	test('a refused invite creates no user and grants no role', async () => {
		knexTracker.on.select('directus_users').response(undefined);

		mockedDeps.readInvite.mockRejectedValue(new InvalidPayloadError({
			reason: 'Email address ada@example.com hasn\'t been invited',
		}));

		await expect(new OpenIDAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'oidc',
				issuerUrl: 'https://idp.example.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				defaultRoleId: 'role-default',
				allowPublicRegistration: true,
			},
		).getUserID({
			code: 'code',
			codeVerifier: 'verifier',
			state: 'state',
			invite: 'invite-token',
		})).rejects.toThrow(new InvalidPayloadError({
			reason: 'Email address ada@example.com hasn\'t been invited',
		}));

		expect(knexTracker.history.all).toEqual([]);
		expect(mockedDeps.createOne).not.toHaveBeenCalled();
		expect(mockedDeps.grantInvitedRoles).not.toHaveBeenCalled();
	});
});
