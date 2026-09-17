import { Action } from '@directus/constants';
import { useEnv } from '@directus/env';
import {
	InvalidCredentialsError,
	InvalidOtpError,
	ServiceUnavailableError,
	UserSuspendedError,
} from '@directus/errors';
import type { AbstractServiceOptions, Accountability, LoginResult, SchemaOverview } from '@directus/types';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import type { StringValue } from 'ms';
import { performance } from 'perf_hooks';
import { getAuthProvider } from '../auth.js';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import { fetchGlobalAccess } from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import { RateLimiterRes, createRateLimiter } from '../rate-limiter.js';
import type { DirectusTokenPayload, Session, User } from '../types/index.js';
import { actorFields } from '../utils/actor-fields.js';
import { endSessions } from '../utils/end-sessions.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { getSecret } from '../utils/get-secret.js';
import { clone, cloneDeep } from '../utils/lodash-es-used.js';
import { stall } from '../utils/stall.js';
import { ActivityService } from './activity.js';
import { SettingsService } from './settings.js';
import { TFAService } from './tfa.js';

const env = useEnv();

const loginAttemptsLimiter = createRateLimiter('RATE_LIMITER', { duration: 0 });

function accessTokenTtl(session: boolean | undefined): StringValue | number {
	return env[
		session
			? 'SESSION_COOKIE_TTL'
			: 'ACCESS_TOKEN_TTL'
	] as StringValue | number;
}

export class AuthenticationService {
	knex: Knex;
	accountability: Accountability | null;
	activityService: ActivityService;
	schema: SchemaOverview;

	constructor(options: AbstractServiceOptions) {
		this.knex = options.knex || getDatabase();
		this.accountability = options.accountability || null;
		this.activityService = new ActivityService({ knex: this.knex, schema: options.schema });
		this.schema = options.schema;
	}

	/**
	 * Retrieve the tokens for a given user email.
	 *
	 * Password is optional to allow usage of this function within the SSO flow and extensions. Make sure
	 * to handle password existence checks elsewhere
	 */
	async login(
		providerName: string = DEFAULT_AUTH_PROVIDER,
		payload: Record<string, any>,
		options?: Partial<{
			otp: string;
			session: boolean;
		}>,
	): Promise<LoginResult> {
		const { nanoid } = await import('nanoid');

		const STALL_TIME = env['LOGIN_STALL_TIME'] as number;
		const timeStart = performance.now();

		const provider = getAuthProvider(providerName);

		let userId;

		try {
			userId = await provider.getUserID(cloneDeep(payload));
		} catch (err) {
			await stall(STALL_TIME, timeStart);
			throw err;
		}

		const user = await this.knex
			.select<
				User & { tfa_secret: string | null }
			>('id', 'first_name', 'last_name', 'email', 'password', 'status', 'role', 'tfa_secret', 'provider', 'external_identifier', 'auth_data')
			.from('directus_users')
			.where('id', userId)
			.first();

		const updatedPayload = await emitter.emitFilter(
			'auth.login',
			payload,
			{
				status: 'pending',
				user: user?.id,
				provider: providerName,
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		const emitStatus = (status: 'fail' | 'success') => {
			emitter.emitAction(
				'auth.login',
				{
					payload: updatedPayload,
					status,
					user: user?.id,
					provider: providerName,
				},
				{
					database: this.knex,
					schema: this.schema,
					accountability: this.accountability,
				},
			);
		};

		if (user?.status !== 'active' || user?.provider !== providerName) {
			emitStatus('fail');
			await stall(STALL_TIME, timeStart);
			throw new InvalidCredentialsError();
		}

		const settingsService = new SettingsService({
			knex: this.knex,
			schema: this.schema,
		});

		const { auth_login_attempts: allowedAttempts } = await settingsService.readSingleton({
			fields: ['auth_login_attempts'],
		});

		if (allowedAttempts !== null) {
			loginAttemptsLimiter.points = allowedAttempts;

			try {
				await loginAttemptsLimiter.consume(user.id);
			} catch (error) {
				// Only a spent budget reaches the else below now — a Redis outage falls
				// back to a limiter that refuses nothing. See `rate-limiter.ts`.
				if (error instanceof RateLimiterRes && error.remainingPoints === 0) {
					await this.knex('directus_users').update({ status: 'suspended' }).where({ id: user.id });
					user.status = 'suspended';

					// This means that new attempts after the user has been re-activated will be accepted
					await loginAttemptsLimiter.set(user.id, 0, 0);
				} else {
					throw new ServiceUnavailableError({
						service: 'authentication',
						reason: 'Rate limiter unreachable',
					});
				}
			}
		}

		try {
			await provider.login(clone(user), cloneDeep(updatedPayload));
		} catch (e) {
			emitStatus('fail');
			await stall(STALL_TIME, timeStart);
			throw e;
		}

		if (user.tfa_secret && !options?.otp) {
			emitStatus('fail');
			await stall(STALL_TIME, timeStart);
			throw new InvalidOtpError();
		}

		if (user.tfa_secret && options?.otp) {
			const tfaService = new TFAService({ knex: this.knex, schema: this.schema });
			const otpValid = await tfaService.verifyOTP(user.id, options?.otp);

			if (otpValid === false) {
				emitStatus('fail');
				await stall(STALL_TIME, timeStart);
				throw new InvalidOtpError();
			}
		}

		const refreshToken = nanoid(64);
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(env['REFRESH_TOKEN_TTL'], 0));

		const { accessToken, expires } = await this.mint(user, {
			provider: providerName,
			type: 'login',
			ttl: accessTokenTtl(options?.session),
			...(options?.session && { session: refreshToken }),
		});

		await this.knex('directus_sessions').insert({
			token: refreshToken,
			user: user.id,
			expires: refreshTokenExpiration,
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
		});

		await this.knex('directus_sessions').delete().where('expires', '<', new Date());

		if (this.accountability) {
			await this.activityService.createOne({
				action: Action.LOGIN,
				...actorFields(this.accountability),
				user: user.id,
				collection: 'directus_users',
				item: user.id,
			});
		}

		await this.knex('directus_users').update({ last_access: new Date() }).where({ id: user.id });

		emitStatus('success');

		if (allowedAttempts !== null) {
			await loginAttemptsLimiter.set(user.id, 0, 0);
		}

		await stall(STALL_TIME, timeStart);

		return {
			accessToken,
			refreshToken,
			expires,
			id: user.id,
		};
	}

	async refresh(refreshToken: string, options?: Partial<{ session: boolean }>): Promise<LoginResult> {
		const { nanoid } = await import('nanoid');
		const STALL_TIME = env['LOGIN_STALL_TIME'] as number;
		const timeStart = performance.now();

		if (!refreshToken) {
			throw new InvalidCredentialsError();
		}

		const record = await this.knex
			.select({
				session_expires: 's.expires',
				session_next_token: 's.next_token',
				session_impersonator: 's.impersonator',
				session_impersonator_session: 's.impersonator_session',
				user_id: 'u.id',
				user_first_name: 'u.first_name',
				user_last_name: 'u.last_name',
				user_email: 'u.email',
				user_password: 'u.password',
				user_status: 'u.status',
				user_provider: 'u.provider',
				user_external_identifier: 'u.external_identifier',
				user_auth_data: 'u.auth_data',
				user_role: 'u.role',
				share_id: 'd.id',
				share_start: 'd.date_start',
				share_end: 'd.date_end',
			})
			.from('directus_sessions AS s')
			.leftJoin('directus_users AS u', 's.user', 'u.id')
			.leftJoin('directus_shares AS d', 's.share', 'd.id')
			.where('s.token', refreshToken)
			.andWhere('s.expires', '>=', new Date())
			.andWhere((subQuery) => {
				subQuery.whereNull('d.date_end').orWhere('d.date_end', '>=', new Date());
			})
			.andWhere((subQuery) => {
				subQuery.whereNull('d.date_start').orWhere('d.date_start', '<=', new Date());
			})
			.first();

		if (!record || (!record.share_id && !record.user_id)) {
			throw new InvalidCredentialsError();
		}

		if (record.user_id && record.user_status !== 'active') {
			await endSessions(this.knex, { tokens: [refreshToken] });

			if (record.user_status === 'suspended') {
				await stall(STALL_TIME, timeStart);
				throw new UserSuspendedError();
			} else {
				await stall(STALL_TIME, timeStart);
				throw new InvalidCredentialsError();
			}
		}

		const roles = await fetchRolesTree(record.user_role, this.knex);

		const globalAccess = await fetchGlobalAccess(
			{ user: record.user_id, roles, ip: this.accountability?.ip ?? null },
			this.knex,
		);

		// An impersonated session is the impersonator's doing, not the target's:
		// oauth2/openid would rotate the target's IdP refresh token, LDAP re-bind as
		// them, and `last_access` would say they were here.
		const impersonated = record.session_impersonator !== null;

		if (record.user_id && !impersonated) {
			const provider = getAuthProvider(record.user_provider);

			await provider.refresh({
				id: record.user_id,
				first_name: record.user_first_name,
				last_name: record.user_last_name,
				email: record.user_email,
				password: record.user_password,
				status: record.user_status,
				provider: record.user_provider,
				external_identifier: record.user_external_identifier,
				auth_data: record.user_auth_data,
				role: record.user_role,
				app_access: globalAccess.app,
				admin_access: globalAccess.admin,
			});
		}

		let newRefreshToken = record.session_next_token ?? nanoid(64);
		const sessionDuration = env[options?.session ? 'SESSION_COOKIE_TTL' : 'REFRESH_TOKEN_TTL'];
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(sessionDuration, 0));

		if (options?.session) {
			newRefreshToken = await this.updateStatefulSession(record, refreshToken, newRefreshToken, refreshTokenExpiration);
		} else {
			// Original stateless token behavior
			await this.knex('directus_sessions')
				.update({
					token: newRefreshToken,
					expires: refreshTokenExpiration,
				})
				.where({ token: refreshToken });
		}

		const { accessToken, expires } = await this.mint(
			{ id: record.user_id, role: record.user_role },
			{
				provider: record.user_provider,
				type: 'refresh',
				ttl: accessTokenTtl(options?.session),
				...(options?.session && { session: newRefreshToken }),
				...(record.share_id && { share: record.share_id }),
				...(impersonated && { impersonator: record.session_impersonator }),
			},
		);

		if (record.user_id && !impersonated) {
			await this.knex('directus_users')
				.update({ last_access: new Date() })
				.where({ id: record.user_id });
		}

		// The browser holds the impersonated cookie now, so nothing else refreshes
		// the impersonator's own row — and Stop re-signs their cookie from it.
		if (record.session_impersonator_session) {
			await this.knex('directus_sessions')
				.update({ expires: refreshTokenExpiration })
				.where({ token: record.session_impersonator_session });
		}

		// Clear expired sessions for the current user
		await this.knex('directus_sessions')
			.delete()
			.where({
				user: record.user_id,
				share: record.share_id,
			})
			.andWhere('expires', '<', new Date());

		return {
			accessToken,
			refreshToken: newRefreshToken,
			expires,
			id: record.user_id,
		};
	}

	/**
	 * Sign an access token for a user: the roles tree and global access are read
	 * fresh, the claims pass the `auth.jwt` filter, and whatever the caller asks to
	 * ride along (a session token, a share) is on the payload the filter sees. A
	 * share token names no user and holds no access, whoever opened it.
	 */
	private async mint(
		user: { id: string | null; role: string | null },
		options: {
			provider: string;
			type: 'login' | 'refresh' | 'impersonate';
			ttl: StringValue | number;
			session?: string;
			share?: string;
			impersonator?: string;
		},
	): Promise<{ accessToken: string; expires: number }> {
		const roles = await fetchRolesTree(user.role, this.knex);

		const globalAccess = await fetchGlobalAccess(
			{ roles, user: user.id, ip: this.accountability?.ip ?? null },
			this.knex,
		);

		const tokenPayload: DirectusTokenPayload = {
			...(user.id !== null && { id: user.id }),
			role: user.role,
			app_access: globalAccess.app,
			admin_access: globalAccess.admin,
		};

		if (options.session) {
			tokenPayload.session = options.session;
		}

		if (options.impersonator) {
			tokenPayload.impersonator = options.impersonator;
		}

		if (options.share) {
			tokenPayload.share = options.share;
			tokenPayload.role = null;

			tokenPayload.app_access = false;
			tokenPayload.admin_access = false;

			delete tokenPayload.id;
		}

		const customClaims = await emitter.emitFilter(
			'auth.jwt',
			tokenPayload,
			{
				status: 'pending',
				user: user.id ?? undefined,
				provider: options.provider,
				type: options.type,
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		const accessToken = jwt.sign(customClaims, getSecret(), {
			expiresIn: options.ttl,
			issuer: 'directus',
		});

		return { accessToken, expires: getMilliseconds(options.ttl) };
	}

	private async updateStatefulSession(
		sessionRecord: Record<string, any>,
		oldSessionToken: string,
		newSessionToken: string,
		sessionExpiration: Date,
	): Promise<string> {
		if (sessionRecord['session_next_token']) {
			// The current session token was already refreshed and has a reference
			// to the new session, update the new session timeout for the new refresh
			await this.knex('directus_sessions')
				.update({
					expires: sessionExpiration,
				})
				.where({ token: newSessionToken });

			return newSessionToken;
		}

		// Keep the old session active for a short period of time
		const GRACE_PERIOD = getMilliseconds(env['SESSION_REFRESH_GRACE_PERIOD'], 10_000);

		// Update the existing session record to have a short safety timeout
		// before expiring, and add the reference to the new session token
		const updatedSession = await this.knex('directus_sessions')
			.update(
				{
					next_token: newSessionToken,
					expires: new Date(Date.now() + GRACE_PERIOD),
				},
				['next_token'],
			)
			.where({ token: oldSessionToken, next_token: null });

		if (updatedSession.length === 0) {
			// Don't create a new session record, we already have a "next_token" reference
			const { next_token } = await this.knex('directus_sessions')
				.select('next_token')
				.where({ token: oldSessionToken })
				.first();

			return next_token;
		}

		// Instead of updating the current session record with a new token,
		// create a new copy with the new token
		await this.knex('directus_sessions').insert({
			token: newSessionToken,
			user: sessionRecord['user_id'],
			share: sessionRecord['share_id'],
			impersonator: sessionRecord['session_impersonator'],
			impersonator_session: sessionRecord['session_impersonator_session'],
			expires: sessionExpiration,
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
		});

		return newSessionToken;
	}

	async logout(refreshToken: string): Promise<void> {
		const record = await this.knex
			.select<
				User & Session
			>('u.id', 'u.first_name', 'u.last_name', 'u.email', 'u.password', 'u.status', 'u.role', 'u.provider', 'u.external_identifier', 'u.auth_data')
			.from('directus_sessions as s')
			.innerJoin('directus_users as u', 's.user', 'u.id')
			.where('s.token', refreshToken)
			.first();

		if (record) {
			const user = record;

			const provider = getAuthProvider(user.provider);
			await provider.logout(clone(user));

			await endSessions(this.knex, { tokens: [refreshToken] });
		}
	}

	async verifyPassword(userID: string, password: string): Promise<void> {
		const user = await this.knex
			.select<User>(
				'id',
				'first_name',
				'last_name',
				'email',
				'password',
				'status',
				'role',
				'provider',
				'external_identifier',
				'auth_data',
			)
			.from('directus_users')
			.where('id', userID)
			.first();

		if (!user) {
			throw new InvalidCredentialsError();
		}

		const provider = getAuthProvider(user.provider);
		await provider.verify(clone(user), password);
	}
}
