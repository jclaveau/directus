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
		knexTracker.on.select('directus_users').response(undefined);
		mockedDeps.createOne.mockResolvedValue('user-1');

		const userId = await new SAMLAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'saml',
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
				identifierKey: 'uid',
				emailKey: 'mail',
				givenNameKey: 'givenName',
				familyNameKey: 'sn',
			},
		).getUserID({
			uid: 'Ada',
			mail: 'ada@example.com',
			givenName: 'Ada',
			sn: 'Lovelace',
		});

		expect(userId).toBe('user-1');

		expect(mockedDeps.createOne.mock.calls).toEqual([[{
			provider: 'saml',
			first_name: 'Ada',
			last_name: 'Lovelace',
			email: 'ada@example.com',
			external_identifier: 'ada',
			roles: [{ role: 'role-default', managed_by: null }],
		}]]);
	});

	test('logs in a known user without touching their role', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });

		const userId = await new SAMLAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				provider: 'saml',
				allowPublicRegistration: true,
				defaultRoleId: 'role-default',
				identifierKey: 'uid',
			},
		).getUserID({ uid: 'Ada' });

		expect(userId).toBe('user-1');
		expect(mockedDeps.createOne).not.toHaveBeenCalled();
	});
});
