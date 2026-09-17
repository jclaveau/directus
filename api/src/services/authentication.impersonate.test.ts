import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import jwt from 'jsonwebtoken';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
				IMPERSONATION_TTL: '5m',
			};
		},
	};
});

vi.mock('../permissions/modules/fetch-global-access/fetch-global-access.js');
vi.mock('../permissions/lib/fetch-roles-tree.js');

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

test('json mode signs a stateless token naming the impersonator', async () => {
	tracker.on.select('directus_users').response([admin, jane]);

	const filter = vi.spyOn(emitter, 'emitFilter');

	const result = await new AuthenticationService({ knex: db, schema })
		.impersonate('jane', { impersonator: 'admin', mode: 'json' });

	expect(result).toEqual({
		accessToken: expect.any(String),
		expires: 5 * 60_000,
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

	expect(result.expires).toBe(24 * 60 * 60_000);

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
