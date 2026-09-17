import { Action } from '@directus/constants';
import { useEnv } from '@directus/env';
import {
	ErrorCode,
	ForbiddenError,
	InvalidPayloadError,
	isDirectusError,
	RouteNotFoundError,
} from '@directus/errors';
import type { Accountability } from '@directus/types';
import type { Request } from 'express';
import { Router } from 'express';
import {
	createLDAPAuthRouter,
	createLocalAuthRouter,
	createOAuth2AuthRouter,
	createOpenIDAuthRouter,
	createSAMLAuthRouter,
} from '../auth/drivers/index.js';
import { DEFAULT_AUTH_PROVIDER, REFRESH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from '../constants.js';
import { useLogger } from '../logger/index.js';
import { respond } from '../middleware/respond.js';
import { createDefaultAccountability } from '../permissions/utils/create-default-accountability.js';
import { ActivityService } from '../services/activity.js';
import { AuthenticationService } from '../services/authentication.js';
import { UsersService } from '../services/users.js';
import type { AuthenticationMode } from '../types/auth.js';
import { actorFields } from '../utils/actor-fields.js';
import asyncHandler from '../utils/async-handler.js';
import { getAuthProviders } from '../utils/get-auth-providers.js';
import { getIPFromReq } from '../utils/get-ip-from-req.js';
import { getSecret } from '../utils/get-secret.js';
import isDirectusJWT from '../utils/is-directus-jwt.js';
import { verifyAccessJWT } from '../utils/jwt.js';

const router = Router();
const env = useEnv();
const logger = useLogger();

const authProviders = getAuthProviders();

for (const authProvider of authProviders) {
	let authRouter: Router | undefined;

	switch (authProvider.driver) {
		case 'local':
			authRouter = createLocalAuthRouter(authProvider.name);
			break;

		case 'oauth2':
			authRouter = createOAuth2AuthRouter(authProvider.name);
			break;

		case 'openid':
			authRouter = createOpenIDAuthRouter(authProvider.name);
			break;

		case 'ldap':
			authRouter = createLDAPAuthRouter(authProvider.name);
			break;

		case 'saml':
			authRouter = createSAMLAuthRouter(authProvider.name);
			break;
	}

	if (!authRouter) {
		logger.warn(`Couldn't create login router for auth provider "${authProvider.name}"`);
		continue;
	}

	router.use(`/login/${authProvider.name}`, authRouter);
}

if (!env['AUTH_DISABLE_DEFAULT']) {
	router.use('/login', createLocalAuthRouter(DEFAULT_AUTH_PROVIDER));
}

function getCurrentMode(req: Request): AuthenticationMode {
	if (req.body.mode) {
		return req.body.mode as AuthenticationMode;
	}

	if (req.body.refresh_token) {
		return 'json';
	}

	return 'cookie';
}

function getCurrentRefreshToken(req: Request, mode: AuthenticationMode): string | undefined {
	if (mode === 'json') {
		return req.body.refresh_token;
	}

	if (mode === 'cookie') {
		return req.cookies[env['REFRESH_TOKEN_COOKIE_NAME'] as string];
	}

	if (mode === 'session') {
		const token = req.cookies[env['SESSION_COOKIE_NAME'] as string];

		if (isDirectusJWT(token)) {
			const payload = verifyAccessJWT(token, getSecret());
			return payload.session;
		}
	}

	return undefined;
}

router.post(
	'/refresh',
	asyncHandler(async (req, res, next) => {
		const accountability: Accountability = createDefaultAccountability({ ip: getIPFromReq(req) });

		const userAgent = req.get('user-agent')?.substring(0, 1024);
		if (userAgent) accountability.userAgent = userAgent;

		const origin = req.get('origin');
		if (origin) accountability.origin = origin;

		const authenticationService = new AuthenticationService({
			accountability: accountability,
			schema: req.schema,
		});

		const mode = getCurrentMode(req);
		const currentRefreshToken = getCurrentRefreshToken(req, mode);

		if (!currentRefreshToken) {
			throw new InvalidPayloadError({
				reason: `The refresh token is required in either the payload or cookie`,
			});
		}

		const { accessToken, refreshToken, expires } = await authenticationService.refresh(currentRefreshToken, {
			session: mode === 'session',
		});

		const payload = { expires } as { expires: number; access_token?: string; refresh_token?: string };

		if (mode === 'json') {
			payload.refresh_token = refreshToken;
			payload.access_token = accessToken;
		}

		if (mode === 'cookie') {
			res.cookie(env['REFRESH_TOKEN_COOKIE_NAME'] as string, refreshToken, REFRESH_COOKIE_OPTIONS);
			payload.access_token = accessToken;
		}

		if (mode === 'session') {
			res.cookie(
				env['SESSION_COOKIE_NAME'] as string,
				accessToken,
				SESSION_COOKIE_OPTIONS,
			);
		}

		res.locals['payload'] = { data: payload };
		return next();
	}),
	respond,
);

router.post(
	'/logout',
	asyncHandler(async (req, res, next) => {
		const accountability: Accountability = createDefaultAccountability({ ip: getIPFromReq(req) });

		const userAgent = req.get('user-agent')?.substring(0, 1024);
		if (userAgent) accountability.userAgent = userAgent;

		const origin = req.get('origin');
		if (origin) accountability.origin = origin;

		const authenticationService = new AuthenticationService({
			accountability: accountability,
			schema: req.schema,
		});

		const mode = getCurrentMode(req);
		const currentRefreshToken = getCurrentRefreshToken(req, mode);

		if (!currentRefreshToken) {
			throw new InvalidPayloadError({
				reason: `The refresh token is required in either the payload or cookie`,
			});
		}

		await authenticationService.logout(currentRefreshToken);

		if (req.cookies[env['REFRESH_TOKEN_COOKIE_NAME'] as string]) {
			res.clearCookie(env['REFRESH_TOKEN_COOKIE_NAME'] as string, REFRESH_COOKIE_OPTIONS);
		}

		if (req.cookies[env['SESSION_COOKIE_NAME'] as string]) {
			res.clearCookie(env['SESSION_COOKIE_NAME'] as string, SESSION_COOKIE_OPTIONS);
		}

		return next();
	}),
	respond,
);

router.post(
	'/password/request',
	asyncHandler(async (req, _res, next) => {
		if (typeof req.body.email !== 'string') {
			throw new InvalidPayloadError({ reason: `"email" field is required` });
		}

		const accountability: Accountability = createDefaultAccountability({ ip: getIPFromReq(req) });

		const userAgent = req.get('user-agent')?.substring(0, 1024);
		if (userAgent) accountability.userAgent = userAgent;

		const origin = req.get('origin');
		if (origin) accountability.origin = origin;

		const service = new UsersService({ accountability, schema: req.schema });

		try {
			await service.requestPasswordReset(req.body.email, req.body.reset_url || null);
			return next();
		} catch (err: any) {
			if (isDirectusError(err, ErrorCode.InvalidPayload)) {
				throw err;
			} else {
				logger.warn(err, `[email] ${err}`);
				return next();
			}
		}
	}),
	respond,
);

router.post(
	'/password/reset',
	asyncHandler(async (req, _res, next) => {
		if (typeof req.body.token !== 'string') {
			throw new InvalidPayloadError({ reason: `"token" field is required` });
		}

		if (typeof req.body.password !== 'string') {
			throw new InvalidPayloadError({ reason: `"password" field is required` });
		}

		const accountability: Accountability = createDefaultAccountability({ ip: getIPFromReq(req) });

		const userAgent = req.get('user-agent')?.substring(0, 1024);
		if (userAgent) accountability.userAgent = userAgent;

		const origin = req.get('origin');
		if (origin) accountability.origin = origin;

		const service = new UsersService({ accountability, schema: req.schema });
		await service.resetPassword(req.body.token, req.body.password);
		return next();
	}),
	respond,
);


const IMPERSONATION_MODES: AuthenticationMode[] = ['json', 'cookie', 'session'];

router.use('/impersonate', (req, _res, next) => {
	if (env['IMPERSONATION_ENABLED'] !== true) {
		throw new RouteNotFoundError({ path: req.path });
	}

	return next();
});

router.post(
	'/impersonate',
	asyncHandler(async (req, res, next) => {
		const { accountability } = req;

		if (accountability?.admin !== true || !accountability.user) {
			throw new ForbiddenError();
		}

		if (accountability.impersonator) {
			throw new ForbiddenError({ reason: 'impersonation_nested' });
		}

		if (typeof req.body.user !== 'string') {
			throw new InvalidPayloadError({ reason: '"user" field is required' });
		}

		const mode = req.body.mode ?? 'cookie';

		if (!IMPERSONATION_MODES.includes(mode)) {
			throw new InvalidPayloadError({
				reason: `"mode" must be one of ${IMPERSONATION_MODES.join(', ')}`,
			});
		}

		const result = await new AuthenticationService({
			accountability,
			schema: req.schema,
		}).impersonate(req.body.user, { impersonator: accountability.user, mode });

		const { accessToken, refreshToken, expires, id } = result;

		await new ActivityService({ schema: req.schema }).createOne({
			action: Action.IMPERSONATE,
			...actorFields(accountability),
			collection: 'directus_users',
			item: id,
		});

		logger.info(
			`[impersonation] ${accountability.user} impersonates ${id} in ${mode} mode`,
		);

		const payload: { expires: number; access_token?: string } = { expires };

		if (mode === 'json') {
			payload.access_token = accessToken;
		}

		if (mode === 'cookie') {
			res.cookie(
				env['REFRESH_TOKEN_COOKIE_NAME'] as string,
				refreshToken,
				REFRESH_COOKIE_OPTIONS,
			);

			payload.access_token = accessToken;
		}

		if (mode === 'session') {
			res.cookie(
				env['SESSION_COOKIE_NAME'] as string,
				accessToken,
				SESSION_COOKIE_OPTIONS,
			);
		}

		res.locals['payload'] = { data: payload };

		return next();
	}),
	respond,
);

router.delete(
	'/impersonate',
	asyncHandler(async (req, res, next) => {
		const { accountability } = req;

		if (!accountability?.impersonator || !accountability.session) {
			throw new InvalidPayloadError({ reason: 'Not impersonating in session mode' });
		}

		// The IMPERSONATE_END row is written where the session ends, whoever
		// ends it.
		const { accessToken, expires } = await new AuthenticationService({
			accountability,
			schema: req.schema,
		}).stopImpersonation(accountability.session);

		logger.info(
			`[impersonation] ${accountability.impersonator} stops impersonating `
			+ `${accountability.user}`,
		);

		res.cookie(
			env['SESSION_COOKIE_NAME'] as string,
			accessToken,
			SESSION_COOKIE_OPTIONS,
		);

		res.locals['payload'] = { data: { expires } };

		return next();
	}),
	respond,
);

router.get(
	'/impersonate',
	asyncHandler(async (req, res, next) => {
		const impersonator = req.accountability?.impersonator
			? await new UsersService({ schema: req.schema }).readOne(
				req.accountability.impersonator,
				{ fields: ['id', 'first_name', 'last_name'] },
			)
			: null;

		res.locals['payload'] = { data: { impersonator } };

		return next();
	}),
	respond,
);

router.get(
	'/',
	asyncHandler(async (req, res, next) => {
		const sessionOnly =
			'sessionOnly' in req.query && (req.query['sessionOnly'] === '' || Boolean(req.query['sessionOnly']));

		res.locals['payload'] = {
			data: getAuthProviders({ sessionOnly }),
			disableDefault: env['AUTH_DISABLE_DEFAULT'],
		};

		return next();
	}),
	respond,
);

export default router;
