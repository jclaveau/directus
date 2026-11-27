import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { InvalidCredentialsError } from '@directus/errors';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
	return {
		scoped: true,
		purgeForMutatedRows: vi.fn(),
		provider: {
			identityKind: 'email',
			getIdentity: async () => {
				return {
					id: 'identity-1',
					user: 'u-1',
					kind: 'email',
					value: 'u-1@example.com',
					verified: true,
					auth_data: null,
					user_info: null,
					scope: null,
				};
			},
			login: async () => {
				throw new Error('wrong password');
			},
			refresh: vi.fn(),
			logout: vi.fn(),
		},
		providerNames: [] as string[],
		foundProviders: {} as Record<string, { verify: (...args: any[]) => any }>,
		passwordMatches: false,
	};
});

vi.mock('argon2', () => {
	return {
		default: { verify: async () => state.passwordMatches },
	};
});

vi.mock('../permissions/lib/fetch-roles-tree.js', () => {
	return { fetchRolesTree: async () => ['role-1'] };
});

vi.mock(
	'../permissions/modules/fetch-global-access/fetch-global-access.js',
	() => {
		return { fetchGlobalAccess: async () => ({ app: true, admin: false }) };
	},
);

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../auth.js', () => {
	return {
		getAuthProvider: (providerName: string) => {
			state.providerNames.push(providerName);

			return state.provider;
		},
		findAuthProvider: (providerName: string) => {
			return state.foundProviders[providerName];
		},
	};
});

vi.mock('../rate-limiter.js', () => {
	// A spent budget: the consume that suspends the user.
	class RateLimiterRes {
		remainingPoints = 0;
	}

	return {
		createRateLimiter: () => {
			return {
				set: vi.fn(),
				consume: async () => {
					throw new RateLimiterRes();
				},
			};
		},
		RateLimiterRes,
	};
});

vi.mock('./settings.js', () => {
	return {
		SettingsService: vi.fn(function () {
			return { readSingleton: async () => ({ auth_login_attempts: 1 }) };
		}),
	};
});

vi.mock('../utils/stall.js', () => {
	return { stall: async () => {} };
});

vi.mock('../extensions/lib/scoped-cache-handle.js', () => {
	return {
		createScopedCacheExtensionHandle: () => {
			return { purgeForMutatedRows: state.purgeForMutatedRows };
		},
	};
});

vi.mock('../scoped-cache/index.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../scoped-cache/index.js')>();

	return { ...actual, scopedCachePurgeEnabled: () => state.scoped };
});

const { AuthenticationService } = await import('./authentication.js');
const { ItemsService } = await import('./items.js');

const schema = new SchemaBuilder()
	.collection('directus_users', (c) => {
		c.field('id')
			.uuid()
			.primary();
	})
	.build();

describe('a login or a refresh touching last_access', () => {
	const db = knex.default({ client: MockClient });
	let tracker: Tracker;

	beforeEach(() => {
		tracker = createTracker(db);
		tracker.on.update('directus_users').response(1);
	});

	afterEach(() => {
		tracker.reset();
		vi.clearAllMocks();
	});

	it(oneLine`
		writes the stamp raw and purges the user's slices, since no hook heard the
		write
	`, async () => {
		state.scoped = true;
		const service = new AuthenticationService({ knex: db, schema });

		await (service as any).touchLastAccess('u-1');

		expect(tracker.history.update).toHaveLength(1);
		expect(tracker.history.update[0]!.bindings.at(-1)).toBe('u-1');

		expect(state.purgeForMutatedRows)
			.toHaveBeenCalledWith('directus_users', [{ id: 'u-1' }]);
	});

	it('leaves the cache alone in full mode, as upstream does', async () => {
		state.scoped = false;
		const service = new AuthenticationService({ knex: db, schema });

		await (service as any).touchLastAccess('u-1');

		expect(tracker.history.update).toHaveLength(1);
		expect(state.purgeForMutatedRows).not.toHaveBeenCalled();
	});
});

describe('a login spending the last attempt', () => {
	const db = knex.default({ client: MockClient });
	let tracker: Tracker;

	beforeEach(() => {
		tracker = createTracker(db);

		tracker.on.select('directus_users').response([
			{
				id: 'u-1',
				status: 'active',
				primary_identity: 'identity-1',
				tfa_secret: null,
			},
		]);
	});

	afterEach(() => {
		tracker.reset();
		vi.restoreAllMocks();
	});

	it(oneLine`
		suspends the user through ItemsService, so the purge sees the row before and
		after the write, with no hook as upstream's raw write had none
	`, async () => {
		const suspendCalls: unknown[] = [];

		vi.spyOn(ItemsService.prototype, 'updateOne')
			.mockImplementation(async function (
				this: InstanceType<typeof ItemsService>,
				key,
				data,
				opts,
			) {
				suspendCalls.push([
					this.collection,
					this.accountability,
					key,
					data,
					opts,
				]);

				return key;
			});

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.login('default', { password: 'nope' }))
			.rejects.toEqual(new Error('wrong password'));

		expect(suspendCalls).toEqual([
			[
				'directus_users',
				null,
				'u-1',
				{ status: 'suspended' },
				{ emitEvents: false },
			],
		]);
	});
});

describe('a login whose identity has no account', () => {
	const db = knex.default({ client: MockClient });
	let tracker: Tracker;

	beforeEach(() => {
		tracker = createTracker(db);
		tracker.on.select('directus_users').response(undefined);
	});

	afterEach(() => {
		tracker.reset();
	});

	it('refuses the credentials', async () => {
		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.login('default', { password: 'nope' }))
			.rejects.toStrictEqual(new InvalidCredentialsError());
	});
});

describe('a refresh calling the provider of the session identity', () => {
	const db = knex.default({ client: MockClient });
	let tracker: Tracker;

	beforeEach(() => {
		tracker = createTracker(db);
		tracker.on.update('directus_sessions').response(1);
		tracker.on.delete('directus_sessions').response(1);
		tracker.on.update('directus_users').response(1);
		state.scoped = false;
		state.providerNames = [];
		state.provider.refresh.mockClear();
	});

	afterEach(() => {
		tracker.reset();
	});

	it('refreshes through the identity provider with the identity', async () => {
		tracker.on.select('directus_sessions').response({
			session_expires: null,
			session_next_token: null,
			user_id: 'u-1',
			user_first_name: 'Ada',
			user_last_name: 'Lovelace',
			user_password: null,
			user_status: 'active',
			user_primary_identity: 'identity-7',
			user_role: 'role-1',
			identity_id: 'identity-7',
			identity_kind: 'github',
			identity_value: '4242',
			identity_verified: true,
			identity_auth_data: '{"refreshToken":"refresh-1"}',
			identity_user_info: { login: 'ada' },
			identity_scope: 'read:user',
			share_id: null,
			share_start: null,
			share_end: null,
		});

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.refresh('refresh-token'))
			.resolves.toMatchObject({ id: 'u-1' });

		expect(state.providerNames).toStrictEqual(['github']);

		expect(state.provider.refresh.mock.calls).toStrictEqual([[{
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: null,
			status: 'active',
			primary_identity: 'identity-7',
			identity: {
				id: 'identity-7',
				user: 'u-1',
				kind: 'github',
				value: '4242',
				verified: true,
				auth_data: '{"refreshToken":"refresh-1"}',
				user_info: { login: 'ada' },
				scope: 'read:user',
			},
			role: 'role-1',
			app_access: true,
			admin_access: false,
		}]]);
	});

	it(oneLine`
		refreshes a session that names no identity through the default provider
	`, async () => {
		tracker.on.select('directus_sessions').response({
			session_expires: null,
			session_next_token: null,
			user_id: 'u-1',
			user_first_name: 'Ada',
			user_last_name: 'Lovelace',
			user_password: 'hashed-password',
			user_status: 'active',
			user_primary_identity: null,
			user_role: 'role-1',
			identity_id: null,
			identity_kind: null,
			identity_value: null,
			identity_verified: null,
			identity_auth_data: null,
			identity_user_info: null,
			identity_scope: null,
			share_id: null,
			share_start: null,
			share_end: null,
		});

		const service = new AuthenticationService({ knex: db, schema });

		await service.refresh('refresh-token');

		expect(state.providerNames).toStrictEqual(['default']);

		expect(state.provider.refresh.mock.calls).toStrictEqual([[{
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: 'hashed-password',
			status: 'active',
			primary_identity: null,
			identity: null,
			role: 'role-1',
			app_access: true,
			admin_access: false,
		}]]);
	});

	it('refreshes a share session without any provider', async () => {
		tracker.on.select('directus_sessions').response({
			session_expires: null,
			session_next_token: null,
			user_id: null,
			user_role: null,
			identity_id: null,
			identity_kind: null,
			share_id: 'share-1',
			share_start: null,
			share_end: null,
		});

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.refresh('refresh-token'))
			.resolves.toMatchObject({ id: null });

		expect(state.providerNames).toStrictEqual([]);
		expect(state.provider.refresh).not.toHaveBeenCalled();
	});
});

describe('a logout calling the provider of the session identity', () => {
	const db = knex.default({ client: MockClient });
	let tracker: Tracker;

	beforeEach(() => {
		tracker = createTracker(db);
		tracker.on.delete('directus_sessions').response(1);
		state.providerNames = [];
		state.provider.logout.mockClear();
	});

	afterEach(() => {
		tracker.reset();
	});

	it('logs out through the identity provider with the identity', async () => {
		tracker.on.select('directus_sessions').response({
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: null,
			status: 'active',
			role: 'role-1',
			primary_identity: 'identity-7',
			identity_id: 'identity-7',
		});

		tracker.on.select('directus_user_identities').response({
			id: 'identity-7',
			user: 'u-1',
			kind: 'github',
			value: '4242',
		});

		const service = new AuthenticationService({ knex: db, schema });

		await service.logout('refresh-token');

		expect(state.providerNames).toStrictEqual(['github']);

		expect(state.provider.logout.mock.calls).toStrictEqual([[{
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: null,
			status: 'active',
			role: 'role-1',
			primary_identity: 'identity-7',
			identity: {
				id: 'identity-7',
				user: 'u-1',
				kind: 'github',
				value: '4242',
			},
		}]]);

		expect(tracker.history.delete[0]!.bindings)
			.toStrictEqual(['refresh-token']);
	});

	it(oneLine`
		logs out a session that names no identity through the default provider
	`, async () => {
		tracker.on.select('directus_sessions').response({
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: 'hashed-password',
			status: 'active',
			role: 'role-1',
			primary_identity: null,
			identity_id: null,
		});

		const service = new AuthenticationService({ knex: db, schema });

		await service.logout('refresh-token');

		expect(state.providerNames).toStrictEqual(['default']);

		expect(state.provider.logout.mock.calls).toStrictEqual([[{
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: 'hashed-password',
			status: 'active',
			role: 'role-1',
			primary_identity: null,
			identity: null,
		}]]);

		expect(tracker.history.select).toHaveLength(1);
	});

	it(oneLine`
		logs out through the default provider when the session identity is gone
	`, async () => {
		tracker.on.select('directus_sessions').response({
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: null,
			status: 'active',
			role: 'role-1',
			primary_identity: null,
			identity_id: 'identity-gone',
		});

		tracker.on.select('directus_user_identities').response(undefined);

		const service = new AuthenticationService({ knex: db, schema });

		await service.logout('refresh-token');

		expect(state.providerNames).toStrictEqual(['default']);

		expect(state.provider.logout.mock.calls).toStrictEqual([[{
			id: 'u-1',
			first_name: 'Ada',
			last_name: 'Lovelace',
			password: null,
			status: 'active',
			role: 'role-1',
			primary_identity: null,
			identity: null,
		}]]);
	});
});

describe('a password check of an account', () => {
	const db = knex.default({ client: MockClient });
	let tracker: Tracker;

	beforeEach(() => {
		tracker = createTracker(db);
		state.passwordMatches = false;
		state.foundProviders = {};
	});

	afterEach(() => {
		tracker.reset();
	});

	it('refuses an account no row holds', async () => {
		tracker.on.select('directus_users').response(undefined);
		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.verifyPassword('u-gone', 'secret'))
			.rejects.toStrictEqual(new InvalidCredentialsError());
	});

	it('passes the password the account holds', async () => {
		state.passwordMatches = true;

		tracker.on.select('directus_users').response({
			id: 'u-1',
			password: 'hashed-password',
		});

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.verifyPassword('u-1', 'secret'))
			.resolves.toBeUndefined();

		expect(tracker.history.select).toHaveLength(1);
	});

	it('refuses a password the account does not hold', async () => {
		tracker.on.select('directus_users').response({
			id: 'u-1',
			password: 'hashed-password',
		});

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.verifyPassword('u-1', 'wrong'))
			.rejects.toStrictEqual(new InvalidCredentialsError());
	});

	it(oneLine`
		asks each SSO identity's provider in turn, skipping one no longer
		configured and one refusing the password
	`, async () => {
		const ldapVerify = vi.fn(async () => {
			throw new InvalidCredentialsError();
		});

		const corporateVerify = vi.fn(async () => undefined);

		state.foundProviders = {
			ldap: { verify: ldapVerify },
			corporate: { verify: corporateVerify },
		};

		tracker.on.select('directus_users').response({
			id: 'u-1',
			password: null,
		});

		tracker.on.select('directus_user_identities').response([
			{ id: 'identity-1', user: 'u-1', kind: 'gone-provider', value: 'x' },
			{ id: 'identity-2', user: 'u-1', kind: 'ldap', value: 'cn=ada' },
			{ id: 'identity-3', user: 'u-1', kind: 'corporate', value: 'ada' },
		]);

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.verifyPassword('u-1', 'secret'))
			.resolves.toBeUndefined();

		expect(ldapVerify.mock.calls).toStrictEqual([[
			{
				id: 'u-1',
				password: null,
				identity: {
					id: 'identity-2',
					user: 'u-1',
					kind: 'ldap',
					value: 'cn=ada',
				},
			},
			'secret',
		]]);

		expect(corporateVerify.mock.calls).toStrictEqual([[
			{
				id: 'u-1',
				password: null,
				identity: {
					id: 'identity-3',
					user: 'u-1',
					kind: 'corporate',
					value: 'ada',
				},
			},
			'secret',
		]]);

		expect(tracker.history.select[1]!.bindings)
			.toStrictEqual(['u-1', 'email']);
	});

	it('rethrows a provider failure that is not a refusal', async () => {
		const ldapOutage = new Error('LDAP server unreachable');

		state.foundProviders = {
			ldap: {
				verify: async () => {
					throw ldapOutage;
				},
			},
		};

		tracker.on.select('directus_users').response({
			id: 'u-1',
			password: null,
		});

		tracker.on.select('directus_user_identities').response([
			{ id: 'identity-2', user: 'u-1', kind: 'ldap', value: 'cn=ada' },
		]);

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.verifyPassword('u-1', 'secret'))
			.rejects.toBe(ldapOutage);
	});

	it('refuses when no SSO identity provider passes the password', async () => {
		state.foundProviders = {
			ldap: {
				verify: async () => {
					throw new InvalidCredentialsError();
				},
			},
		};

		tracker.on.select('directus_users').response({
			id: 'u-1',
			password: null,
		});

		tracker.on.select('directus_user_identities').response([
			{ id: 'identity-2', user: 'u-1', kind: 'ldap', value: 'cn=ada' },
		]);

		const service = new AuthenticationService({ knex: db, schema });

		await expect(service.verifyPassword('u-1', 'secret'))
			.rejects.toStrictEqual(new InvalidCredentialsError());
	});
});
