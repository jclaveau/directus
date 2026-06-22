import { useEnv } from '@directus/env';
import {
	ErrorCode,
	InvalidCredentialsError,
	InvalidPayloadError,
	InvalidProviderConfigError,
	InvalidProviderError,
	InvalidTokenError,
	isDirectusError,
	ServiceUnavailableError,
} from '@directus/errors';
import type { Accountability } from '@directus/types';
import { parseJSON, toArray } from '@directus/utils';
import express, { Router } from 'express';
import { flatten } from 'flat';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import {
	allowInsecureRequests,
	authorizationCodeGrant,
	AuthorizationResponseError,
	buildAuthorizationUrl,
	calculatePKCECodeChallenge,
	ClientSecretBasic,
	ClientSecretPost,
	type ClientAuth,
	type Configuration,
	customFetch,
	discovery,
	fetchUserInfo,
	PrivateKeyJwt,
	randomPKCECodeVerifier,
	refreshTokenGrant,
	ResponseBodyError,
	skipSubjectCheck,
} from 'openid-client';
import { getAuthProvider } from '../../auth.js';
import { REFRESH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from '../../constants.js';
import getDatabase from '../../database/index.js';
import emitter from '../../emitter.js';
import { useLogger } from '../../logger/index.js';
import { respond } from '../../middleware/respond.js';
import { createDefaultAccountability } from '../../permissions/utils/create-default-accountability.js';
import { AuthenticationService } from '../../services/authentication.js';
import { UsersService } from '../../services/users.js';
import type { AuthData, AuthDriverOptions, User } from '../../types/index.js';
import type { RoleMap } from '../../types/rolemap.js';
import asyncHandler from '../../utils/async-handler.js';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { getIPFromReq } from '../../utils/get-ip-from-req.js';
import { getSecret } from '../../utils/get-secret.js';
import { isLoginRedirectAllowed } from '../../utils/is-login-redirect-allowed.js';
import { verifyJWT } from '../../utils/jwt.js';
import { Url } from '../../utils/url.js';
import { LocalAuthDriver } from './local.js';

export class OpenIDAuthDriver extends LocalAuthDriver {
	// openid-client v6 replaced the Issuer/Client classes with a functional API around a Configuration
	client: null | Configuration;
	redirectUrl: string;
	usersService: UsersService;
	config: Record<string, any>;
	roleMap: RoleMap;

	constructor(options: AuthDriverOptions, config: Record<string, any>) {
		super(options, config);

		const env = useEnv();
		const logger = useLogger();

		const {
			issuerUrl,
			clientId,
			clientSecret,
			clientPrivateKeys,
			clientTokenEndpointAuthMethod,
			provider,
			issuerDiscoveryMustSucceed,
		} = config;

		const isPrivateKeyJwtAuthMethod = clientTokenEndpointAuthMethod === 'private_key_jwt';

		if (!issuerUrl || !clientId || !(clientSecret || (isPrivateKeyJwtAuthMethod && clientPrivateKeys)) || !provider) {
			logger.error('Invalid provider config');
			throw new InvalidProviderConfigError({ provider });
		}

		const redirectUrl = new Url(env['PUBLIC_URL'] as string).addPath('auth', 'login', provider, 'callback');

		this.redirectUrl = redirectUrl.toString();
		this.usersService = new UsersService({ knex: this.knex, schema: this.schema });
		this.config = config;
		this.roleMap = {};

		const roleMapping = this.config['roleMapping'];

		if (roleMapping) {
			this.roleMap = roleMapping;
		}

		// role mapping will fail on login if AUTH_<provider>_ROLE_MAPPING is an array instead of an object.
		// This happens if the 'json:' prefix is missing from the variable declaration. To save the user from exhaustive debugging, we'll try to fail early here.
		if (roleMapping instanceof Array) {
			logger.error(
				"[OpenID] Expected a JSON-Object as role mapping, got an Array instead. Make sure you declare the variable with 'json:' prefix.",
			);

			throw new InvalidProviderError();
		}

		this.client = null;

		// preload client
		this.getClient().catch((e) => {
			logger.error(e, '[OpenID] Failed to fetch provider config');

			if (issuerDiscoveryMustSucceed !== false) {
				logger.error(
					`AUTH_${provider.toUpperCase()}_ISSUER_DISCOVERY_MUST_SUCCEED is enabled and discovery failed, exiting`,
				);

				process.exit(1);
			}
		});
	}

	private async getClient() {
		if (this.client) return this.client;

		const logger = useLogger();

		const { issuerUrl, clientId, clientSecret, clientPrivateKeys, clientTokenEndpointAuthMethod, provider } =
			this.config;

		// openid-client v6 uses a fetch override rather than got-style http_options
		const clientHttpOptions = getConfigFromEnv(`AUTH_${provider.toUpperCase()}_CLIENT_HTTP_`);
		const fetchOverride = createCustomFetch(clientHttpOptions);

		// extract client overrides/options excluding CLIENT_ID and CLIENT_SECRET as they are passed directly
		const clientOptionsOverrides = getConfigFromEnv(`AUTH_${provider.toUpperCase()}_CLIENT_`, {
			omitKey: [
				`AUTH_${provider.toUpperCase()}_CLIENT_ID`,
				`AUTH_${provider.toUpperCase()}_CLIENT_SECRET`,
				`AUTH_${provider.toUpperCase()}_CLIENT_PRIVATE_KEYS`,
			],
			omitPrefix: [`AUTH_${provider.toUpperCase()}_CLIENT_HTTP_`],
			type: 'underscore',
		});

		const config = await discovery(
			new URL(issuerUrl),
			clientId,
			{
				redirect_uris: [this.redirectUrl],
				response_types: ['code'],
				...clientOptionsOverrides,
			},
			getClientAuth(clientTokenEndpointAuthMethod, clientSecret, clientPrivateKeys),
			{
				...(fetchOverride && { [customFetch]: fetchOverride }),
				// allow plain-http issuers only when explicitly opted in via the insecure http option
				...(clientHttpOptions?.['insecure'] && { execute: [allowInsecureRequests] }),
			},
		);

		const supportedTypes = config.serverMetadata()['response_types_supported'] as string[] | undefined;

		if (!supportedTypes?.includes('code')) {
			logger.error('OpenID provider does not support required code flow');
			throw new InvalidProviderConfigError({
				provider,
			});
		}

		this.client = config;

		return config;
	}

	generateCodeVerifier(): string {
		return randomPKCECodeVerifier();
	}

	async generateAuthUrl(codeVerifier: string, prompt = false): Promise<string> {
		const { plainCodeChallenge } = this.config;

		try {
			const config = await this.getClient();
			const codeChallenge = plainCodeChallenge ? codeVerifier : await calculatePKCECodeChallenge(codeVerifier);
			const paramsConfig = typeof this.config['params'] === 'object' ? this.config['params'] : {};

			// buildAuthorizationUrl takes a flat Record<string, string>; drop undefined values
			const parameters: Record<string, string> = {
				scope: this.config['scope'] ?? 'openid profile email',
				access_type: 'offline',
				...(prompt && { prompt: 'consent' }),
				...paramsConfig,
				code_challenge: codeChallenge,
				code_challenge_method: plainCodeChallenge ? 'plain' : 'S256',
				// Some providers require state even with PKCE
				state: codeChallenge,
				nonce: codeChallenge,
			};

			return buildAuthorizationUrl(config, parameters).href;
		} catch (e) {
			throw handleError(e);
		}
	}

	private async fetchUserId(identifier: string): Promise<string | undefined> {
		const user = await this.knex
			.select('id')
			.from('directus_users')
			.whereRaw('LOWER(??) = ?', ['external_identifier', identifier.toLowerCase()])
			.first();

		return user?.id;
	}

	override async getUserID(payload: Record<string, any>): Promise<string> {
		const logger = useLogger();

		if (!payload['code'] || !payload['codeVerifier'] || !payload['state']) {
			logger.warn('[OpenID] No code, codeVerifier or state in payload');
			throw new InvalidCredentialsError();
		}

		const { plainCodeChallenge } = this.config;

		let tokenSet;
		let userInfo: Record<string, any>;

		try {
			const config = await this.getClient();

			const codeChallenge = plainCodeChallenge
				? payload['codeVerifier']
				: await calculatePKCECodeChallenge(payload['codeVerifier']);

			// reconstruct the URL the IdP redirected back to; authorizationCodeGrant reads the params
			const currentUrl = new URL(this.redirectUrl);
			currentUrl.searchParams.set('code', payload['code']);
			currentUrl.searchParams.set('state', payload['state']);
			if (payload['iss']) currentUrl.searchParams.set('iss', payload['iss']);

			tokenSet = await authorizationCodeGrant(config, currentUrl, {
				pkceCodeVerifier: payload['codeVerifier'],
				expectedState: codeChallenge,
				expectedNonce: codeChallenge,
			});

			userInfo = tokenSet.claims() ?? {};

			if (config.serverMetadata()['userinfo_endpoint']) {
				userInfo = {
					...userInfo,
					...(await fetchUserInfo(config, tokenSet.access_token, (userInfo['sub'] as string) ?? skipSubjectCheck)),
				};
			}
		} catch (e) {
			throw handleError(e);
		}

		let role = this.config['defaultRoleId'];
		const groupClaimName: string = this.config['groupClaimName'] ?? 'groups';
		const groups = userInfo[groupClaimName] ? toArray(userInfo[groupClaimName]) : [];

		if (groups.length > 0) {
			for (const key in this.roleMap) {
				if (groups.includes(key)) {
					// Overwrite default role if user is member of a group specified in roleMap
					role = this.roleMap[key];
					break;
				}
			}
		} else if (Object.keys(this.roleMap).length > 0) {
			logger.debug(`[OpenID] Configured group claim with name "${groupClaimName}" does not exist or is empty.`);
		}

		// Flatten response to support dot indexes
		userInfo = flatten(userInfo) as Record<string, unknown>;

		const { provider, identifierKey, allowPublicRegistration, requireVerifiedEmail, syncUserInfo } = this.config;

		const email = userInfo['email'] ? String(userInfo['email']) : undefined;
		// Fallback to email if explicit identifier not found
		const identifier = userInfo[identifierKey ?? 'sub'] ? String(userInfo[identifierKey ?? 'sub']) : email;

		if (!identifier) {
			logger.warn(`[OpenID] Failed to find user identifier for provider "${provider}"`);
			throw new InvalidCredentialsError();
		}

		const userPayload = {
			provider,
			first_name: userInfo['given_name'],
			last_name: userInfo['family_name'],
			email: email,
			external_identifier: identifier,
			role: role,
			auth_data: tokenSet.refresh_token && JSON.stringify({ refreshToken: tokenSet.refresh_token }),
		};

		const userId = await this.fetchUserId(identifier);

		if (userId) {
			// Run hook so the end user has the chance to augment the
			// user that is about to be updated
			let emitPayload: Record<string, unknown> = {
				auth_data: userPayload.auth_data,
			};

			// Make sure a user's role gets updated if their openid group or role mapping changes
			if (this.config['roleMapping']) {
				emitPayload['role'] = role;
			}

			if (syncUserInfo) {
				emitPayload = {
					...emitPayload,
					first_name: userPayload.first_name,
					last_name: userPayload.last_name,
					email: userPayload.email,
				};
			}

			const updatedUserPayload = await emitter.emitFilter(
				`auth.update`,
				emitPayload,
				{
					identifier,
					provider: this.config['provider'],
					providerPayload: { accessToken: tokenSet.access_token, idToken: tokenSet.id_token, userInfo },
				},
				{ database: getDatabase(), schema: this.schema, accountability: null },
			);

			// Update user to update refresh_token and other properties that might have changed
			if (Object.values(updatedUserPayload).some((value) => value !== undefined)) {
				await this.usersService.updateOne(userId, updatedUserPayload);
			}

			return userId;
		}

		const isEmailVerified = !requireVerifiedEmail || userInfo['email_verified'];

		// Is public registration allowed?
		if (!allowPublicRegistration || !isEmailVerified) {
			logger.warn(`[OpenID] User doesn't exist, and public registration not allowed for provider "${provider}"`);
			throw new InvalidCredentialsError();
		}

		// Run hook so the end user has the chance to augment the
		// user that is about to be created
		const updatedUserPayload = await emitter.emitFilter(
			`auth.create`,
			userPayload,
			{
				identifier,
				provider: this.config['provider'],
				providerPayload: { accessToken: tokenSet.access_token, idToken: tokenSet.id_token, userInfo },
			},
			{ database: getDatabase(), schema: this.schema, accountability: null },
		);

		try {
			await this.usersService.createOne(updatedUserPayload);
		} catch (e) {
			if (isDirectusError(e, ErrorCode.RecordNotUnique)) {
				logger.warn(e, '[OpenID] Failed to register user. User not unique');
				throw new InvalidProviderError();
			}

			throw e;
		}

		return (await this.fetchUserId(identifier)) as string;
	}

	override async login(user: User): Promise<void> {
		return this.refresh(user);
	}

	override async refresh(user: User): Promise<void> {
		const logger = useLogger();

		let authData = user.auth_data as AuthData;

		if (typeof authData === 'string') {
			try {
				authData = parseJSON(authData);
			} catch {
				logger.warn(`[OpenID] Session data isn't valid JSON: ${authData}`);
			}
		}

		if (authData?.['refreshToken']) {
			try {
				const config = await this.getClient();
				const tokenSet = await refreshTokenGrant(config, authData['refreshToken']);

				// Update user refreshToken if provided
				if (tokenSet.refresh_token) {
					await this.usersService.updateOne(user.id, {
						auth_data: JSON.stringify({ refreshToken: tokenSet.refresh_token }),
					});
				}
			} catch (e) {
				throw handleError(e);
			}
		}
	}
}

const handleError = (e: any) => {
	const logger = useLogger();

	// openid-client v6 surfaces server-side errors as ResponseBodyError (token endpoint) or
	// AuthorizationResponseError (authorization redirect), both carrying `error`/`error_description`.
	if (e instanceof ResponseBodyError || e instanceof AuthorizationResponseError) {
		if (e.error === 'invalid_grant') {
			// Invalid token
			logger.warn(e, `[OpenID] Invalid grant`);
			return new InvalidTokenError();
		}

		// Server response error
		logger.warn(e, `[OpenID] Unknown OP error`);
		return new ServiceUnavailableError({
			service: 'openid',
			reason: `Service returned unexpected response: ${e.error_description}`,
		});
	}

	logger.warn(e, `[OpenID] Unknown error`);
	return e;
};

// openid-client v6 replaced the token_endpoint_auth_method client metadata field with explicit
// ClientAuth helpers passed to discovery().
function getClientAuth(method: string | undefined, clientSecret: string, clientPrivateKeys: unknown): ClientAuth {
	switch (method) {
		case 'private_key_jwt':
			// TODO(openid-client v6): clientPrivateKeys is a JWKS, but PrivateKeyJwt expects a single
			// CryptoKey/PrivateKey — convert (e.g. via jose.importJWK) before enabling this auth method.
			return PrivateKeyJwt(clientPrivateKeys as Parameters<typeof PrivateKeyJwt>[0]);
		case 'client_secret_post':
			return ClientSecretPost(clientSecret);
		case 'client_secret_basic':
		default:
			return ClientSecretBasic(clientSecret);
	}
}

// v6 dropped got-style http_options for a Fetch override. Map the common overrides (extra headers,
// request timeout); advanced got options (agent/proxy) would need an undici dispatcher instead.
function createCustomFetch(httpOptions: Record<string, any> | undefined) {
	if (!httpOptions || Object.keys(httpOptions).length === 0) return undefined;

	const { headers, timeout } = httpOptions;

	return (url: string, options: RequestInit & { headers?: Record<string, string> }) =>
		fetch(url, {
			...options,
			headers: { ...options?.headers, ...(headers ?? {}) },
			...(timeout && { signal: AbortSignal.timeout(Number(timeout)) }),
		});
}

export function createOpenIDAuthRouter(providerName: string): Router {
	const env = useEnv();
	const router = Router();

	router.get(
		'/',
		asyncHandler(async (req, res) => {
			const provider = getAuthProvider(providerName) as OpenIDAuthDriver;
			const codeVerifier = provider.generateCodeVerifier();
			const prompt = !!req.query['prompt'];
			const redirect = req.query['redirect'];

			if (isLoginRedirectAllowed(redirect, providerName) === false) {
				throw new InvalidPayloadError({ reason: `URL "${redirect}" can't be used to redirect after login` });
			}

			const token = jwt.sign({ verifier: codeVerifier, redirect, prompt }, getSecret(), {
				expiresIn: (env[`AUTH_${providerName.toUpperCase()}_LOGIN_TIMEOUT`] ?? '5m') as StringValue | number,
				issuer: 'directus',
			});

			res.cookie(`openid.${providerName}`, token, {
				httpOnly: true,
				sameSite: 'lax',
			});

			try {
				return res.redirect(await provider.generateAuthUrl(codeVerifier, prompt));
			} catch {
				return res.redirect(
					new Url(env['PUBLIC_URL'] as string)
						.addPath('admin', 'login')
						.setQuery('reason', ErrorCode.ServiceUnavailable)
						.toString(),
				);
			}
		}),
		respond,
	);

	router.post(
		'/callback',
		express.urlencoded({ extended: false }),
		(req, res) => {
			res.redirect(303, `./callback?${new URLSearchParams(req.body)}`);
		},
		respond,
	);

	router.get(
		'/callback',
		asyncHandler(async (req, res, next) => {
			const env = useEnv();
			const logger = useLogger();

			let tokenData;

			try {
				tokenData = verifyJWT(req.cookies[`openid.${providerName}`], getSecret()) as {
					verifier: string;
					redirect?: string;
					prompt: boolean;
				};
			} catch (e: any) {
				logger.warn(e, `[OpenID] Couldn't verify OpenID cookie`);
				const url = new Url(env['PUBLIC_URL'] as string).addPath('admin', 'login');
				return res.redirect(`${url.toString()}?reason=${ErrorCode.InvalidCredentials}`);
			}

			const { verifier, redirect, prompt } = tokenData;

			const accountability: Accountability = createDefaultAccountability({ ip: getIPFromReq(req) });

			const userAgent = req.get('user-agent')?.substring(0, 1024);
			if (userAgent) accountability.userAgent = userAgent;

			const origin = req.get('origin');
			if (origin) accountability.origin = origin;

			const authenticationService = new AuthenticationService({
				accountability,
				schema: req.schema,
			});

			const authMode = (env[`AUTH_${providerName.toUpperCase()}_MODE`] ?? 'session') as string;

			let authResponse;

			try {
				res.clearCookie(`openid.${providerName}`);

				authResponse = await authenticationService.login(
					providerName,
					{
						code: req.query['code'],
						codeVerifier: verifier,
						state: req.query['state'],
						iss: req.query['iss'],
					},
					{ session: authMode === 'session' },
				);
			} catch (error: any) {
				// Prompt user for a new refresh_token if invalidated
				if (isDirectusError(error, ErrorCode.InvalidToken) && !prompt) {
					return res.redirect(`./?${redirect ? `redirect=${redirect}&` : ''}prompt=true`);
				}

				logger.warn(error);

				if (redirect) {
					let reason = 'UNKNOWN_EXCEPTION';

					if (isDirectusError(error)) {
						reason = error.code;
					} else {
						logger.warn(error, `[OpenID] Unexpected error during OpenID login`);
					}

					return res.redirect(`${redirect.split('?')[0]}?reason=${reason}`);
				}

				logger.warn(error, `[OpenID] Unexpected error during OpenID login`);
				throw error;
			}

			const { accessToken, refreshToken, expires } = authResponse;

			if (redirect) {
				if (authMode === 'session') {
					res.cookie(env['SESSION_COOKIE_NAME'] as string, accessToken, SESSION_COOKIE_OPTIONS);
				} else {
					res.cookie(env['REFRESH_TOKEN_COOKIE_NAME'] as string, refreshToken, REFRESH_COOKIE_OPTIONS);
				}

				return res.redirect(redirect);
			}

			res.locals['payload'] = {
				data: { access_token: accessToken, refresh_token: refreshToken, expires },
			};

			next();
		}),
		respond,
	);

	return router;
}
