import { InvalidCredentialsError, UserSuspendedError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import jwt from 'jsonwebtoken';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getAuthProvider } from '../auth.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import {
	fetchGlobalAccess,
} from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import {
	createDefaultAccountability,
} from '../permissions/utils/create-default-accountability.js';
import { AuthenticationService } from './authentication.js';

// login() and refresh() both hand their token to mint(); what each one adds
// around it — the provider, the activity row, `last_access`, the session row
// rotation — is pinned here, with the impersonated and share sessions apart.

vi.mock('../database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('./mail', () => {
	return { MailService: vi.fn() };
});

const provider = vi.hoisted(() => {
	return {
		getUserID: vi.fn(),
		login: vi.fn(),
		refresh: vi.fn(),
	};
});

vi.mock('../auth.js', () => {
	return { getAuthProvider: vi.fn(() => provider) };
});

const activity = vi.hoisted(() => ({ createOne: vi.fn() }));

vi.mock('./activity.js', () => {
	return {
		ActivityService: class {
			createOne = activity.createOne;
		},
	};
});

vi.mock('./settings.js', () => {
	return {
		SettingsService: class {
			readSingleton = vi.fn().mockResolvedValue({ auth_login_attempts: null });
		},
	};
});

vi.mock('../utils/stall.js', () => ({ stall: vi.fn() }));

vi.mock('../rate-limiter.js', () => {
	return {
		createRateLimiter: () => ({ consume: vi.fn(), set: vi.fn() }),
		RateLimiterRes: class {},
	};
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
				SESSION_REFRESH_GRACE_PERIOD: '10s',
				LOGIN_STALL_TIME: 0,
			};
		},
	};
});

vi.mock('../permissions/modules/fetch-global-access/fetch-global-access.js');
vi.mock('../permissions/lib/fetch-roles-tree.js');
vi.mock('../bus/index.js', () => ({ useBus: () => ({ publish: vi.fn() }) }));

const schema = new SchemaBuilder().build();

const jane = {
	id: 'jane',
	role: 'role-1',
	status: 'active',
	provider: 'default',
	tfa_secret: null,
};

const session = {
	session_expires: new Date(Date.now() + 60_000),
	session_next_token: null,
	session_impersonator: null,
	session_impersonator_session: null,
	user_id: 'jane',
	user_status: 'active',
	user_provider: 'default',
	user_role: 'role-1',
	share_id: null,
};

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

	provider.getUserID.mockResolvedValue('jane');
	provider.login.mockResolvedValue(undefined);
	provider.refresh.mockResolvedValue(undefined);
	activity.createOne.mockReset();
});

afterEach(() => {
	tracker.reset();
	vi.restoreAllMocks();
});

test('login opens a session and writes the login row as the caller', async () => {
	tracker.on.select('directus_users').response([jane]);
	tracker.on.insert('directus_sessions').response([]);
	tracker.on.delete('directus_sessions').response([]);
	tracker.on.update('directus_users').response([]);

	const result = await new AuthenticationService({
		knex: db,
		schema,
		accountability: createDefaultAccountability({ ip: '10.0.0.1' }),
	}).login('default', { email: 'jane@example.com', password: 'pw' });

	expect(result).toEqual({
		accessToken: expect.any(String),
		refreshToken: expect.any(String),
		expires: 15 * 60_000,
		id: 'jane',
	});

	expect(jwt.verify(result.accessToken, 'super-secure-secret')).toMatchObject({
		id: 'jane',
		role: 'role-1',
	});

	expect(getAuthProvider).toHaveBeenCalledWith('default');
	expect(provider.login).toHaveBeenCalledTimes(1);

	expect(activity.createOne).toHaveBeenCalledWith(
		expect.objectContaining({
			action: 'login',
			user: 'jane',
			ip: '10.0.0.1',
			impersonator: null,
			item: 'jane',
		}),
	);

	expect(tracker.history.insert[0]!.bindings).toEqual(
		expect.arrayContaining([result.refreshToken, 'jane', '10.0.0.1']),
	);

	expect(tracker.history.update[0]!.sql).toContain('last_access');
});

test('login in session mode names the session in the token', async () => {
	tracker.on.select('directus_users').response([jane]);
	tracker.on.insert('directus_sessions').response([]);
	tracker.on.delete('directus_sessions').response([]);
	tracker.on.update('directus_users').response([]);

	const result = await new AuthenticationService({ knex: db, schema })
		.login(
			'default',
			{ email: 'jane@example.com', password: 'pw' },
			{ session: true },
		);

	expect(result.expires).toBe(24 * 60 * 60_000);

	expect(jwt.verify(result.accessToken, 'super-secure-secret')).toMatchObject({
		session: result.refreshToken,
	});

	expect(activity.createOne).not.toHaveBeenCalled();
});

test('refresh rotates the row, asks the provider, touches last_access', async () => {
	tracker.on.select('directus_sessions').response(session);
	tracker.on.update('directus_sessions').response([]);
	tracker.on.update('directus_users').response([]);
	tracker.on.delete('directus_sessions').response([]);

	const result = await new AuthenticationService({ knex: db, schema })
		.refresh('old-token');

	expect(result).toEqual({
		accessToken: expect.any(String),
		refreshToken: expect.any(String),
		expires: 15 * 60_000,
		id: 'jane',
	});

	expect(result.refreshToken).not.toBe('old-token');

	expect(provider.refresh).toHaveBeenCalledWith(
		expect.objectContaining({ id: 'jane', app_access: true }),
	);

	expect(jwt.verify(result.accessToken, 'super-secure-secret'))
		.not.toHaveProperty('impersonator');

	const [rotation, lastAccess] = tracker.history.update;

	expect(rotation!.bindings).toEqual(
		expect.arrayContaining([result.refreshToken, 'old-token']),
	);

	expect(lastAccess!.sql).toContain('last_access');

	expect(tracker.history.delete[0]!.bindings)
		.toEqual(expect.arrayContaining(['jane']));
});

test('refresh of an impersonated session keeps the target out of it', async () => {
	tracker.on.select('directus_sessions').response({
		...session,
		session_impersonator: 'admin',
		session_impersonator_session: 'admin-session',
	});

	// updateStatefulSession: the grace-period update claims the row
	tracker.on.update('directus_sessions').response([{ next_token: 'x' }]);
	tracker.on.insert('directus_sessions').response([]);
	tracker.on.delete('directus_sessions').response([]);

	const result = await new AuthenticationService({ knex: db, schema })
		.refresh('imp-token', { session: true });

	expect(provider.refresh).not.toHaveBeenCalled();

	expect(jwt.verify(result.accessToken, 'super-secure-secret')).toMatchObject({
		id: 'jane',
		impersonator: 'admin',
		session: result.refreshToken,
	});

	// The copied row carries the impersonation on
	expect(tracker.history.insert[0]!.bindings).toEqual(
		expect.arrayContaining([result.refreshToken, 'jane', 'admin', 'admin-session']),
	);

	const sqls = tracker.history.update.map((query) => query.sql);
	expect(sqls.some((sql) => sql.includes('last_access'))).toBe(false);

	// The impersonator's own row lives as long as the impersonated one
	const own = tracker.history.update.find((query) => {
		return query.bindings.includes('admin-session');
	});

	expect(own!.sql).toContain('expires');
});

test('refresh of a share session signs a share token', async () => {
	tracker.on.select('directus_sessions').response({
		...session,
		user_id: null,
		user_role: null,
		user_provider: null,
		share_id: 'share-1',
	});

	tracker.on.update('directus_sessions').response([]);
	tracker.on.delete('directus_sessions').response([]);

	const result = await new AuthenticationService({ knex: db, schema })
		.refresh('share-token');

	expect(result.id).toBeNull();
	expect(provider.refresh).not.toHaveBeenCalled();

	expect(jwt.verify(result.accessToken, 'super-secure-secret')).toMatchObject({
		share: 'share-1',
		role: null,
		app_access: false,
		admin_access: false,
	});
});

test('refresh ends the session of a user no longer active', async () => {
	tracker.on
		.select('directus_sessions')
		.responseOnce({ ...session, user_status: 'suspended' });

	// endSessions reads the rows it ends
	tracker.on
		.select('directus_sessions')
		.response([{ token: 'old-token', impersonator: null }]);

	tracker.on.delete('directus_sessions').response([]);

	await expect(
		new AuthenticationService({ knex: db, schema }).refresh('old-token'),
	).rejects.toThrow(UserSuspendedError);

	expect(tracker.history.delete[0]!.bindings).toEqual(
		expect.arrayContaining(['old-token']),
	);
});

test('refresh refuses a token with no row', async () => {
	tracker.on.select('directus_sessions').response(undefined);

	await expect(
		new AuthenticationService({ knex: db, schema }).refresh('gone'),
	).rejects.toThrow(InvalidCredentialsError);
});
