import { Action } from '@directus/constants';
import { useEnv } from '@directus/env';
import {
	ForbiddenError,
	InvalidCredentialsError,
	InvalidOtpError,
	InvalidPayloadError,
	ServiceUnavailableError,
	UserSuspendedError,
} from '@directus/errors';
import type { AbstractServiceOptions, Accountability, LoginResult, SchemaOverview } from '@directus/types';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import type { StringValue } from 'ms';
import { performance } from 'perf_hooks';
import { getAuthProvider } from '../auth.js';
import { BOTS_ROLE } from '../bots.js';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import { fetchGlobalAccess } from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import { RateLimiterRes, createRateLimiter } from '../rate-limiter.js';
import type {
	AuthenticationMode,
	DirectusTokenPayload,
	ImpersonationResult,
	Session,
	User,
} from '../types/index.js';
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
				impersonator_status: 'i.status',
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
			.leftJoin('directus_users AS i', 's.impersonator', 'i.id')
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

		const impersonated = record.session_impersonator !== null;

		// A suspended impersonator acts for nobody; their kick ends this row when
		// the status changes through the service, this is for one changed beside it
		if (impersonated && record.impersonator_status !== 'active') {
			await endSessions(this.knex, { tokens: [refreshToken] });
			throw new InvalidCredentialsError();
		}

		// An impersonated session is the impersonator's doing, not the target's:
		// oauth2/openid would rotate the target's IdP refresh token, LDAP re-bind as
		// them, and `last_access` would say they were here.

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
	 * Act as another user. The token is the target's — their role, permissions and
	 * `$CURRENT_USER` — and names the impersonator, so every row it writes does
	 * too. Nothing of the login path runs: no provider, no rate limiter, no
	 * activity, no `last_access`; the endpoint writes the trail's start, once.
	 *
	 * `json` is a stateless token capped by `IMPERSONATION_TTL` (it cannot be
	 * ended from outside, so it stays short). `cookie` and `session` open a row
	 * carrying the impersonator, ended by logout, Stop, or the cascade on the
	 * impersonator's own session — which `session` records, since Stop re-signs
	 * the impersonator's cookie from it.
	 */
	async impersonate(
		target: string,
		options: {
			impersonator: string;
			mode: AuthenticationMode;
			ttl?: StringValue | number;
		},
	): Promise<ImpersonationResult> {
		const { nanoid } = await import('nanoid');

		if (target === options.impersonator) {
			throw new ForbiddenError({ reason: 'impersonation_self' });
		}

		const users = await this.knex
			.select('id', 'role', 'status', 'provider')
			.from('directus_users')
			.whereIn('id', [target, options.impersonator]);

		const impersonator = users.find((user) => user.id === options.impersonator);
		const user = users.find((user) => user.id === target);

		// A suspended bot is that job's kill switch, a suspended admin no longer
		// acts for anyone.
		if (impersonator?.status !== 'active') {
			throw new ForbiddenError({ reason: 'impersonation_impersonator_inactive' });
		}

		// The JWT path never checks a user's status: mint time is the one place.
		if (user?.status !== 'active') {
			throw new ForbiddenError({ reason: 'impersonation_target_inactive' });
		}

		if (user.role === BOTS_ROLE) {
			throw new ForbiddenError({ reason: 'impersonation_target_bot' });
		}

		if (options.mode === 'session') {
			// The app hydrates nothing without app access: a blank Data Studio.
			const access = await fetchGlobalAccess(
				{
					roles: await fetchRolesTree(user.role, this.knex),
					user: user.id,
					ip: this.accountability?.ip ?? null,
				},
				this.knex,
			);

			if (!access.app) {
				throw new ForbiddenError({ reason: 'impersonation_target_no_app_access' });
			}

			// Stop restores the impersonator's cookie from their own row; a caller
			// without one has nothing to come back to.
			if (!this.accountability?.session) {
				throw new InvalidPayloadError({
					reason: 'Session mode needs the impersonator to be on a session cookie',
				});
			}
		}

		if (options.mode === 'json') {
			const { accessToken, expires } = await this.mint(user, {
				provider: user.provider,
				type: 'impersonate',
				ttl: options.ttl ?? (env['IMPERSONATION_TTL'] as StringValue),
				impersonator: impersonator.id,
			});

			return { accessToken, expires, id: user.id };
		}

		const session = options.mode === 'session';
		const refreshToken = nanoid(64);

		const { accessToken, expires } = await this.mint(user, {
			provider: user.provider,
			type: 'impersonate',
			ttl: accessTokenTtl(session),
			...(session && { session: refreshToken }),
			impersonator: impersonator.id,
		});

		const rowTtl = env[
			session
				? 'SESSION_COOKIE_TTL'
				: 'REFRESH_TOKEN_TTL'
		];

		await this.knex('directus_sessions').insert({
			token: refreshToken,
			user: user.id,
			expires: new Date(Date.now() + getMilliseconds(rowTtl, 0)),
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
			impersonator: impersonator.id,
			impersonator_session: session
				? this.accountability!.session
				: null,
		});

		return { accessToken, refreshToken, expires, id: user.id };
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
			type: 'login' | 'refresh' | 'impersonate' | 'impersonate_end';
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
			.select<User & Session>(
				'u.id',
				'u.first_name',
				'u.last_name',
				'u.email',
				'u.password',
				'u.status',
				'u.role',
				'u.provider',
				'u.external_identifier',
				'u.auth_data',
				's.impersonator',
				's.impersonator_session',
				's.next_token',
			)
			.from('directus_sessions as s')
			.innerJoin('directus_users as u', 's.user', 'u.id')
			.where('s.token', refreshToken)
			.first();

		if (record) {
			const user = record;

			// The IdP session behind the row is the target's own, not the
			// impersonator's to end.
			if (record.impersonator === null) {
				await getAuthProvider(user.provider).logout(clone(user));
			}

			// A logout under impersonation is a logout: the impersonator's own row
			// goes with it, and Stop is the only way back to it. A row rotated under
			// the caller within the grace period goes too.
			const tokens = [refreshToken, record.next_token, record.impersonator_session];

			await endSessions(this.knex, {
				tokens: tokens.filter((token): token is string => typeof token === 'string'),
			});
		}
	}

	/**
	 * Stop impersonating in session mode: end the impersonated row and sign the
	 * impersonator's own session again. The row is the proof, no password.
	 */
	async stopImpersonation(
		sessionToken: string,
	): Promise<{ accessToken: string; expires: number }> {
		const row = await this.knex
			.select('token', 'next_token', 'impersonator', 'impersonator_session')
			.from('directus_sessions')
			.where({ token: sessionToken })
			.first();

		if (!row?.impersonator || !row.impersonator_session) {
			throw new InvalidPayloadError({ reason: 'Not impersonating in session mode' });
		}

		// The row rotated under the caller within the grace period: end both.
		await endSessions(this.knex, {
			tokens: row.next_token === null
				? [row.token]
				: [row.token, row.next_token],
		});

		const impersonator = await this.knex
			.select('u.id', 'u.role', 'u.provider', 'u.status')
			.from('directus_sessions as s')
			.innerJoin('directus_users as u', 's.user', 'u.id')
			.where('s.token', row.impersonator_session)
			.andWhere('s.expires', '>=', new Date())
			.first();

		// Their own session ended meanwhile (a kick, an expiry): the cookie the
		// caller gets back would name a row that is gone, so give none.
		if (impersonator?.status !== 'active') {
			throw new InvalidCredentialsError();
		}

		return await this.mint(impersonator, {
			provider: impersonator.provider,
			type: 'impersonate_end',
			ttl: accessTokenTtl(true),
			session: row.impersonator_session,
		});
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
