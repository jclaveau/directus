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
import { oneLine, parseJSON, toArray } from '@directus/utils';
import express, { Router } from 'express';
import { flatten } from 'flat';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import type { Client } from 'openid-client';
import { custom, errors, generators, Issuer } from 'openid-client';
import { getAuthProvider } from '../../auth.js';
import { REFRESH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from '../../constants.js';
import { useLogger } from '../../logger/index.js';
import { respond } from '../../middleware/respond.js';
import { createDefaultAccountability } from '../../permissions/utils/create-default-accountability.js';
import { AuthenticationService } from '../../services/authentication.js';
import { UsersService } from '../../services/users.js';
import type {
	AuthData,
	AuthDriverOptions,
	IdentityLookupOptions,
	User,
	UserIdentity,
} from '../../types/index.js';
import type { RoleMap } from '../../types/rolemap.js';
import asyncHandler from '../../utils/async-handler.js';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { getIPFromReq } from '../../utils/get-ip-from-req.js';
import { getSecret } from '../../utils/get-secret.js';
import { isLoginRedirectAllowed } from '../../utils/is-login-redirect-allowed.js';
import { verifyJWT } from '../../utils/jwt.js';
import { Url } from '../../utils/url.js';
import { LocalAuthDriver } from './local.js';
import { getLinkUser } from '../utils/link-user.js';
import { loginSsoIdentity, updateIdentityAuthData } from '../utils/sso-identity.js';
import { isEmailUnverified, isEmailVouched } from '../utils/verified-email.js';

const DEFAULT_SCOPE = 'openid profile email';

export class OpenIDAuthDriver extends LocalAuthDriver {
	client: null | Client;
	redirectUrl: string;
	usersService: UsersService;
	config: Record<string, any>;
	roleMap: RoleMap;

	constructor(options: AuthDriverOptions, config: Record<string, any>) { // bb-out-of-scope: #622 OpenID login
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

		const redirectUrl = new Url(env['PUBLIC_URL'])
			.addPath('auth', 'login', provider, 'callback');

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

	private async getClient() { // bb-out-of-scope: #622 OpenID login
		if (this.client) return this.client;

		const logger = useLogger();

		const { issuerUrl, clientId, clientSecret, clientPrivateKeys, clientTokenEndpointAuthMethod, provider } =
			this.config;

		const isPrivateKeyJwtAuthMethod = clientTokenEndpointAuthMethod === 'private_key_jwt';

		// extract client http overrides/options
		const clientHttpOptions = getConfigFromEnv(`AUTH_${provider.toUpperCase()}_CLIENT_HTTP_`);

		if (clientHttpOptions) {
			Issuer[custom.http_options] = (_, options) => {
				return {
					...options,
					...clientHttpOptions,
				};
			};
		}

		const issuer = await Issuer.discover(issuerUrl);

		const supportedTypes = issuer.metadata['response_types_supported'] as string[] | undefined;

		if (!supportedTypes?.includes('code')) {
			logger.error('OpenID provider does not support required code flow');
			throw new InvalidProviderConfigError({
				provider,
			});
		}

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

		const client = new issuer.Client(
			{
				client_id: clientId,
				...(!isPrivateKeyJwtAuthMethod && { client_secret: clientSecret }),
				redirect_uris: [this.redirectUrl],
				response_types: ['code'],
				...clientOptionsOverrides,
			},
			isPrivateKeyJwtAuthMethod ? { keys: clientPrivateKeys } : undefined,
		);

		if (clientHttpOptions) {
			client[custom.http_options] = (_, options) => {
				return {
					...options,
					...clientHttpOptions,
				};
			};
		}

		this.client = client;

		return client;
	}

	generateCodeVerifier(): string {
		return generators.codeVerifier();
	}

	async generateAuthUrl(codeVerifier: string, prompt = false): Promise<string> { // bb-out-of-scope: #622 OpenID login
		const { plainCodeChallenge } = this.config;

		try {
			const client = await this.getClient();
			const codeChallenge = plainCodeChallenge ? codeVerifier : generators.codeChallenge(codeVerifier);
			const paramsConfig = typeof this.config['params'] === 'object' ? this.config['params'] : {};

			return client.authorizationUrl({
				scope: this.config['scope'] ?? DEFAULT_SCOPE,
				access_type: 'offline',
				prompt: prompt ? 'consent' : undefined,
				...paramsConfig,
				code_challenge: codeChallenge,
				code_challenge_method: plainCodeChallenge ? 'plain' : 'S256',
				// Some providers require state even with PKCE
				state: codeChallenge,
				nonce: codeChallenge,
			});
		} catch (e) {
			throw handleError(e);
		}
	}

	override async getUserID(payload: Record<string, any>): Promise<string> {
		const identity = await this.getIdentity(payload, { linkUser: null });

		return identity.user;
	}

	override async getIdentity(
		payload: Record<string, any>,
		options: IdentityLookupOptions,
	): Promise<UserIdentity> { // bb-out-of-scope: #622 OpenID login
		const logger = useLogger();

		if (!payload['code'] || !payload['codeVerifier'] || !payload['state']) {
			logger.warn('[OpenID] No code, codeVerifier or state in payload');
			throw new InvalidCredentialsError();
		}

		const { plainCodeChallenge } = this.config;

		let tokenSet;
		let userInfo;

		try {
			const client = await this.getClient();

			const codeChallenge = plainCodeChallenge
				? payload['codeVerifier']
				: generators.codeChallenge(payload['codeVerifier']);

			tokenSet = await client.callback(
				this.redirectUrl,
				{ code: payload['code'], state: payload['state'], iss: payload['iss'] },
				{ code_verifier: payload['codeVerifier'], state: codeChallenge, nonce: codeChallenge },
			);

			userInfo = tokenSet.claims();

			if (client.issuer.metadata['userinfo_endpoint']) {
				userInfo = {
					...userInfo,
					...(await client.userinfo(tokenSet.access_token!)),
				};
			}
		} catch (e) {
			throw handleError(e);
		}

		let role = this.config['defaultRoleId'];
		const groupClaimName: string = this.config['groupClaimName'] ?? 'groups';
		const groups = userInfo[groupClaimName] ? toArray(userInfo[groupClaimName]) : [];

		if (groups.length > 0) { // bb-out-of-scope: #753 provider roles
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

		const {
			provider,
			identifierKey,
			allowPublicRegistration,
			syncUserInfo,
		} = this.config;

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

		const emailUnverified = isEmailUnverified(
			this.config,
			userInfo['email_verified'],
		);

		// The email stands in for the identifier, so it can't be unverified
		if (emailUnverified && !userInfo[identifierKey ?? 'sub']) {
			logger.warn(oneLine`
				[OpenID] Unverified email can't be the identifier for provider
				${JSON.stringify(provider)}
			`);

			throw new InvalidCredentialsError();
		}

		const updatePayload: Record<string, unknown> = {
			auth_data: userPayload.auth_data,
		};

		// Make sure a user's role gets updated if their openid group or role mapping
		// changes
		if (this.config['roleMapping']) {
			updatePayload['role'] = role;
		}

		// OPEN(#772): the email still syncs only with syncUserInfo, as before identities
		if (syncUserInfo) {
			updatePayload['first_name'] = userPayload.first_name;
			updatePayload['last_name'] = userPayload.last_name;
			updatePayload['email'] = userPayload.email;
		}

		return await loginSsoIdentity({ knex: this.knex, schema: this.schema }, {
			logPrefix: '[OpenID]',
			provider,
			identifier,
			email,
			emailVerified: isEmailVouched(userInfo['email_verified']),
			emailUnverified,
			userInfo,
			scope: tokenSet.scope ?? this.config['scope'] ?? DEFAULT_SCOPE,
			updatePayload,
			createPayload: userPayload,
			hookMeta: {
				identifier,
				provider: this.config['provider'],
				providerPayload: { accessToken: tokenSet.access_token, idToken: tokenSet.id_token, userInfo },
			},
			allowPublicRegistration: Boolean(allowPublicRegistration),
			linkUser: options.linkUser,
		});
	}

	override async login(user: User): Promise<void> {
		return this.refresh(user);
	}

	override async refresh(user: User): Promise<void> { // bb-out-of-scope: #622 OpenID login
		const logger = useLogger();

		let authData = user.identity?.auth_data as AuthData;

		if (typeof authData === 'string') {
			try {
				authData = parseJSON(authData);
			} catch {
				logger.warn(`[OpenID] Session data isn't valid JSON: ${authData}`);
			}
		}

		if (authData?.['refreshToken']) {
			try {
				const client = await this.getClient();
				const tokenSet = await client.refresh(authData['refreshToken']);

				// Update user refreshToken if provided
				if (tokenSet.refresh_token && user.identity) {
					await updateIdentityAuthData(
						{ knex: this.knex, schema: this.schema },
						user.identity.id,
						JSON.stringify({ refreshToken: tokenSet.refresh_token }),
					);
				}
			} catch (e) {
				throw handleError(e);
			}
		}
	}
}

const handleError = (e: any) => {
	const logger = useLogger();

	if (e instanceof errors.OPError) {
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
	} else if (e instanceof errors.RPError) {
		// Internal client error
		logger.warn(e, `[OpenID] Unknown RP error`);
		return new InvalidCredentialsError();
	}

	logger.warn(e, `[OpenID] Unknown error`);
	return e;
};

export function createOpenIDAuthRouter(providerName: string): Router { // bb-out-of-scope: #622 OpenID login
	const env = useEnv();
	const router = Router();

	router.get(
		'/',
		asyncHandler(async (req, res) => {
			const provider = getAuthProvider(providerName) as OpenIDAuthDriver;
			const codeVerifier = provider.generateCodeVerifier();
			const prompt = !!req.query['prompt'];
			const redirect = req.query['redirect'];
			const linkUser = getLinkUser(req, req.query['link']);

			if (isLoginRedirectAllowed(redirect, providerName) === false) {
				throw new InvalidPayloadError({ reason: `URL "${redirect}" can't be used to redirect after login` });
			}

			const token = jwt.sign({
				verifier: codeVerifier,
				redirect,
				prompt,
				linkUser,
			}, getSecret(), {
				expiresIn: (
					env[`AUTH_${providerName.toUpperCase()}_LOGIN_TIMEOUT` as const] ?? '5m'
				) as StringValue | number,
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
					new Url(env['PUBLIC_URL'])
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
					linkUser?: string | null;
				};
			} catch (e: any) {
				logger.warn(e, `[OpenID] Couldn't verify OpenID cookie`);
				const url = new Url(env['PUBLIC_URL']).addPath('admin', 'login');
				return res.redirect(`${url.toString()}?reason=${ErrorCode.InvalidCredentials}`);
			}

			const { verifier, redirect, prompt, linkUser } = tokenData;

			const accountability: Accountability = createDefaultAccountability({ ip: getIPFromReq(req) });

			const userAgent = req.get('user-agent')?.substring(0, 1024);
			if (userAgent) accountability.userAgent = userAgent;

			const origin = req.get('origin');
			if (origin) accountability.origin = origin;

			const authenticationService = new AuthenticationService({
				accountability,
				schema: req.schema,
			});

			const authModeEnvVarName = `AUTH_${providerName.toUpperCase()}_MODE` as const;
			const authMode = env[authModeEnvVarName] ?? 'session';

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
					{ session: authMode === 'session', linkUser: linkUser ?? null },
				);
			} catch (error: any) {
				// Prompt user for a new refresh_token if invalidated
				if (isDirectusError(error, ErrorCode.InvalidToken) && !prompt) {
					return res.redirect(`./?${redirect
? `redirect=${redirect}&`
: ''}${linkUser
? 'link=true&'
: ''}prompt=true`);
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
					res.cookie(
						env['SESSION_COOKIE_NAME'],
						accessToken,
						SESSION_COOKIE_OPTIONS,
					);
				} else {
					res.cookie(
						env['REFRESH_TOKEN_COOKIE_NAME'],
						refreshToken,
						REFRESH_COOKIE_OPTIONS,
					);
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
