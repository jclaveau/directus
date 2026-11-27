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
import { SAMLAuthDriver } from './saml.js';

const mockedDeps = vi.hoisted(() => {
	return {
		logger: { warn: vi.fn(), error: vi.fn() },
		createOne: vi.fn(),
		createIdentity: vi.fn(),
		updateIdentity: vi.fn(),
	};
});

vi.mock('samlify', () => {
	return {
		setSchemaValidator: vi.fn(),
		ServiceProvider: vi.fn(() => ({})),
		IdentityProvider: vi.fn(() => ({})),
	};
});

vi.mock('@authenio/samlify-node-xmllint', () => ({}));

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
			return { createOne: mockedDeps.createOne };
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
});

describe('SAMLAuthDriver getUserID', () => {
	test('creates a first-login user with the default role', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'saml',
			value: 'ada',
		});

		knexTracker.on.select('directus_user_identities').response(undefined);
		knexTracker.on.update('directus_users').response(1);
		mockedDeps.createOne.mockResolvedValue('user-1');

		mockedDeps.createIdentity
			.mockResolvedValueOnce('identity-1')
			.mockResolvedValueOnce('identity-2');

		const samlDriver = new SAMLAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'saml',
				requireVerifiedEmail: false,
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
				identifierKey: 'uid',
				emailKey: 'mail',
				givenNameKey: 'givenName',
				familyNameKey: 'sn',
			},
		);

		const userId = await samlDriver.getUserID({
			uid: 'Ada',
			mail: 'ada@example.com',
			givenName: 'Ada',
			sn: 'Lovelace',
		});

		expect(userId).toBe('user-1');

		expect(mockedDeps.createOne.mock.calls).toEqual([[{
			first_name: 'Ada',
			last_name: 'Lovelace',
			role: 'role-default',
		}]]);

		expect(mockedDeps.createIdentity.mock.calls).toEqual([
			[{
				user: 'user-1',
				kind: 'saml',
				value: 'ada',
				verified: true,
				auth_data: null,
				user_info: {
					uid: 'Ada',
					mail: 'ada@example.com',
					givenName: 'Ada',
					sn: 'Lovelace',
				},
				scope: null,
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

	test('a first login with a verified email required creates no user', async () => {
		knexTracker.on.select('directus_user_identities').response(undefined);

		await expect(new SAMLAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'saml',
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
				identifierKey: 'uid',
				emailKey: 'mail',
			},
		).getUserID({ uid: 'Ada', mail: 'ada@example.com' }))
			.rejects.toThrow(new InvalidCredentialsError());

		expect(mockedDeps.logger.warn).toHaveBeenCalledExactlyOnceWith(
			'[SAML] Unverified email can\'t create a user for provider "saml"',
		);

		expect(mockedDeps.createOne).not.toHaveBeenCalled();
		expect(mockedDeps.createIdentity).not.toHaveBeenCalled();
	});

	test('logs in a known user without touching their role', async () => {
		knexTracker.on.select('"id" = ?').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'saml',
			value: 'ada',
		});

		knexTracker.on.select('directus_user_identities').response({
			id: 'identity-1',
			user: 'user-1',
			kind: 'saml',
			value: 'ada',
		});

		const samlDriver = new SAMLAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'saml',
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
				identifierKey: 'uid',
			},
		);

		const userId = await samlDriver.getUserID({ uid: 'Ada' });

		expect(userId).toBe('user-1');
		expect(mockedDeps.createOne).not.toHaveBeenCalled();
		expect(mockedDeps.createIdentity).not.toHaveBeenCalled();

		expect(mockedDeps.updateIdentity.mock.calls).toEqual([[
			'identity-1',
			{ user_info: { uid: 'Ada' }, scope: null },
		]]);
	});
});
