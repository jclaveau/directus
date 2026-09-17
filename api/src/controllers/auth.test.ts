import { Action } from '@directus/constants';
import {
	ForbiddenError,
	InvalidPayloadError,
	RouteNotFoundError,
} from '@directus/errors';
import { Router } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// One object for the whole file: the controller reads `useEnv()` once, at import.
const env = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('@directus/env', () => ({ useEnv: () => env }));

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('../logger/index.js', () => ({ useLogger: () => logger }));

const auth = vi.hoisted(() => {
	return {
		impersonate: vi.fn(),
		stopImpersonation: vi.fn(),
		constructed: [] as unknown[],
	};
});

vi.mock('../services/authentication.js', () => {
	return {
		AuthenticationService: class {
			constructor(options: unknown) {
				auth.constructed.push(options);
			}

			impersonate = auth.impersonate;
			stopImpersonation = auth.stopImpersonation;
		},
	};
});

const activity = vi.hoisted(() => ({ createOne: vi.fn() }));

vi.mock('../services/activity.js', () => {
	return {
		ActivityService: class {
			createOne = activity.createOne;
		},
	};
});

const users = vi.hoisted(() => ({ readOne: vi.fn() }));

vi.mock('../services/users.js', () => {
	return {
		UsersService: class {
			readOne = users.readOne;
		},
	};
});

vi.mock('../auth/drivers/index.js', () => {
	return {
		createLDAPAuthRouter: () => Router(),
		createLocalAuthRouter: () => Router(),
		createOAuth2AuthRouter: () => Router(),
		createOpenIDAuthRouter: () => Router(),
		createSAMLAuthRouter: () => Router(),
	};
});

vi.mock('../utils/get-auth-providers.js', () => ({ getAuthProviders: () => [] }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./auth.js');

// router.post(path, asyncHandler(fn), respond) registers one Route layer whose
// own stack holds [handler, respond]; drive the bare handler.
function handlerFor(method: string) {
	return router.stack.find((entry: any) => {
		return entry.route?.path === '/impersonate'
			&& entry.route.stack.some((handler: any) => handler.method === method);
	})!.route!.stack[0]!.handle as (req: any, res: any, next: any) => Promise<void>;
}

function gate() {
	return router.stack.find((entry: any) => {
		return entry.route === undefined && entry.regexp.test('/impersonate');
	})!.handle as any;
}

function response() {
	return { locals: {} as Record<string, unknown>, cookie: vi.fn() } as any;
}

// asyncHandler hands a rejection to `next(error)` rather than throwing it.
async function failure(method: string, req: any) {
	const next = vi.fn();

	await handlerFor(method)(req, response(), next);

	return next.mock.calls[0]![0];
}

const admin = {
	user: 'admin',
	role: 'admins',
	admin: true,
	app: true,
	session: 'admin-session',
};

const next = vi.fn();

beforeEach(() => {
	env['IMPERSONATION_ENABLED'] = true;
	env['REFRESH_TOKEN_COOKIE_NAME'] = 'directus_refresh_token';
	env['SESSION_COOKIE_NAME'] = 'directus_session_token';

	next.mockReset();
	activity.createOne.mockReset();
	auth.impersonate.mockReset();
	auth.stopImpersonation.mockReset();
	auth.constructed.length = 0;
	logger.info.mockReset();
});

test('is absent — a 404, not a 403 — while IMPERSONATION_ENABLED is off', () => {
	env['IMPERSONATION_ENABLED'] = false;

	expect(() => {
		gate()({ path: '/impersonate', accountability: admin }, response(), next);
	}).toThrow(RouteNotFoundError);

	expect(next).not.toHaveBeenCalled();
});

test('the gate lets the route through once enabled', () => {
	gate()({ path: '/impersonate', accountability: admin }, response(), next);

	expect(next).toHaveBeenCalledOnce();
});

describe('POST', () => {
	test.each([
		['nobody', null],
		['a non-admin', { ...admin, admin: false }],
	])('refuses %s', async (_, accountability) => {
		const error = await failure('post', { accountability, body: { user: 'jane' } });

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(auth.impersonate).not.toHaveBeenCalled();
	});

	test('refuses nesting: an impersonated admin cannot impersonate', async () => {
		const error = await failure('post', {
			accountability: { ...admin, impersonator: 'root' },
			body: { user: 'jane' },
		});

		expect(error).toMatchObject({ extensions: { reason: 'impersonation_nested' } });
	});

	test.each([
		['no user', {}],
		['a mode it does not know', { user: 'jane', mode: 'bearer' }],
	])('refuses %s', async (_, body) => {
		const error = await failure('post', { accountability: admin, body });

		expect(error).toBeInstanceOf(InvalidPayloadError);
	});

	test('json: answers the token, sets no cookie, writes the trail', async () => {
		auth.impersonate.mockResolvedValue({
			accessToken: 'at',
			expires: 900,
			id: 'jane',
		});

		const res = response();

		await handlerFor('post')(
			{ accountability: admin, body: { user: 'jane', mode: 'json' }, schema: {} },
			res,
			next,
		);

		expect(auth.constructed[0]).toEqual({ accountability: admin, schema: {} });

		expect(auth.impersonate).toHaveBeenCalledWith('jane', {
			impersonator: 'admin',
			mode: 'json',
		});

		expect(res.cookie).not.toHaveBeenCalled();

		expect(res.locals['payload'])
			.toEqual({ data: { expires: 900, access_token: 'at' } });

		expect(activity.createOne).toHaveBeenCalledWith(
			expect.objectContaining({
				action: Action.IMPERSONATE,
				user: 'admin',
				impersonator: null,
				collection: 'directus_users',
				item: 'jane',
			}),
		);

		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('admin'));
		expect(next).toHaveBeenCalledOnce();
	});

	test('cookie is the default mode: the refresh cookie and the token', async () => {
		auth.impersonate.mockResolvedValue({
			accessToken: 'at',
			refreshToken: 'rt',
			expires: 900,
			id: 'jane',
		});

		const res = response();

		await handlerFor('post')(
			{ accountability: admin, body: { user: 'jane' } },
			res,
			next,
		);

		expect(auth.impersonate).toHaveBeenCalledWith('jane', {
			impersonator: 'admin',
			mode: 'cookie',
		});

		expect(res.cookie).toHaveBeenCalledWith(
			'directus_refresh_token',
			'rt',
			expect.objectContaining({ httpOnly: true }),
		);

		expect(res.locals['payload'])
			.toEqual({ data: { expires: 900, access_token: 'at' } });
	});

	test("session: the session cookie over the admin's, no token", async () => {
		auth.impersonate.mockResolvedValue({
			accessToken: 'at',
			refreshToken: 'rt',
			expires: 900,
			id: 'jane',
		});

		const res = response();

		await handlerFor('post')(
			{ accountability: admin, body: { user: 'jane', mode: 'session' } },
			res,
			next,
		);

		expect(res.cookie).toHaveBeenCalledWith(
			'directus_session_token',
			'at',
			expect.objectContaining({ httpOnly: true }),
		);

		expect(res.locals['payload']).toEqual({ data: { expires: 900 } });
	});
});

describe('DELETE (Stop)', () => {
	test.each([
		['a plain session', { ...admin, user: 'jane' }],
		['a cookie-mode impersonation', { user: 'jane', impersonator: 'admin' }],
	])('refuses %s', async (_, accountability) => {
		const error = await failure('delete', { accountability });

		expect(error).toBeInstanceOf(InvalidPayloadError);
		expect(auth.stopImpersonation).not.toHaveBeenCalled();
	});

	test("ends the impersonation and hands the admin's cookie back", async () => {
		auth.stopImpersonation.mockResolvedValue({
			accessToken: 'admin-at',
			expires: 86_400,
		});

		const res = response();

		await handlerFor('delete')(
			{
				accountability: {
					user: 'jane',
					impersonator: 'admin',
					session: 'imp-session',
				},
				schema: {},
			},
			res,
			next,
		);

		expect(auth.stopImpersonation).toHaveBeenCalledWith('imp-session');

		expect(res.cookie).toHaveBeenCalledWith(
			'directus_session_token',
			'admin-at',
			expect.objectContaining({ httpOnly: true }),
		);

		expect(res.locals['payload']).toEqual({ data: { expires: 86_400 } });

		// The trail names the admin as the actor: they are themself again.
		expect(activity.createOne).toHaveBeenCalledWith(
			expect.objectContaining({
				action: Action.IMPERSONATE_END,
				user: 'admin',
				impersonator: null,
				collection: 'directus_users',
				item: 'jane',
			}),
		);

		expect(next).toHaveBeenCalledOnce();
	});
});

describe('GET (banner)', () => {
	test('is null for a request that impersonates nobody', async () => {
		const res = response();

		await handlerFor('get')({ accountability: admin }, res, next);

		expect(res.locals['payload']).toEqual({ data: { impersonator: null } });
		expect(users.readOne).not.toHaveBeenCalled();
	});

	test('names the impersonator, and nothing else about them', async () => {
		users.readOne.mockResolvedValue({
			id: 'admin',
			first_name: 'Ada',
			last_name: null,
		});

		const res = response();

		await handlerFor('get')(
			{ accountability: { user: 'jane', impersonator: 'admin' }, schema: {} },
			res,
			next,
		);

		expect(users.readOne).toHaveBeenCalledWith('admin', {
			fields: ['id', 'first_name', 'last_name'],
		});

		expect(res.locals['payload']).toEqual({
			data: { impersonator: { id: 'admin', first_name: 'Ada', last_name: null } },
		});
	});
});
