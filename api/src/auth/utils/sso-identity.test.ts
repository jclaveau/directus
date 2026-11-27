import {
	InvalidCredentialsError,
	RecordNotUniqueError,
} from '@directus/errors';
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
import {
	loginSsoIdentity,
	toStoredUserInfo,
	updateIdentityAuthData,
} from './sso-identity.js';
import { fetchIdentity, fetchIdentityById } from './user-identities.js';

const mockedDeps = vi.hoisted(() => {
	return {
		logger: { warn: vi.fn() },
		createUser: vi.fn(),
		updateUser: vi.fn(),
		createIdentity: vi.fn(),
		updateIdentity: vi.fn(),
	};
});

const scopedCache = vi.hoisted(() => {
	return { purgeEnabled: false, purgeForMutatedRows: vi.fn() };
});

vi.mock('../../extensions/lib/scoped-cache-handle.js', () => {
	return {
		createScopedCacheExtensionHandle: () => {
			return { purgeForMutatedRows: scopedCache.purgeForMutatedRows };
		},
	};
});

vi.mock('../../scoped-cache/config.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../../scoped-cache/config.js')>(),
		scopedCachePurgeEnabled: () => scopedCache.purgeEnabled,
	};
});

vi.mock('../../logger/index.js', () => {
	return {
		useLogger: () => mockedDeps.logger,
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
				createOne: mockedDeps.createUser,
				updateOne: mockedDeps.updateUser,
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

vi.mock('./user-identities.js', async (importOriginal) => {
	return {
		...await importOriginal<object>(),
		fetchIdentity: vi.fn(),
		fetchIdentityById: vi.fn(),
	};
});

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
	scopedCache.purgeEnabled = false;
});

describe('toStoredUserInfo', () => {
	test('keeps no user info when the provider sent none', () => {
		expect(toStoredUserInfo(null)).toBe(null);
	});

	test('drops every token claim', () => {
		expect(toStoredUserInfo({
			sub: 'ada-sub',
			email: 'ada@example.com',
			access_token: 'access',
			id_token: 'id',
			refresh_token: 'refresh',
			accessToken: 'access',
			idToken: 'id',
			refreshToken: 'refresh',
		})).toStrictEqual({ sub: 'ada-sub', email: 'ada@example.com' });
	});
});

describe('updateIdentityAuthData', () => {
	test('writes the rotated refresh token on the identity', async () => {
		await updateIdentityAuthData(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			'identity-1',
			'{"refreshToken":"rotated"}',
		);

		expect(mockedDeps.updateIdentity.mock.calls).toStrictEqual([[
			'identity-1',
			{ auth_data: '{"refreshToken":"rotated"}' },
		]]);
	});
});

describe('loginSsoIdentity from a session', () => {
	test('refuses an identity another account holds', async () => {
		vi.mocked(fetchIdentity).mockResolvedValueOnce({
			id: 'identity-1',
			user: 'other-user',
			kind: 'github',
			value: 'ada-sub',
		} as any);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: undefined,
				emailVerified: false,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: {},
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: 'session-user',
			},
		)).rejects.toStrictEqual(new RecordNotUniqueError({
			collection: 'directus_user_identities',
			field: 'value',
			value: null,
		}));

		expect(mockedDeps.createIdentity).not.toHaveBeenCalled();
		expect(mockedDeps.updateIdentity).not.toHaveBeenCalled();
	});

	test('links a new identity and its email to the session account', async () => {
		vi.mocked(fetchIdentity)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);

		mockedDeps.createIdentity
			.mockResolvedValueOnce('identity-2')
			.mockResolvedValueOnce('identity-3');

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-2',
			user: 'session-user',
			kind: 'github',
			value: 'ada-sub',
		} as any);

		knexTracker.on.update('directus_users').response(1);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: true,
				emailUnverified: false,
				userInfo: { sub: 'ada-sub', access_token: 'access' },
				scope: 'read:user',
				updatePayload: { auth_data: '{"refreshToken":"first"}' },
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: 'session-user',
			},
		)).resolves.toStrictEqual({
			id: 'identity-2',
			user: 'session-user',
			kind: 'github',
			value: 'ada-sub',
		});

		expect(mockedDeps.createIdentity.mock.calls).toStrictEqual([
			[{
				user: 'session-user',
				kind: 'github',
				value: 'ada-sub',
				verified: true,
				auth_data: '{"refreshToken":"first"}',
				user_info: { sub: 'ada-sub' },
				scope: 'read:user',
			}],
			[{
				user: 'session-user',
				kind: 'email',
				value: 'ada@example.com',
				verified: true,
			}],
		]);

		expect(knexTracker.history.update[0]!.sql).toBe(
			'update "directus_users" set "primary_identity" = ? '
			+ 'where "id" = ? and "primary_identity" is null',
		);

		expect(knexTracker.history.update[0]!.bindings)
			.toStrictEqual(['identity-3', 'session-user']);

		expect(fetchIdentityById).toHaveBeenCalledWith(mockedKnex, 'identity-2');
	});

	test('links an identity without email and no auth data', async () => {
		vi.mocked(fetchIdentity).mockResolvedValueOnce(undefined);
		mockedDeps.createIdentity.mockResolvedValueOnce('identity-2');

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-2',
			user: 'session-user',
		} as any);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: undefined,
				emailVerified: false,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: {},
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: 'session-user',
			},
		)).resolves.toStrictEqual({ id: 'identity-2', user: 'session-user' });

		expect(mockedDeps.createIdentity.mock.calls).toStrictEqual([[{
			user: 'session-user',
			kind: 'github',
			value: 'ada-sub',
			verified: true,
			auth_data: null,
			user_info: null,
			scope: null,
		}]]);

		expect(knexTracker.history.update).toStrictEqual([]);
	});
});

describe('loginSsoIdentity for a new account', () => {
	test('refuses when public registration is off', async () => {
		vi.mocked(fetchIdentity).mockResolvedValueOnce(undefined);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: true,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: {},
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: false,
				linkUser: null,
			},
		)).rejects.toStrictEqual(new InvalidCredentialsError());

		expect(mockedDeps.logger.warn.mock.calls).toStrictEqual([[
			'[OAuth2] User doesn\'t exist, and public registration not allowed'
			+ ' for provider "github"',
		]]);

		expect(mockedDeps.createUser).not.toHaveBeenCalled();
	});

	test('takes the login identifier when the hook drops it', async () => {
		vi.mocked(fetchIdentity).mockResolvedValueOnce(undefined);
		mockedDeps.createUser.mockResolvedValueOnce('new-user');
		mockedDeps.createIdentity.mockResolvedValueOnce('identity-4');

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-4',
			user: 'new-user',
		} as any);

		knexTracker.on.update('directus_users').response(1);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: undefined,
				emailVerified: false,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: {},
				createPayload: { provider: 'github', first_name: 'Ada' },
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: null,
			},
		)).resolves.toStrictEqual({ id: 'identity-4', user: 'new-user' });

		expect(mockedDeps.createUser.mock.calls)
			.toStrictEqual([[{ first_name: 'Ada' }]]);

		expect(mockedDeps.createIdentity.mock.calls).toStrictEqual([[{
			user: 'new-user',
			kind: 'github',
			value: 'ada-sub',
			verified: true,
			auth_data: null,
			user_info: null,
			scope: null,
		}]]);

		expect(knexTracker.history.update[0]!.bindings)
			.toStrictEqual(['identity-4', 'new-user']);
	});
});

describe('loginSsoIdentity syncing the email of a known account', () => {
	test('purges the account a new email became the primary identity of', async () => {
		scopedCache.purgeEnabled = true;

		vi.mocked(fetchIdentity)
			.mockResolvedValueOnce({
				id: 'identity-1',
				user: 'known-user',
				kind: 'github',
				value: 'ada-sub',
			} as any)
			.mockResolvedValueOnce(undefined);

		mockedDeps.createIdentity.mockResolvedValueOnce('email-identity');

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-1',
			user: 'known-user',
		} as any);

		knexTracker.on.update('directus_users').response(1);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: true,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: { email: 'ada@example.com' },
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: null,
			},
		)).resolves.toStrictEqual({ id: 'identity-1', user: 'known-user' });

		expect(scopedCache.purgeForMutatedRows.mock.calls).toStrictEqual([
			['directus_users', [{ id: 'known-user' }]],
		]);
	});

	test('verifies the account\'s own unverified email', async () => {
		vi.mocked(fetchIdentity)
			.mockResolvedValueOnce({
				id: 'identity-1',
				user: 'known-user',
				kind: 'github',
				value: 'ada-sub',
			} as any)
			.mockResolvedValueOnce({
				id: 'email-identity',
				user: 'known-user',
				kind: 'email',
				value: 'ada@example.com',
				verified: false,
			} as any);

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-1',
			user: 'known-user',
		} as any);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: true,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: { email: 'ada@example.com' },
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: null,
			},
		)).resolves.toStrictEqual({ id: 'identity-1', user: 'known-user' });

		expect(mockedDeps.updateIdentity.mock.calls).toStrictEqual([
			['identity-1', { user_info: null, scope: null }],
			['email-identity', { verified: true }],
		]);

		expect(mockedDeps.createIdentity).not.toHaveBeenCalled();
	});

	test('keeps the own email unverified without the provider vouching', async () => {
		vi.mocked(fetchIdentity)
			.mockResolvedValueOnce({
				id: 'identity-1',
				user: 'known-user',
				kind: 'github',
				value: 'ada-sub',
			} as any)
			.mockResolvedValueOnce({
				id: 'email-identity',
				user: 'known-user',
				kind: 'email',
				value: 'ada@example.com',
				verified: false,
			} as any);

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-1',
			user: 'known-user',
		} as any);

		await loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: false,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: { email: 'ada@example.com' },
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: null,
			},
		);

		expect(mockedDeps.updateIdentity.mock.calls).toStrictEqual([
			['identity-1', { user_info: null, scope: null }],
		]);
	});

	test('passes and warns on an email another account holds', async () => {
		vi.mocked(fetchIdentity)
			.mockResolvedValueOnce({
				id: 'identity-1',
				user: 'known-user',
				kind: 'github',
				value: 'ada-sub',
			} as any)
			.mockResolvedValueOnce({
				id: 'email-identity',
				user: 'other-user',
				kind: 'email',
				value: 'ada@example.com',
				verified: true,
			} as any);

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-1',
			user: 'known-user',
		} as any);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: true,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: { email: 'ada@example.com' },
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: null,
			},
		)).resolves.toStrictEqual({ id: 'identity-1', user: 'known-user' });

		expect(mockedDeps.logger.warn.mock.calls).toStrictEqual([[
			'[OAuth2] Email held by another user not synced for provider "github"',
		]]);

		expect(mockedDeps.createIdentity).not.toHaveBeenCalled();
	});

	test('passes and warns when another account takes the email first', async () => {
		vi.mocked(fetchIdentity)
			.mockResolvedValueOnce({
				id: 'identity-1',
				user: 'known-user',
				kind: 'github',
				value: 'ada-sub',
			} as any)
			.mockResolvedValueOnce(undefined);

		mockedDeps.createIdentity.mockRejectedValueOnce(new RecordNotUniqueError({
			collection: 'directus_user_identities',
			field: 'value',
			value: 'ada@example.com',
		}));

		vi.mocked(fetchIdentityById).mockResolvedValueOnce({
			id: 'identity-1',
			user: 'known-user',
		} as any);

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: true,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: { email: 'ada@example.com' },
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: null,
			},
		)).resolves.toStrictEqual({ id: 'identity-1', user: 'known-user' });

		expect(mockedDeps.logger.warn.mock.calls).toStrictEqual([[
			'[OAuth2] Email held by another user not synced for provider "github"',
		]]);

		expect(knexTracker.history.update).toStrictEqual([]);
	});

	test('rethrows any other email write failure', async () => {
		vi.mocked(fetchIdentity)
			.mockResolvedValueOnce({
				id: 'identity-1',
				user: 'known-user',
				kind: 'github',
				value: 'ada-sub',
			} as any)
			.mockResolvedValueOnce(undefined);

		mockedDeps.createIdentity
			.mockRejectedValueOnce(new Error('connection reset'));

		await expect(loginSsoIdentity(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				logPrefix: '[OAuth2]',
				provider: 'github',
				identifier: 'ada-sub',
				email: 'ada@example.com',
				emailVerified: true,
				emailUnverified: false,
				userInfo: null,
				scope: null,
				updatePayload: { email: 'ada@example.com' },
				createPayload: {},
				hookMeta: {},
				allowPublicRegistration: true,
				linkUser: null,
			},
		)).rejects.toStrictEqual(new Error('connection reset'));

		expect(mockedDeps.logger.warn).not.toHaveBeenCalled();
	});
});
