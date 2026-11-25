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

		const samlDriver = new SAMLAuthDriver(
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
		);

		const userId = await samlDriver.getUserID({
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
			role: 'role-default',
		}]]);
	});

	test('logs in a known user without touching their role', async () => {
		knexTracker.on.select('directus_users').response({ id: 'user-1' });

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
	});
});

describe('createSAMLAuthRouter /logout', () => {
	test('ends the session of its cookie and clears it', async () => {
		const { getAuthProvider } = await import('../../auth.js');

		const {
			AuthenticationService,
		} = await import('../../services/authentication.js');

		const { SESSION_COOKIE_OPTIONS } = await import('../../constants.js');
		const { createSAMLAuthRouter } = await import('./saml.js');
		const logout = vi.fn();

		vi.mocked(getAuthProvider).mockReturnValue({
			sp: {
				createLogoutRequest: vi.fn(() => {
					return { context: 'https://idp.example.com/logout' };
				}),
			},
			idp: {},
		} as any);

		vi.mocked(AuthenticationService).mockImplementation(function () {
			return { logout } as any;
		});

		const clearCookie = vi.fn();
		const redirect = vi.fn();

		await createSAMLAuthRouter('saml').stack.find(
			(l: any) => l.route?.path === '/logout' && l.route.methods['post'],
		)!.route!.stack[0]!.handle(
			{
				body: {},
				cookies: { directus_session_token: 'session-token' },
				schema: {},
			} as any,
			{ clearCookie, redirect } as any,
			vi.fn(),
		);

		expect(logout).toHaveBeenCalledWith('session-token');

		expect(clearCookie).toHaveBeenCalledWith(
			'directus_session_token',
			SESSION_COOKIE_OPTIONS,
		);

		expect(redirect).toHaveBeenCalledWith('https://idp.example.com/logout');
	});
});

describe('createSAMLAuthRouter /acs', () => {
	afterEach(async () => {
		const { useEnv } = await import('@directus/env');

		delete useEnv()['AUTH_SAML_MODE'];
	});

	test('sets the refresh cookie of a cookie-mode login', async () => {
		const { useEnv } = await import('@directus/env');
		const { getAuthProvider } = await import('../../auth.js');

		const {
			AuthenticationService,
		} = await import('../../services/authentication.js');

		const { REFRESH_COOKIE_OPTIONS } = await import('../../constants.js');
		const { createSAMLAuthRouter } = await import('./saml.js');

		useEnv()['AUTH_SAML_MODE'] = 'cookie';

		vi.mocked(getAuthProvider).mockReturnValue({
			sp: {
				parseLoginResponse: vi.fn(async () => {
					return { extract: { attributes: {} } };
				}),
			},
			idp: {},
		} as any);

		vi.mocked(AuthenticationService).mockImplementation(function () {
			return {
				login: vi.fn(async () => {
					return {
						accessToken: 'access-token',
						refreshToken: 'refresh-token',
						expires: 900_000,
					};
				}),
			} as any;
		});

		const cookie = vi.fn();
		const redirect = vi.fn();

		await createSAMLAuthRouter('saml').stack.find(
			(l: any) => l.route?.path === '/acs' && l.route.methods['post'],
		)!.route!.stack[1]!.handle(
			{
				body: { RelayState: 'https://app.example.com/' },
				schema: {},
			} as any,
			{ cookie, redirect, locals: {} } as any,
			vi.fn(),
		);

		expect(cookie).toHaveBeenCalledWith(
			'directus_refresh_token',
			'refresh-token',
			REFRESH_COOKIE_OPTIONS,
		);

		expect(redirect).toHaveBeenCalledWith('https://app.example.com/');
	});
});
