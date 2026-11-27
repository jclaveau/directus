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
import { performance } from 'node:perf_hooks';
import argon2 from 'argon2';
import { findAuthProvider, getAuthProvider } from '../auth.js';
import {
	EMAIL_IDENTITY_KIND,
	fetchIdentityById,
	toProviderName,
} from '../auth/utils/user-identities.js';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import {
	createScopedCacheExtensionHandle,
} from '../extensions/lib/scoped-cache-handle.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import { fetchGlobalAccess } from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import { RateLimiterRes, createRateLimiter } from '../rate-limiter.js';
import { scopedCachePurgeEnabled } from '../scoped-cache/index.js';
import type {
	DirectusTokenPayload,
	Session,
	User,
	UserIdentity,
} from '../types/index.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { getSecret } from '../utils/get-secret.js';
import { clone, cloneDeep } from '../utils/lodash-es-used.js';
import { stall } from '../utils/stall.js';
import { ActivityService } from './activity.js';
import { ItemsService } from './items.js';
import { SettingsService } from './settings.js';
import { TFAService } from './tfa.js';

const env = useEnv();

const loginAttemptsLimiter = createRateLimiter('RATE_LIMITER', { duration: 0 });

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
	 * `last_access` is written raw — no activity, no revision, no hook — so the
	 * scoped purge never hears of it: a `/users/me` read served `fields=*` stayed
	 * stale on it until its TTL, and every session refresh re-staled it. Full mode
	 * keeps upstream's silence: a whole-cache flush per login is not worth a
	 * timestamp.
	 */
	private async touchLastAccess(userId: string): Promise<void> {
		await this.knex('directus_users')
			.update({ last_access: new Date() })
			.where({ id: userId });

		if (!scopedCachePurgeEnabled()) {
			return;
		}

		await createScopedCacheExtensionHandle(async () => this.schema)
			.purgeForMutatedRows('directus_users', [{ id: userId }]);
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
			/** The account an SSO login made from a session links its identity to */
			linkUser: string | null;
		}>,
	): Promise<LoginResult> {
		const { nanoid } = await import('nanoid');

		const STALL_TIME = env['LOGIN_STALL_TIME'];
		const timeStart = performance.now();

		const provider = getAuthProvider(providerName);

		let identity: UserIdentity;

		try {
			identity = await provider.getIdentity(cloneDeep(payload), {
				linkUser: options?.linkUser ?? null,
			});
		} catch (err) {
			await stall(STALL_TIME, timeStart);
			throw err;
		}

		const userRow = await this.knex
			.select<
				Omit<User, 'identity'> & { tfa_secret: string | null }
			>(
				'id',
				'first_name',
				'last_name',
				'password',
				'status',
				'role',
				'tfa_secret',
				'primary_identity',
			)
			.from('directus_users')
			.where('id', identity.user)
			.first();

		const user = userRow
? { ...userRow, identity }
: undefined;

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

		if (user?.status !== 'active' || identity.kind !== provider.identityKind) {
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
					// Not UsersService: it would refuse suspending the last admin.
					await new ItemsService('directus_users', {
						knex: this.knex,
						schema: this.schema,
					}).updateOne(
						user.id,
						{ status: 'suspended' },
						{ emitEvents: false },
					);

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

		const roles = await fetchRolesTree(user.role, this.knex);

		const globalAccess = await fetchGlobalAccess(
			{ roles, user: user.id, ip: this.accountability?.ip ?? null },
			this.knex,
		);

		const tokenPayload: DirectusTokenPayload = {
			id: user.id,
			role: user.role,
			app_access: globalAccess.app,
			admin_access: globalAccess.admin,
		};

		const refreshToken = nanoid(64);
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(env['REFRESH_TOKEN_TTL'], 0));

		if (options?.session) {
			tokenPayload.session = refreshToken;
		}

		const customClaims = await emitter.emitFilter(
			'auth.jwt',
			tokenPayload,
			{
				status: 'pending',
				user: user?.id,
				provider: providerName,
				type: 'login',
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		const TTL = env[options?.session ? 'SESSION_COOKIE_TTL' : 'ACCESS_TOKEN_TTL'] as StringValue | number;

		const accessToken = jwt.sign(customClaims, getSecret(), {
			expiresIn: TTL,
			issuer: 'directus',
		});

		await this.knex('directus_sessions').insert({
			token: refreshToken,
			user: user.id,
			identity: identity.id,
			expires: refreshTokenExpiration,
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
		});

		await this.knex('directus_sessions').delete().where('expires', '<', new Date());

		if (this.accountability) {
			await this.activityService.createOne({
				action: Action.LOGIN,
				user: user.id,
				ip: this.accountability.ip,
				user_agent: this.accountability.userAgent,
				origin: this.accountability.origin,
				collection: 'directus_users',
				item: user.id,
			});
		}

		await this.touchLastAccess(user.id);

		emitStatus('success');

		if (allowedAttempts !== null) {
			await loginAttemptsLimiter.set(user.id, 0, 0);
		}

		await stall(STALL_TIME, timeStart);

		return {
			accessToken,
			refreshToken,
			expires: getMilliseconds(TTL),
			id: user.id,
		};
	}

	async refresh(refreshToken: string, options?: Partial<{ session: boolean }>): Promise<LoginResult> {
		const { nanoid } = await import('nanoid');
		const STALL_TIME = env['LOGIN_STALL_TIME'];
		const timeStart = performance.now();

		if (!refreshToken) {
			throw new InvalidCredentialsError();
		}

		const record = await this.knex
			.select({
				session_expires: 's.expires',
				session_next_token: 's.next_token',
				user_id: 'u.id',
				user_first_name: 'u.first_name',
				user_last_name: 'u.last_name',
				user_password: 'u.password',
				user_status: 'u.status',
				user_primary_identity: 'u.primary_identity',
				user_role: 'u.role',
				identity_id: 'i.id',
				identity_kind: 'i.kind',
				identity_value: 'i.value',
				identity_verified: 'i.verified',
				identity_auth_data: 'i.auth_data',
				identity_user_info: 'i.user_info',
				identity_scope: 'i.scope',
				share_id: 'd.id',
				share_start: 'd.date_start',
				share_end: 'd.date_end',
			})
			.from('directus_sessions AS s')
			.leftJoin('directus_users AS u', 's.user', 'u.id')
			.leftJoin('directus_user_identities AS i', 's.identity', 'i.id')
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
			await this.knex('directus_sessions').where({ token: refreshToken }).del();

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

		const sessionProvider = toSessionProvider(record.user_id, record.identity_kind);

		if (record.user_id) {
			const provider = getAuthProvider(sessionProvider!);

			await provider.refresh({
				id: record.user_id,
				first_name: record.user_first_name,
				last_name: record.user_last_name,
				password: record.user_password,
				status: record.user_status,
				primary_identity: record.user_primary_identity,
				identity: record.identity_id
					? {
						id: record.identity_id,
						user: record.user_id,
						kind: record.identity_kind,
						value: record.identity_value,
						verified: record.identity_verified,
						auth_data: record.identity_auth_data,
						user_info: record.identity_user_info,
						scope: record.identity_scope,
					}
					: null,
				role: record.user_role,
				app_access: globalAccess.app,
				admin_access: globalAccess.admin,
			});
		}

		let newRefreshToken = record.session_next_token ?? nanoid(64);
		const sessionDuration = env[options?.session ? 'SESSION_COOKIE_TTL' : 'REFRESH_TOKEN_TTL'];
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(sessionDuration, 0));

		const tokenPayload: DirectusTokenPayload = {
			id: record.user_id,
			role: record.user_role,
			app_access: globalAccess.app,
			admin_access: globalAccess.admin,
		};

		if (options?.session) {
			newRefreshToken = await this.updateStatefulSession(record, refreshToken, newRefreshToken, refreshTokenExpiration);
			tokenPayload.session = newRefreshToken;
		} else {
			// Original stateless token behavior
			await this.knex('directus_sessions')
				.update({
					token: newRefreshToken,
					expires: refreshTokenExpiration,
				})
				.where({ token: refreshToken });
		}

		if (record.share_id) {
			tokenPayload.share = record.share_id;
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
				user: record.user_id,
				provider: sessionProvider,
				type: 'refresh',
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		const TTL = env[options?.session ? 'SESSION_COOKIE_TTL' : 'ACCESS_TOKEN_TTL'] as StringValue | number;

		const accessToken = jwt.sign(customClaims, getSecret(), {
			expiresIn: TTL,
			issuer: 'directus',
		});

		if (record.user_id) {
			await this.touchLastAccess(record.user_id);
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
			expires: getMilliseconds(TTL),
			id: record.user_id,
		};
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
			identity: sessionRecord['identity_id'],
			share: sessionRecord['share_id'],
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
				Omit<User, 'identity'> & Session & { identity_id: string | null }
			>(
				'u.id',
				'u.first_name',
				'u.last_name',
				'u.password',
				'u.status',
				'u.role',
				'u.primary_identity',
				{ identity_id: 's.identity' },
			)
			.from('directus_sessions as s')
			.innerJoin('directus_users as u', 's.user', 'u.id')
			.where('s.token', refreshToken)
			.first();

		if (record) {
			const { identity_id: identityId, ...userRow } = record;

			const identity = identityId
				? await fetchIdentityById(this.knex, identityId) ?? null
				: null;

			const provider = getAuthProvider(
				toSessionProvider(userRow.id, identity?.kind ?? null)!,
			);

			await provider.logout(clone({ ...userRow, identity }));

			await this.knex.delete().from('directus_sessions').where('token', refreshToken);
		}
	}

	/**
	 * A password set on the account is checked against it; an account without
	 * one is checked by each of its SSO identities' providers, LDAP binding.
	 */
	async verifyPassword(userID: string, password: string): Promise<void> {
		const userRow = await this.knex
			.select<Omit<User, 'identity'>>(
				'id',
				'first_name',
				'last_name',
				'password',
				'status',
				'role',
				'primary_identity',
			)
			.from('directus_users')
			.where('id', userID)
			.first();

		if (!userRow) {
			throw new InvalidCredentialsError();
		}

		if (userRow.password) {
			if (!(await argon2.verify(userRow.password, password))) {
				throw new InvalidCredentialsError();
			}

			return;
		}

		const ssoIdentities = await this.knex
			.select<UserIdentity[]>('*')
			.from('directus_user_identities')
			.where('user', userID)
			.andWhereNot('kind', EMAIL_IDENTITY_KIND)
			.orderBy('id');

		for (const identity of ssoIdentities) {
			const provider = findAuthProvider(toProviderName(identity.kind));

			if (!provider) {
				continue;
			}

			try {
				await provider.verify(clone({ ...userRow, identity }), password);
				return;
			}
 catch (error) {
				if (!(error instanceof InvalidCredentialsError)) {
					throw error;
				}
			}
		}

		throw new InvalidCredentialsError();
	}
}

/**
 * A session opened before identities existed, or by a token, names none: the
 * default provider refreshes and ends it, as a no-op.
 */
function toSessionProvider(
	userId: string | null,
	identityKind: string | null,
): string | null {
	if (identityKind) {
		return toProviderName(identityKind);
	}

	return userId
? DEFAULT_AUTH_PROVIDER
: null;
}
