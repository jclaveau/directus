import {
	InvalidCredentialsError,
	InvalidPayloadError,
	InvalidProviderConfigError,
	InvalidProviderError,
	RecordNotUniqueError,
	ServiceUnavailableError,
	UnexpectedResponseError,
} from '@directus/errors';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import ldap from 'ldapjs';
import { EventEmitter } from 'node:events';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import {
	REFRESH_COOKIE_OPTIONS,
	SESSION_COOKIE_OPTIONS,
} from '../../constants.js';
import emitter from '../../emitter.js';
import { createLDAPAuthRouter, LDAPAuthDriver } from './ldap.js';

const mockedDeps = vi.hoisted(() => {
	return {
		ldapClient: {
			on: vi.fn(),
			search: vi.fn(),
			bind: vi.fn(),
			destroy: vi.fn(),
		},
		logger: { warn: vi.fn(), error: vi.fn() },
		updateOne: vi.fn(),
		createOne: vi.fn(),
		login: vi.fn(),
	};
});

vi.mock('ldapjs', async (importOriginal) => {
	const actualLdap = await importOriginal<{ default: object }>();

	return {
		default: {
			...actualLdap.default,
			createClient: vi.fn(() => mockedDeps.ldapClient),
		},
	};
});

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
			return { updateOne: mockedDeps.updateOne, createOne: mockedDeps.createOne };
		}),
	};
});

vi.mock('../../services/authentication.js', () => {
	return {
		AuthenticationService: vi.fn(function () {
			return { login: mockedDeps.login };
		}),
	};
});

vi.mock('../../middleware/respond.js', () => ({ respond: vi.fn() }));

type SearchEvent = [string, unknown?];

/** Answer the next `client.search` with these response events, in order. */
function replySearch(...searchEvents: SearchEvent[]) {
	mockedDeps.ldapClient.search.mockImplementationOnce(
		(_baseDn: string, _searchOptions: unknown, searchCallback: any) => {
			const searchResponse = new EventEmitter();
			searchCallback(null, searchResponse);

			for (const [eventName, eventPayload] of searchEvents) {
				searchResponse.emit(eventName, eventPayload);
			}
		},
	);
}

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

describe('LDAPAuthDriver constructor', () => {
	test('refuses a config without bindDn', () => {
		expect(() => {
			return new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);
		}).toThrow(new InvalidProviderConfigError({ provider: 'ldap' }));

		expect(mockedDeps.logger.error).toHaveBeenCalledWith('Invalid provider config');
	});

	test('refuses a config without bindPassword', () => {
		expect(() => {
			return new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);
		}).toThrow(new InvalidProviderConfigError({ provider: 'ldap' }));
	});

	test('refuses a config without userDn', () => {
		expect(() => {
			return new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);
		}).toThrow(new InvalidProviderConfigError({ provider: 'ldap' }));
	});

	test('refuses a config without provider', () => {
		expect(() => {
			return new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					clientUrl: 'ldap://ldap.example',
				},
			);
		}).toThrow(new InvalidProviderConfigError({ provider: undefined as any }));
	});

	test('refuses a config with neither clientUrl nor socketPath', () => {
		expect(() => {
			return new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					client: { timeout: 5 },
				},
			);
		}).toThrow(new InvalidProviderConfigError({ provider: 'ldap' }));
	});

	test('accepts a socketPath client in place of clientUrl', () => {
		new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				client: { socketPath: '/run/ldap.sock' },
			},
		);

		expect(ldap.createClient).toHaveBeenCalledWith({
			url: undefined,
			reconnect: true,
			socketPath: '/run/ldap.sock',
		});
	});

	test('ignores a client config that is not an object', () => {
		new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
				client: 'not-an-object',
			},
		);

		expect(ldap.createClient).toHaveBeenCalledWith({
			url: 'ldap://ldap.example',
			reconnect: true,
		});
	});

	test('logs a bind client error as a warning', () => {
		new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		expect(mockedDeps.ldapClient.on).toHaveBeenCalledWith(
			'error',
			expect.any(Function),
		);

		mockedDeps.ldapClient.on.mock.calls[0]![1]('connection reset');

		expect(mockedDeps.logger.warn).toHaveBeenCalledWith('connection reset');
	});
});

describe('LDAPAuthDriver.getUserID', () => {
	test('refuses a payload without identifier', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		await expect(ldapDriver.getUserID({})).rejects.toStrictEqual(
			new InvalidCredentialsError(),
		);
	});

	describe('bind user healthcheck', () => {
		test('reports a rejected bind user search as invalid credentials', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			mockedDeps.ldapClient.search.mockImplementationOnce(
				(_baseDn: string, _searchOptions: unknown, searchCallback: any) => {
					searchCallback(new ldap.InvalidCredentialsError('bad bind'));
				},
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());

			expect(mockedDeps.ldapClient.search).toHaveBeenCalledWith(
				'cn=admin',
				{},
				expect.any(Function),
			);
		});

		test('reports any other search failure as ldap unavailable', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			mockedDeps.ldapClient.search.mockImplementationOnce(
				(_baseDn: string, _searchOptions: unknown, searchCallback: any) => {
					searchCallback(new ldap.BusyError('server busy'));
				},
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new ServiceUnavailableError({
					service: 'ldap',
					reason: 'Service returned unexpected error: server busy',
				}));
		});

		test('maps inappropriate authentication to invalid credentials', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			mockedDeps.ldapClient.search.mockImplementationOnce(
				(_baseDn: string, _searchOptions: unknown, searchCallback: any) => {
					searchCallback(new ldap.InappropriateAuthenticationError('anon'));
				},
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());
		});

		test('maps insufficient access rights to invalid credentials', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			mockedDeps.ldapClient.search.mockImplementationOnce(
				(_baseDn: string, _searchOptions: unknown, searchCallback: any) => {
					searchCallback(new ldap.InsufficientAccessRightsError('no read'));
				},
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());
		});

		test('refuses when the bind user cannot read its own record', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['end', { status: 32 }]);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new UnexpectedResponseError());

			expect(mockedDeps.logger.warn).toHaveBeenCalledWith(
				'[LDAP] Failed to find bind user record',
			);
		});

		test('refuses when the bind search ends without a result', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['end', null]);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new UnexpectedResponseError());
		});

		test('lets a successful bind search end before its entry', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['end', { status: 0 }], ['searchEntry']);
			replySearch(['end']);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());

			expect(mockedDeps.ldapClient.search).toHaveBeenCalledTimes(2);
			expect(mockedDeps.logger.warn).not.toHaveBeenCalled();
		});

		test('rebinds after a search error, then looks the user up', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['error', new Error('connection lost')]);

			mockedDeps.ldapClient.bind.mockImplementationOnce(
				(_bindDn: string, _bindPassword: string, bindCallback: any) => {
					bindCallback(null);
				},
			);

			replySearch(['end']);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());

			expect(mockedDeps.ldapClient.bind).toHaveBeenCalledWith(
				'cn=admin',
				'secret',
				expect.any(Function),
			);

			expect(mockedDeps.ldapClient.search).toHaveBeenCalledTimes(2);
		});

		test('reports a rebind with bad credentials as an invalid config', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'wrong',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['error', new Error('connection lost')]);

			mockedDeps.ldapClient.bind.mockImplementationOnce(
				(_bindDn: string, _bindPassword: string, bindCallback: any) =>
					bindCallback(new ldap.InvalidCredentialsError('bad bind')),
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(
					new InvalidProviderConfigError({ provider: 'ldap' }),
				);

			expect(mockedDeps.logger.warn).toHaveBeenCalledWith('Invalid bind user');
		});

		test('reports any other rebind failure as ldap unavailable', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['error', new Error('connection lost')]);

			mockedDeps.ldapClient.bind.mockImplementationOnce(
				(_bindDn: string, _bindPassword: string, bindCallback: any) =>
					bindCallback(new ldap.UnavailableError('down')),
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new ServiceUnavailableError({
					service: 'ldap',
					reason: 'Service returned unexpected error: down',
				}));
		});
	});

	describe('user lookup', () => {
		test('searches one level under userDn by cn by default', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);
			replySearch(['end']);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());

			expect(mockedDeps.ldapClient.search).toHaveBeenLastCalledWith(
				'ou=users,dc=example',
				{
					filter: expect.objectContaining({
						attribute: 'cn',
						value: 'jdoe',
					}),
					scope: 'one',
					attributes: ['uid', 'givenName', 'sn', 'mail', 'userAccountControl'],
				},
				expect.any(Function),
			);
		});

		test('searches with the configured attributes and scope', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					userAttribute: 'uid',
					userScope: 'sub',
					firstNameAttribute: 'first',
					lastNameAttribute: 'last',
					mailAttribute: 'email',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);
			replySearch(['end']);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());

			expect(mockedDeps.ldapClient.search).toHaveBeenLastCalledWith(
				'ou=users,dc=example',
				{
					filter: expect.objectContaining({
						attribute: 'uid',
						value: 'jdoe',
					}),
					scope: 'sub',
					attributes: ['uid', 'first', 'last', 'email', 'userAccountControl'],
				},
				expect.any(Function),
			);
		});

		test('refuses when the user search is rejected', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			mockedDeps.ldapClient.search.mockImplementationOnce(
				(_baseDn: string, _searchOptions: unknown, searchCallback: any) => {
					searchCallback(new ldap.BusyError('server busy'));
				},
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new ServiceUnavailableError({
					service: 'ldap',
					reason: 'Service returned unexpected error: server busy',
				}));
		});

		test('refuses when the user search errors midway', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);
			replySearch(['error', new Error('size limit')]);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new ServiceUnavailableError({
					service: 'ldap',
					reason: 'Service returned unexpected error: size limit',
				}));
		});
	});

	describe('existing user', () => {
		test('updates nothing but the hook payload when nothing syncs', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: {
					objectName: 'cn=jdoe,ou=users,dc=example',
					attributes: [],
				},
			}]);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.resolves.toBe('user-1');

			expect(vi.mocked(emitter.emitFilter).mock.calls[0]).toStrictEqual([
				'auth.update',
				{},
				{
					identifier: 'cn=jdoe,ou=users,dc=example',
					provider: 'ldap',
					providerPayload: {
						userInfo: {
							dn: 'cn=jdoe,ou=users,dc=example',
							userAccountControl: 0,
						},
						userRole: undefined,
					},
				},
				{
					database: 'database-handle',
					schema: { collections: {}, relations: [] },
					accountability: null,
				},
			]);

			expect(mockedDeps.updateOne.mock.calls).toStrictEqual([['user-1', {}]]);
			expect(mockedDeps.createOne).not.toHaveBeenCalled();

			expect(knexTracker.history.select[0]!.bindings).toEqual([
				'cn=jdoe,ou=users,dc=example',
				1,
			]);
		});

		test('matches the stored identifier case-insensitively', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'CN=JDoe,OU=Users,DC=Example', attributes: [] },
			}]);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(knexTracker.history.select[0]!.sql).toBe(
				'select "id" from "directus_users" '
				+ 'where LOWER("external_identifier") = ? limit ?',
			);

			expect(knexTracker.history.select[0]!.bindings).toEqual([
				'cn=jdoe,ou=users,dc=example',
				1,
			]);
		});

		test('syncs the user info read from LDAP when syncUserInfo is on', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
					syncUserInfo: true,
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: {
					objectName: 'cn=jdoe,ou=users,dc=example',
					attributes: [
						{ type: 'givenName', values: ['John'] },
						{ type: 'sn', values: ['Doe'] },
						{ type: 'mail', values: ['john@example.com', 'jd@example.com'] },
						{ type: 'uid', values: ['jdoe'] },
						{ type: 'userAccountControl', values: ['512'] },
					],
				},
			}]);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.resolves.toBe('user-1');

			expect(mockedDeps.updateOne).toHaveBeenCalledWith('user-1', {
				first_name: 'John',
				last_name: 'Doe',
				email: 'john@example.com',
			});

			expect(vi.mocked(emitter.emitFilter).mock.calls[0]![2]).toEqual({
				identifier: 'cn=jdoe,ou=users,dc=example',
				provider: 'ldap',
				providerPayload: {
					userInfo: {
						dn: 'cn=jdoe,ou=users,dc=example',
						userAccountControl: 512,
						firstName: 'John',
						lastName: 'Doe',
						email: 'john@example.com',
						uid: 'jdoe',
					},
					userRole: undefined,
				},
			});
		});

		test('updates with what the auth.update hook returns', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			vi.mocked(emitter.emitFilter).mockResolvedValueOnce({
				title: 'Engineer',
			});

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(mockedDeps.updateOne).toHaveBeenCalledWith('user-1', {
				title: 'Engineer',
			});
		});

		test('syncs the role of the first matching LDAP group', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			replySearch(
				['searchEntry', {
					pojo: { attributes: [{ type: 'cn', values: ['Editors'] }] },
				}],
				['searchEntry', {
					pojo: { attributes: [{ type: 'cn', values: ['Ops', 'Admins'] }] },
				}],
				['searchEntry', { pojo: { attributes: [] } }],
				['end'],
			);

			knexTracker.on.select('directus_roles').response({ id: 'role-editor' });
			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.resolves.toBe('user-1');

			expect(mockedDeps.ldapClient.search).toHaveBeenNthCalledWith(
				3,
				'ou=groups,dc=example',
				{
					filter: expect.objectContaining({
						attribute: 'member',
						value: 'cn=jdoe,ou=users,dc=example',
					}),
					scope: 'one',
					attributes: ['cn'],
				},
				expect.any(Function),
			);

			expect(knexTracker.history.select[0]!.sql).toBe(
				'select "id" from "directus_roles" '
				+ 'where LOWER("name") IN (?,?,?) limit ?',
			);

			expect(knexTracker.history.select[0]!.bindings).toEqual([
				'editors',
				'ops',
				'admins',
				1,
			]);

			expect(mockedDeps.updateOne).toHaveBeenCalledWith('user-1', {
				role: 'role-editor',
			});
		});

		test('matches groups by uid when groupAttribute is memberUid', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					groupAttribute: 'memberUid',
					groupScope: 'sub',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: {
					objectName: 'cn=jdoe,ou=users,dc=example',
					attributes: [{ type: 'uid', values: ['jdoe'] }],
				},
			}]);

			replySearch(['end']);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(mockedDeps.ldapClient.search).toHaveBeenNthCalledWith(
				3,
				'ou=groups,dc=example',
				{
					filter: expect.objectContaining({
						attribute: 'memberUid',
						value: 'jdoe',
					}),
					scope: 'sub',
					attributes: ['cn'],
				},
				expect.any(Function),
			);
		});

		test('matches memberUid groups by dn when the user has no uid', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					groupAttribute: 'memberUid',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			replySearch(['end']);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(mockedDeps.ldapClient.search).toHaveBeenNthCalledWith(
				3,
				'ou=groups,dc=example',
				{
					filter: expect.objectContaining({
						attribute: 'memberUid',
						value: 'cn=jdoe,ou=users,dc=example',
					}),
					scope: 'one',
					attributes: ['cn'],
				},
				expect.any(Function),
			);
		});

		test('falls back to defaultRoleId when no group matches', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					defaultRoleId: 'role-default',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			replySearch(['end']);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(knexTracker.history.select).toHaveLength(1);

			expect(mockedDeps.updateOne).toHaveBeenCalledWith('user-1', {
				role: 'role-default',
			});
		});

		test('clears the role when no group matches and no default exists', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			replySearch(['end']);

			knexTracker.on.select('directus_users').response({ id: 'user-1' });

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(mockedDeps.updateOne).toHaveBeenCalledWith('user-1', { role: null });
		});

		test('refuses when the group search is rejected', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			mockedDeps.ldapClient.search.mockImplementationOnce(
				(_baseDn: string, _searchOptions: unknown, searchCallback: any) => {
					searchCallback(new ldap.BusyError('server busy'));
				},
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new ServiceUnavailableError({
					service: 'ldap',
					reason: 'Service returned unexpected error: server busy',
				}));

			expect(mockedDeps.updateOne).not.toHaveBeenCalled();
		});

		test('refuses when the group search errors midway', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			replySearch(['error', new Error('size limit')]);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new ServiceUnavailableError({
					service: 'ldap',
					reason: 'Service returned unexpected error: size limit',
				}));
		});
	});

	describe('new user', () => {
		test('creates the user from LDAP info and returns its new id', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					groupDn: 'ou=groups,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: {
					objectName: 'cn=jdoe,ou=users,dc=example',
					attributes: [
						{ type: 'givenName', values: ['John'] },
						{ type: 'sn', values: ['Doe'] },
						{ type: 'mail', values: ['john@example.com'] },
					],
				},
			}]);

			replySearch(
				['searchEntry', {
					pojo: { attributes: [{ type: 'cn', values: ['Editors'] }] },
				}],
				['end'],
			);

			knexTracker.on.select('directus_roles').response({ id: 'role-editor' });

			knexTracker.on.select('directus_users').responseOnce(undefined);
			knexTracker.on.select('directus_users').response({ id: 'user-new' });

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.resolves.toBe('user-new');

			expect(emitter.emitFilter).toHaveBeenCalledWith(
				'auth.create',
				{
					provider: 'ldap',
					first_name: 'John',
					last_name: 'Doe',
					email: 'john@example.com',
					external_identifier: 'cn=jdoe,ou=users,dc=example',
					role: 'role-editor',
				},
				{
					identifier: 'cn=jdoe,ou=users,dc=example',
					provider: 'ldap',
					providerPayload: {
						userInfo: {
							dn: 'cn=jdoe,ou=users,dc=example',
							userAccountControl: 0,
							firstName: 'John',
							lastName: 'Doe',
							email: 'john@example.com',
						},
						userRole: { id: 'role-editor' },
					},
				},
				{
					database: 'database-handle',
					schema: { collections: {}, relations: [] },
					accountability: null,
				},
			);

			expect(mockedDeps.createOne).toHaveBeenCalledWith({
				provider: 'ldap',
				first_name: 'John',
				last_name: 'Doe',
				email: 'john@example.com',
				external_identifier: 'cn=jdoe,ou=users,dc=example',
				role: 'role-editor',
			});

			expect(mockedDeps.updateOne).not.toHaveBeenCalled();
		});

		test('creates the user with defaultRoleId when no group matches', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					defaultRoleId: 'role-default',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			knexTracker.on.select('directus_users').responseOnce(undefined);
			knexTracker.on.select('directus_users').response({ id: 'user-new' });

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(mockedDeps.createOne).toHaveBeenCalledWith({
				provider: 'ldap',
				first_name: undefined,
				last_name: undefined,
				email: undefined,
				external_identifier: 'cn=jdoe,ou=users,dc=example',
				role: 'role-default',
			});
		});

		test('creates with what the auth.create hook returns', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			knexTracker.on.select('directus_users').responseOnce(undefined);
			knexTracker.on.select('directus_users').response({ id: 'user-new' });

			vi.mocked(emitter.emitFilter).mockResolvedValueOnce({
				external_identifier: 'cn=jdoe,ou=users,dc=example',
				status: 'draft',
			});

			await ldapDriver.getUserID({ identifier: 'jdoe' });

			expect(mockedDeps.createOne).toHaveBeenCalledWith({
				external_identifier: 'cn=jdoe,ou=users,dc=example',
				status: 'draft',
			});
		});

		test('refuses a user that is not unique as an invalid provider', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			knexTracker.on.select('directus_users').response(undefined);

			const notUniqueError = new RecordNotUniqueError({
				collection: 'directus_users',
				field: 'email',
				value: 'john@example.com',
			});

			mockedDeps.createOne.mockRejectedValueOnce(notUniqueError);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(new InvalidProviderError());

			expect(mockedDeps.logger.warn).toHaveBeenCalledWith(
				notUniqueError,
				'[LDAP] Failed to register user. User not unique',
			);
		});

		test('rethrows any other create failure', async () => {
			const ldapDriver = new LDAPAuthDriver(
				{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
				{
					bindDn: 'cn=admin',
					bindPassword: 'secret',
					userDn: 'ou=users,dc=example',
					provider: 'ldap',
					clientUrl: 'ldap://ldap.example',
				},
			);

			replySearch(['searchEntry']);

			replySearch(['searchEntry', {
				pojo: { objectName: 'cn=jdoe,ou=users,dc=example', attributes: [] },
			}]);

			knexTracker.on.select('directus_users').response(undefined);

			mockedDeps.createOne.mockRejectedValueOnce(
				new InvalidPayloadError({ reason: 'Bad email' }),
			);

			await expect(ldapDriver.getUserID({ identifier: 'jdoe' }))
				.rejects.toStrictEqual(
					new InvalidPayloadError({ reason: 'Bad email' }),
				);
		});
	});
});

describe('LDAPAuthDriver.verify', () => {
	test('refuses a user without external identifier', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		await expect(ldapDriver.verify({ external_identifier: null } as any, 'pw'))
			.rejects.toStrictEqual(new InvalidCredentialsError());
	});

	test('refuses a missing password', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		await expect(ldapDriver.verify({ external_identifier: 'cn=jdoe' } as any))
			.rejects.toStrictEqual(new InvalidCredentialsError());
	});

	test('binds a fresh non-reconnecting client as the user', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
				client: { timeout: 5, reconnect: true },
			},
		);

		mockedDeps.ldapClient.bind.mockImplementationOnce(
			(_bindDn: string, _bindPassword: string, bindCallback: any) => {
				bindCallback(null);
			},
		);

		await expect(ldapDriver.verify({ external_identifier: 'cn=jdoe' } as any, 'pw'))
			.resolves.toBeUndefined();

		expect(ldap.createClient).toHaveBeenLastCalledWith({
			url: 'ldap://ldap.example',
			timeout: 5,
			reconnect: false,
		});

		expect(mockedDeps.ldapClient.bind).toHaveBeenCalledWith(
			'cn=jdoe',
			'pw',
			expect.any(Function),
		);

		expect(mockedDeps.ldapClient.destroy).toHaveBeenCalledOnce();
	});

	test('ignores a client config that is not an object', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
				client: 'not-an-object',
			},
		);

		mockedDeps.ldapClient.bind.mockImplementationOnce(
			(_bindDn: string, _bindPassword: string, bindCallback: any) => {
				bindCallback(null);
			},
		);

		await ldapDriver.verify({ external_identifier: 'cn=jdoe' } as any, 'pw');

		expect(ldap.createClient).toHaveBeenLastCalledWith({
			url: 'ldap://ldap.example',
			reconnect: false,
		});
	});

	test('refuses a wrong password and still destroys the client', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		mockedDeps.ldapClient.bind.mockImplementationOnce(
			(_bindDn: string, _bindPassword: string, bindCallback: any) =>
				bindCallback(new ldap.InvalidCredentialsError('bad password')),
		);

		await expect(ldapDriver.verify({ external_identifier: 'cn=jdoe' } as any, 'pw'))
			.rejects.toStrictEqual(new InvalidCredentialsError());

		expect(mockedDeps.ldapClient.destroy).toHaveBeenCalledOnce();
	});

	test('refuses when the user client errors', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		mockedDeps.ldapClient.on.mockImplementationOnce(
			(_eventName: string, errorListener: any) => {
				errorListener(new Error('ECONNREFUSED'));
			},
		);

		await expect(ldapDriver.verify({ external_identifier: 'cn=jdoe' } as any, 'pw'))
			.rejects.toStrictEqual(new ServiceUnavailableError({
				service: 'ldap',
				reason: 'Service returned unexpected error: ECONNREFUSED',
			}));
	});

	test('login verifies the payload password', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		mockedDeps.ldapClient.bind.mockImplementationOnce(
			(_bindDn: string, _bindPassword: string, bindCallback: any) => {
				bindCallback(null);
			},
		);

		await ldapDriver.login({ external_identifier: 'cn=jdoe' } as any, {
			password: 'pw',
		});

		expect(mockedDeps.ldapClient.bind).toHaveBeenCalledWith(
			'cn=jdoe',
			'pw',
			expect.any(Function),
		);
	});
});

describe('LDAPAuthDriver.refresh', () => {
	test('refuses a disabled account', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		replySearch(['searchEntry']);

		replySearch(['searchEntry', {
			pojo: {
				objectName: 'cn=jdoe,ou=users,dc=example',
				attributes: [{ type: 'userAccountControl', values: ['514'] }],
			},
		}]);

		await expect(ldapDriver.refresh({
			external_identifier: 'cn=jdoe,ou=users,dc=example',
		} as any)).rejects.toStrictEqual(new InvalidCredentialsError());

		expect(mockedDeps.ldapClient.search).toHaveBeenLastCalledWith(
			'cn=jdoe,ou=users,dc=example',
			{
				filter: undefined,
				scope: undefined,
				attributes: ['uid', 'givenName', 'sn', 'mail', 'userAccountControl'],
			},
			expect.any(Function),
		);
	});

	test('accepts a normal account', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		replySearch(['searchEntry']);

		replySearch(['searchEntry', {
			pojo: {
				objectName: 'cn=jdoe,ou=users,dc=example',
				attributes: [{ type: 'userAccountControl', values: ['512'] }],
			},
		}]);

		await expect(ldapDriver.refresh({
			external_identifier: 'cn=jdoe,ou=users,dc=example',
		} as any)).resolves.toBeUndefined();
	});

	test('accepts a user LDAP no longer returns', async () => {
		const ldapDriver = new LDAPAuthDriver(
			{ knex: mockedKnex, schema: { collections: {}, relations: [] } } as any,
			{
				bindDn: 'cn=admin',
				bindPassword: 'secret',
				userDn: 'ou=users,dc=example',
				provider: 'ldap',
				clientUrl: 'ldap://ldap.example',
			},
		);

		replySearch(['searchEntry']);
		replySearch(['end']);

		await expect(ldapDriver.refresh({
			external_identifier: 'cn=jdoe,ou=users,dc=example',
		} as any)).resolves.toBeUndefined();
	});
});

describe('createLDAPAuthRouter', () => {
	test('refuses a body without password', async () => {
		const ldapRouter = createLDAPAuthRouter('ldap');
		const nextHandler = vi.fn();

		await ldapRouter.stack[0]!.route!.stack[0]!.handle(
			{
				ip: '10.0.0.1',
				get: () => undefined,
				body: { identifier: 'jdoe' },
				schema: {},
			} as any,
			{ locals: {} } as any,
			nextHandler,
		);

		expect(nextHandler).toHaveBeenCalledWith(new InvalidPayloadError({
			reason: '"password" is required',
		}));

		expect(mockedDeps.login).not.toHaveBeenCalled();
	});

	test('answers both tokens in json mode by default', async () => {
		const ldapRouter = createLDAPAuthRouter('ldap');
		const nextHandler = vi.fn();
		const httpResponse = { locals: {} as Record<string, unknown>, cookie: vi.fn() };

		mockedDeps.login.mockResolvedValueOnce({
			accessToken: 'access-1',
			refreshToken: 'refresh-1',
			expires: 900000,
		});

		await ldapRouter.stack[0]!.route!.stack[0]!.handle(
			{
				ip: '10.0.0.1',
				get: (headerName: string) => {
					const requestHeaders: Record<string, string> = {
						'user-agent': 'curl/8.0',
						'origin': 'https://app.example',
					};

					return requestHeaders[headerName];
				},
				body: { identifier: 'jdoe', password: 'pw', otp: '123456' },
				schema: { collections: {} },
			} as any,
			httpResponse as any,
			nextHandler,
		);

		expect(mockedDeps.login).toHaveBeenCalledWith(
			'ldap',
			{ identifier: 'jdoe', password: 'pw', otp: '123456' },
			{ session: false, otp: '123456' },
		);

		expect(httpResponse.locals).toEqual({
			payload: {
				data: {
					access_token: 'access-1',
					expires: 900000,
					refresh_token: 'refresh-1',
				},
			},
		});

		expect(httpResponse.cookie).not.toHaveBeenCalled();
		expect(nextHandler).toHaveBeenCalledWith();
	});

	test('passes the client ip, user agent and origin as accountability', async () => {
		const { AuthenticationService } = await import(
			'../../services/authentication.js'
		);

		const ldapRouter = createLDAPAuthRouter('ldap');

		mockedDeps.login.mockResolvedValueOnce({
			accessToken: 'access-1',
			refreshToken: 'refresh-1',
			expires: 900000,
		});

		await ldapRouter.stack[0]!.route!.stack[0]!.handle(
			{
				ip: '10.0.0.1',
				get: (headerName: string) => {
					const requestHeaders: Record<string, string> = {
						'user-agent': 'curl/8.0',
						'origin': 'https://app.example',
					};

					return requestHeaders[headerName];
				},
				body: { identifier: 'jdoe', password: 'pw' },
				schema: { collections: {} },
			} as any,
			{ locals: {}, cookie: vi.fn() } as any,
			vi.fn(),
		);

		expect(AuthenticationService).toHaveBeenCalledWith({
			accountability: {
				role: null,
				user: null,
				roles: [],
				admin: false,
				app: false,
				ip: '10.0.0.1',
				userAgent: 'curl/8.0',
				origin: 'https://app.example',
			},
			schema: { collections: {} },
		});
	});

	test('sets the refresh cookie in cookie mode', async () => {
		const ldapRouter = createLDAPAuthRouter('ldap');
		const nextHandler = vi.fn();
		const httpResponse = { locals: {} as Record<string, unknown>, cookie: vi.fn() };

		mockedDeps.login.mockResolvedValueOnce({
			accessToken: 'access-1',
			refreshToken: 'refresh-1',
			expires: 900000,
		});

		await ldapRouter.stack[0]!.route!.stack[0]!.handle(
			{
				ip: '10.0.0.1',
				get: () => undefined,
				body: { identifier: 'jdoe', password: 'pw', mode: 'cookie' },
				schema: {},
			} as any,
			httpResponse as any,
			nextHandler,
		);

		expect(httpResponse.cookie).toHaveBeenCalledWith(
			'directus_refresh_token',
			'refresh-1',
			REFRESH_COOKIE_OPTIONS,
		);

		expect(httpResponse.locals).toEqual({
			payload: { data: { access_token: 'access-1', expires: 900000 } },
		});
	});

	test('sets the session cookie in session mode', async () => {
		const ldapRouter = createLDAPAuthRouter('ldap');
		const nextHandler = vi.fn();
		const httpResponse = { locals: {} as Record<string, unknown>, cookie: vi.fn() };

		mockedDeps.login.mockResolvedValueOnce({
			accessToken: 'access-1',
			refreshToken: 'refresh-1',
			expires: 900000,
		});

		await ldapRouter.stack[0]!.route!.stack[0]!.handle(
			{
				ip: '10.0.0.1',
				get: () => undefined,
				body: { identifier: 'jdoe', password: 'pw', mode: 'session' },
				schema: {},
			} as any,
			httpResponse as any,
			nextHandler,
		);

		expect(mockedDeps.login).toHaveBeenCalledWith(
			'ldap',
			{ identifier: 'jdoe', password: 'pw', mode: 'session' },
			{ session: true, otp: undefined },
		);

		expect(httpResponse.cookie).toHaveBeenCalledWith(
			'directus_session_token',
			'access-1',
			SESSION_COOKIE_OPTIONS,
		);

		expect(httpResponse.locals).toEqual({
			payload: { data: { access_token: 'access-1', expires: 900000 } },
		});
	});
});
