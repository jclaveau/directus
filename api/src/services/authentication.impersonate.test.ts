import {
	ForbiddenError,
	InvalidCredentialsError,
	InvalidPayloadError,
} from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import jwt from 'jsonwebtoken';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getAuthProvider } from '../auth.js';
import { BOTS_ROLE } from '../bots.js';
import emitter from '../emitter.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import {
	fetchGlobalAccess,
} from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import {
	createDefaultAccountability,
} from '../permissions/utils/create-default-accountability.js';
import { AuthenticationService } from './authentication.js';

vi.mock('../database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('./mail', () => {
	return { MailService: vi.fn() };
});

// impersonate() never reaches a provider; the drivers drag the whole app in.
vi.mock('../auth.js', () => {
	return { getAuthProvider: vi.fn() };
});

vi.mock('@directus/env', () => {
	return {
		useEnv: () => {
			return {
				SECRET: 'super-secure-secret',
				EMAIL_TEMPLATES_PATH: './templates',
				ACCESS_TOKEN_TTL: '15m',
				REFRESH_TOKEN_TTL: '7d',
				SESSION_COOKIE_TTL: '1d',
				IMPERSONATION_ENABLED: true,
			};
		},
	};
});

vi.mock('../permissions/modules/fetch-global-access/fetch-global-access.js');
vi.mock('../permissions/lib/fetch-roles-tree.js');
vi.mock('../bus/index.js', () => ({ useBus: () => ({ publish: vi.fn() }) }));

const schema = new SchemaBuilder().build();

const admin = { id: 'admin', role: 'admins', status: 'active', provider: 'default' };
const jane = { id: 'jane', role: 'role-1', status: 'active', provider: 'default' };

let db: knex.Knex;
let tracker: Tracker;

beforeEach(() => {
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);

	vi.mocked(fetchRolesTree).mockResolvedValue(['role-1']);

	vi.mocked(fetchGlobalAccess).mockResolvedValue({
		app: true,
		admin: false,
		grantedDbConnections: [],
	});
});

afterEach(() => {
	tracker.reset();
	vi.restoreAllMocks();
});

function expectExpiresIn(bindings: unknown[], ms: number) {
	const expires = bindings.find((value): value is Date => value instanceof Date);
	const left = expires!.getTime() - Date.now();

	expect(left).toBeGreaterThan(ms - 5_000);
	expect(left).toBeLessThanOrEqual(ms);
}

test('json mode signs a stateless token naming the impersonator', async () => {
	tracker.on.select('directus_users').response([admin, jane]);

	const filter = vi.spyOn(emitter, 'emitFilter');

	const result = await new AuthenticationService({ knex: db, schema })
		.impersonate('jane', { impersonator: 'admin', mode: 'json' });

	// One ACCESS_TOKEN_TTL, like every impersonation
	expect(result).toEqual({
		accessToken: expect.any(String),
		expires: 15 * 60_000,
		id: 'jane',
	});

	expect(result).not.toHaveProperty('refreshToken');

	expect(jwt.verify(result.accessToken, 'super-secure-secret')).toMatchObject({
		id: 'jane',
		role: 'role-1',
		app_access: true,
		admin_access: false,
		impersonator: 'admin',
	});

	expect(filter).toHaveBeenCalledWith(
		'auth.jwt',
		expect.objectContaining({ impersonator: 'admin' }),
		expect.objectContaining({
			type: 'impersonate',
			user: 'jane',
			provider: 'default',
		}),
		expect.anything(),
	);

	expect(tracker.history.insert).toHaveLength(0);
});

test('json mode takes the ttl the caller asks for', async () => {
	tracker.on.select('directus_users').response([admin, jane]);

	const result = await new AuthenticationService({ knex: db, schema })
		.impersonate('jane', { impersonator: 'admin', mode: 'json', ttl: '60s' });

	expect(result.expires).toBe(60_000);
});

test('cookie mode opens a row carrying the impersonator, no session', async () => {
	tracker.on.select('directus_users').response([admin, jane]);
	tracker.on.insert('directus_sessions').response([]);

	const result = await new AuthenticationService({
		knex: db,
		schema,
		accountability: createDefaultAccountability({ user: 'admin', ip: '10.0.0.1' }),
	}).impersonate('jane', { impersonator: 'admin', mode: 'cookie' });

	expect(result.refreshToken).toHaveLength(64);
	expect(result.expires).toBe(15 * 60_000);

	expect(jwt.verify(result.accessToken, 'super-secure-secret'))
		.not.toHaveProperty('session');

	const [row] = tracker.history.insert;

	// The row lives one access token, not REFRESH_TOKEN_TTL: a refresh rolls it
	expectExpiresIn(row!.bindings, 15 * 60_000);

	expect(row!.sql).toContain('"impersonator_session"');

	expect(row!.bindings).toEqual(
		expect.arrayContaining([result.refreshToken, 'jane', 'admin', '10.0.0.1', null]),
	);
});

test("session mode records the impersonator's own session for Stop", async () => {
	tracker.on.select('directus_users').response([admin, jane]);
	tracker.on.insert('directus_sessions').response([]);

	const result = await new AuthenticationService({
		knex: db,
		schema,
		accountability: createDefaultAccountability({
			user: 'admin',
			session: 'admin-session',
		}),
	}).impersonate('jane', { impersonator: 'admin', mode: 'session' });

	// One access token, not SESSION_COOKIE_TTL: the Studio schedules its
	// refresh from `expires`, and the row goes when none comes
	expect(result.expires).toBe(15 * 60_000);
	expectExpiresIn(tracker.history.insert[0]!.bindings, 15 * 60_000);

	expect(jwt.verify(result.accessToken, 'super-secure-secret')).toMatchObject({
		session: result.refreshToken,
		impersonator: 'admin',
	});

	expect(tracker.history.insert[0]!.bindings).toEqual(
		expect.arrayContaining([result.refreshToken, 'jane', 'admin', 'admin-session']),
	);
});

test('session mode needs the impersonator on a session cookie', async () => {
	tracker.on.select('directus_users').response([admin, jane]);

	await expect(
		new AuthenticationService({
			knex: db,
			schema,
			accountability: createDefaultAccountability({ user: 'admin' }),
		}).impersonate('jane', { impersonator: 'admin', mode: 'session' }),
	).rejects.toThrow(InvalidPayloadError);
});

test('session mode refuses a target without app access', async () => {
	tracker.on.select('directus_users').response([admin, jane]);

	vi.mocked(fetchGlobalAccess).mockResolvedValue({
		app: false,
		admin: false,
		grantedDbConnections: [],
	});

	await expect(
		new AuthenticationService({
			knex: db,
			schema,
			accountability: createDefaultAccountability({
				user: 'admin',
				session: 'admin-session',
			}),
		}).impersonate('jane', { impersonator: 'admin', mode: 'session' }),
	).rejects.toMatchObject({
		extensions: { reason: 'impersonation_target_no_app_access' },
	});
});

test.each([
	['the impersonator themself', [admin, jane], 'admin', 'impersonation_self'],
	[
		'an inactive target',
		[admin, { ...jane, status: 'suspended' }],
		'jane',
		'impersonation_target_inactive',
	],
	['an unknown target', [admin], 'ghost', 'impersonation_target_inactive'],
	[
		'a bot',
		[admin, { ...jane, role: BOTS_ROLE }],
		'jane',
		'impersonation_target_bot',
	],
])('refuses %s', async (_, rows, target, reason) => {
	tracker.on.select('directus_users').response(rows);

	const service = new AuthenticationService({ knex: db, schema });

	await expect(
		service.impersonate(target, { impersonator: 'admin', mode: 'json' }),
	).rejects.toMatchObject({ extensions: { reason } });

	await expect(
		service.impersonate(target, { impersonator: 'admin', mode: 'json' }),
	).rejects.toThrow(ForbiddenError);
});

test('refuses a target that is no uuid before asking the database', async () => {
	const users = new SchemaBuilder()
		.collection('directus_users', (c) => {
			c.field('id')
				.uuid()
				.primary();
		})
		.build();

	await expect(
		new AuthenticationService({ knex: db, schema: users })
			.impersonate('not-a-uuid', { impersonator: 'admin', mode: 'json' }),
	).rejects.toThrow(InvalidPayloadError);

	expect(tracker.history.select).toHaveLength(0);
});

test('refuses an inactive impersonator: suspend a bot to kill it', async () => {
	tracker.on.select('directus_users')
		.response([{ ...admin, status: 'suspended' }, jane]);

	await expect(
		new AuthenticationService({ knex: db, schema })
			.impersonate('jane', { impersonator: 'admin', mode: 'json' }),
	).rejects.toMatchObject({
		extensions: { reason: 'impersonation_impersonator_inactive' },
	});
});

test('logout under impersonation ends the impersonator\'s row too', async () => {
	tracker.on.select((raw) => raw.sql.includes('inner join')).response([
		{ ...jane, impersonator: 'admin', impersonator_session: 'admin-session' },
	]);

	tracker.on.select('directus_sessions').response([
		{ token: 'imp-token', user: 'jane', impersonator: 'admin' },
		{ token: 'admin-session', user: 'admin', impersonator: null },
	]);

	tracker.on.delete('directus_sessions').response([]);
	tracker.on.insert('directus_activity').response([]);

	await new AuthenticationService({ knex: db, schema }).logout('imp-token');

	expect(getAuthProvider).not.toHaveBeenCalled();

	expect(tracker.history.delete[0]!.bindings)
		.toEqual(['imp-token', 'admin-session']);
});

test('logout ends the row rotated under the caller too', async () => {
	tracker.on.select((raw) => raw.sql.includes('inner join')).response([
		{ ...jane, impersonator: null, impersonator_session: null, next_token: 'next' },
	]);

	tracker.on.select('directus_sessions').response([
		{ token: 'old', user: 'jane', impersonator: null },
		{ token: 'next', user: 'jane', impersonator: null },
	]);

	tracker.on.delete('directus_sessions').response([]);
	vi.mocked(getAuthProvider).mockReturnValue({ logout: vi.fn() } as never);

	await new AuthenticationService({ knex: db, schema }).logout('old');

	expect(tracker.history.select[1]!.bindings)
		.toEqual(['old', 'next', 'old', 'next', 'jane']);

	expect(tracker.history.delete[0]!.bindings).toEqual(['old', 'next']);
});

test('a logout ends every impersonation the caller runs, any mode', async () => {
	tracker.on.select((raw) => raw.sql.includes('inner join')).response([
		{ ...admin, impersonator: null, impersonator_session: null, next_token: null },
	]);

	tracker.on.select('directus_sessions').response([
		{ token: 'admin-session', user: 'admin', impersonator: null },
		{ token: 'cookie-imp', user: 'jane', impersonator: 'admin' },
	]);

	tracker.on.delete('directus_sessions').response([]);
	tracker.on.insert('directus_activity').response([]);
	vi.mocked(getAuthProvider).mockReturnValue({ logout: vi.fn() } as never);

	await new AuthenticationService({ knex: db, schema }).logout('admin-session');

	expect(tracker.history.select[1]!.sql).toMatch(/or "impersonator" = \?\)/);

	expect(tracker.history.select[1]!.bindings)
		.toEqual(['admin-session', 'admin-session', 'admin']);

	expect(tracker.history.delete[0]!.bindings)
		.toEqual(['admin-session', 'cookie-imp']);
});

test('a plain logout ends its row and tells the provider', async () => {
	const provider = { logout: vi.fn() };
	vi.mocked(getAuthProvider).mockReturnValue(provider as never);

	tracker.on.select((raw) => raw.sql.includes('inner join')).response([
		{ ...jane, impersonator: null, impersonator_session: null },
	]);

	tracker.on.select('directus_sessions')
		.response([{ token: 'own-token', user: 'jane', impersonator: null }]);

	tracker.on.delete('directus_sessions').response([]);

	await new AuthenticationService({ knex: db, schema }).logout('own-token');

	expect(provider.logout)
		.toHaveBeenCalledWith(expect.objectContaining({ id: 'jane' }));

	expect(tracker.history.delete[0]!.bindings).toEqual(['own-token']);
});

test('Stop ends the impersonated row and re-signs the impersonator', async () => {
	tracker.on.select((raw) => raw.sql.includes('"next_token"')).response({
		token: 'imp-token',
		next_token: null,
		impersonator: 'admin',
		impersonator_session: 'admin-session',
	});

	tracker.on.select((raw) => raw.sql.includes('inner join')).response({
		id: 'admin',
		role: 'admins',
		provider: 'default',
		status: 'active',
	});

	tracker.on.select('directus_sessions')
		.response([{ token: 'imp-token', user: 'jane', impersonator: 'admin' }]);

	tracker.on.delete('directus_sessions').response([]);
	tracker.on.insert('directus_activity').response([]);

	const result = await new AuthenticationService({ knex: db, schema })
		.stopImpersonation('imp-token');

	expect(result.expires).toBe(24 * 60 * 60_000);
	expect(tracker.history.delete[0]!.bindings).toEqual(['imp-token']);

	const claims = jwt.verify(result.accessToken, 'super-secure-secret');

	expect(claims).toMatchObject({ id: 'admin', session: 'admin-session' });
	expect(claims).not.toHaveProperty('impersonator');
});

test('Stop follows the row rotated under it within the grace period', async () => {
	tracker.on.select((raw) => raw.sql.includes('"next_token"')).response({
		token: 'imp-token',
		next_token: 'imp-next',
		impersonator: 'admin',
		impersonator_session: 'admin-session',
	});

	tracker.on.select((raw) => raw.sql.includes('inner join')).response({
		id: 'admin',
		role: 'admins',
		provider: 'default',
		status: 'active',
	});

	tracker.on.select('directus_sessions').response([
		{ token: 'imp-token', user: 'jane', impersonator: 'admin' },
		{ token: 'imp-next', user: 'jane', impersonator: 'admin' },
	]);

	tracker.on.delete('directus_sessions').response([]);
	tracker.on.insert('directus_activity').response([]);

	await new AuthenticationService({ knex: db, schema })
		.stopImpersonation('imp-token');

	expect(tracker.history.delete[0]!.bindings).toEqual(['imp-token', 'imp-next']);
});

test('Stop refuses a session that is not an impersonation', async () => {
	tracker.on.select('directus_sessions').response({
		token: 'own-token',
		next_token: null,
		impersonator: null,
		impersonator_session: null,
	});

	await expect(
		new AuthenticationService({ knex: db, schema }).stopImpersonation('own-token'),
	).rejects.toThrow(InvalidPayloadError);

	expect(tracker.history.delete).toHaveLength(0);
});

test('Stop gives no cookie back once the impersonator\'s row is gone', async () => {
	tracker.on.select((raw) => raw.sql.includes('"next_token"')).response({
		token: 'imp-token',
		next_token: null,
		impersonator: 'admin',
		impersonator_session: 'admin-session',
	});

	tracker.on.select((raw) => raw.sql.includes('inner join')).response(undefined);

	tracker.on.select('directus_sessions')
		.response([{ token: 'imp-token', user: 'jane', impersonator: 'admin' }]);

	tracker.on.delete('directus_sessions').response([]);
	tracker.on.insert('directus_activity').response([]);

	await expect(
		new AuthenticationService({ knex: db, schema }).stopImpersonation('imp-token'),
	).rejects.toThrow(InvalidCredentialsError);

	expect(tracker.history.delete).toHaveLength(1);
});
