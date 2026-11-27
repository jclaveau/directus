import {
	ErrorCode,
	InvalidCredentialsError,
	InvalidProviderError,
	isDirectusError,
	RecordNotUniqueError,
} from '@directus/errors';
import type { SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import emitter from '../../emitter.js';
import { useLogger } from '../../logger/index.js';
import { ItemsService } from '../../services/items.js';
import { UsersService } from '../../services/users.js';
import type { UserIdentity } from '../../types/index.js';
import { omit } from '../../utils/lodash-es-used.js';
import { transaction } from '../../utils/transaction.js';
import {
	EMAIL_IDENTITY_KIND,
	fetchIdentity,
	fetchIdentityById,
	IDENTITIES_COLLECTION,
	purgePrimaryIdentityWrites,
} from './user-identities.js';

/**
 * The keys of the `auth.create` / `auth.update` hook payloads that land on the
 * identity rows, not on `directus_users`: the payloads keep their pre-identity
 * shape so the hooks extensions already register keep working.
 */
const IDENTITY_PAYLOAD_KEYS = [
	'provider',
	'external_identifier',
	'email',
	'auth_data',
];

const TOKEN_CLAIM_KEYS = [
	'access_token',
	'id_token',
	'refresh_token',
	'accessToken',
	'idToken',
	'refreshToken',
];

export type SsoLogin = {
	/** The log prefix of the driver, `[OpenID]` */
	logPrefix: string;
	provider: string;
	identifier: string;
	email: string | undefined;
	/** The provider vouches for `email` */
	emailVerified: boolean;
	/**
	 * The email can't create an account: unverified, and the provider requires
	 * a verified one
	 */
	emailUnverified: boolean;
	userInfo: Record<string, unknown> | null;
	scope: string | null;
	/** Legacy `auth.update` payload, before its filter */
	updatePayload: Record<string, unknown>;
	/** Legacy `auth.create` payload, before its filter */
	createPayload: Record<string, unknown>;
	hookMeta: Record<string, unknown>;
	allowPublicRegistration: boolean;
	linkUser: string | null;
};

type SsoContext = {
	knex: Knex;
	schema: SchemaOverview;
};

/**
 * Find, link or create the identity an SSO login is made with, and sync what the
 * provider sent onto it and its account.
 *
 * @throws InvalidCredentialsError when no account can be found or created
 * @throws InvalidProviderError when the provider's email is held by another account
 * @throws RecordNotUniqueError when the identity, linked from a session, is
 * held by another account
 */
export async function loginSsoIdentity(
	context: SsoContext,
	ssoLogin: SsoLogin,
): Promise<UserIdentity> {
	const knownIdentity = await fetchIdentity(
		context.knex,
		ssoLogin.provider,
		ssoLogin.identifier,
	);

	if (knownIdentity) {
		if (ssoLogin.linkUser && knownIdentity.user !== ssoLogin.linkUser) {
			throw new RecordNotUniqueError({
				collection: IDENTITIES_COLLECTION,
				field: 'value',
				value: null,
			});
		}

		return await updateSsoIdentity(context, ssoLogin, knownIdentity);
	}

	if (ssoLogin.linkUser) {
		return await linkSsoIdentity(context, ssoLogin, ssoLogin.linkUser);
	}

	return await createSsoAccount(context, ssoLogin);
}

/**
 * The claims of `userInfo`, never a token: those stay in the hidden `auth_data`.
 */
export function toStoredUserInfo(
	userInfo: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (userInfo === null) {
		return null;
	}

	return omit(userInfo, TOKEN_CLAIM_KEYS);
}

async function updateSsoIdentity(
	context: SsoContext,
	ssoLogin: SsoLogin,
	knownIdentity: UserIdentity,
): Promise<UserIdentity> {
	const updatedPayload: Record<string, unknown> = await emitter.emitFilter(
		'auth.update',
		ssoLogin.updatePayload,
		ssoLogin.hookMeta,
		{ database: context.knex, schema: context.schema, accountability: null },
	);

	const userFields = omit(updatedPayload, IDENTITY_PAYLOAD_KEYS);

	if (Object.values(userFields).some((fieldValue) => fieldValue !== undefined)) {
		await new UsersService({ knex: context.knex, schema: context.schema })
			.updateOne(knownIdentity.user, userFields);
	}

	const identityFields: Partial<UserIdentity> = {
		user_info: toStoredUserInfo(ssoLogin.userInfo),
		scope: ssoLogin.scope,
	};

	if (updatedPayload['auth_data'] !== undefined) {
		identityFields.auth_data = updatedPayload['auth_data'] as
			UserIdentity['auth_data'];
	}

	await identitiesService(context).updateOne(knownIdentity.id, identityFields);

	const updatedEmail = updatedPayload['email'];

	if (typeof updatedEmail === 'string' && updatedEmail !== '') {
		await syncEmailIdentity(context, ssoLogin, knownIdentity.user, updatedEmail);
	}

	return (await fetchIdentityById(context.knex, knownIdentity.id))!;
}

/**
 * Linking B: an identity no account holds, sent by a login made from a session,
 * is added to that session's account.
 */
async function linkSsoIdentity(
	context: SsoContext,
	ssoLogin: SsoLogin,
	linkUser: string,
): Promise<UserIdentity> {
	const identityId = await identitiesService(context).createOne({
		user: linkUser,
		kind: ssoLogin.provider,
		value: ssoLogin.identifier,
		verified: true,
		auth_data: (ssoLogin.updatePayload['auth_data'] ?? null) as
			UserIdentity['auth_data'],
		user_info: toStoredUserInfo(ssoLogin.userInfo),
		scope: ssoLogin.scope,
	});

	// OPEN(#772): a linked provider's email is added like a known user's, sync
	// on or off
	if (ssoLogin.email) {
		await syncEmailIdentity(context, ssoLogin, linkUser, ssoLogin.email);
	}

	return (await fetchIdentityById(context.knex, identityId as string))!;
}

async function createSsoAccount(
	context: SsoContext,
	ssoLogin: SsoLogin,
): Promise<UserIdentity> {
	const logger = useLogger();

	if (ssoLogin.emailUnverified) {
		logger.warn(
			`${ssoLogin.logPrefix} Unverified email can't create a user for provider`
			+ ` ${JSON.stringify(ssoLogin.provider)}`,
		);

		throw new InvalidCredentialsError();
	}

	if (!ssoLogin.allowPublicRegistration) {
		logger.warn(
			`${ssoLogin.logPrefix} User doesn't exist, and public registration not allowed`
			+ ` for provider ${JSON.stringify(ssoLogin.provider)}`,
		);

		throw new InvalidCredentialsError();
	}

	const createdPayload: Record<string, unknown> = await emitter.emitFilter(
		'auth.create',
		ssoLogin.createPayload,
		ssoLogin.hookMeta,
		{ database: context.knex, schema: context.schema, accountability: null },
	);

	const createdEmail = createdPayload['email'];

	const accountEmail = typeof createdEmail === 'string' && createdEmail !== ''
		? createdEmail
		: null;

	// Linking B: never added to the account holding the email, by email match alone
	const isEmailHeld = accountEmail !== null
		&& await fetchIdentity(context.knex, EMAIL_IDENTITY_KIND, accountEmail);

	if (isEmailHeld) {
		logger.warn(
			`${ssoLogin.logPrefix} Failed to register user. Email held by another user`
			+ ` for provider ${JSON.stringify(ssoLogin.provider)}`,
		);

		throw new InvalidProviderError();
	}

	const identityValue = typeof createdPayload['external_identifier'] === 'string'
		? createdPayload['external_identifier']
		: ssoLogin.identifier;

	try {
		return await transaction(context.knex, async (trx) => {
			const trxContext = { knex: trx, schema: context.schema };

			const userId = await new UsersService(trxContext)
				.createOne(omit(createdPayload, IDENTITY_PAYLOAD_KEYS));

			const ssoIdentityId = await identitiesService(trxContext).createOne({
				user: userId as string,
				kind: ssoLogin.provider,
				value: identityValue,
				verified: true,
				auth_data: (createdPayload['auth_data'] ?? null) as
					UserIdentity['auth_data'],
				user_info: toStoredUserInfo(ssoLogin.userInfo),
				scope: ssoLogin.scope,
			});

			const emailIdentityId = accountEmail
				? await identitiesService(trxContext).createOne({
					user: userId as string,
					kind: EMAIL_IDENTITY_KIND,
					value: accountEmail,
					verified: ssoLogin.emailVerified,
				})
				: null;

			await trx('directus_users')
				.update({ primary_identity: emailIdentityId ?? ssoIdentityId })
				.where('id', userId);

			return (await fetchIdentityById(trx, ssoIdentityId as string))!;
		});
	}
 catch (error) {
		if (isDirectusError(error, ErrorCode.RecordNotUnique)) {
			logger.warn(
				error,
				`${ssoLogin.logPrefix} Failed to register user. User not unique`,
			);

			throw new InvalidProviderError();
		}

		throw error;
	}
}

/**
 * S3: the email a provider sends for a known account is added to it, `verified`
 * as the provider vouches; held by another account (F), the login passes, the
 * email stays in the SSO row's `user_info` only, and the operator reconciles
 * through `directus_user_identity_conflicts`.
 */
async function syncEmailIdentity(
	context: SsoContext,
	ssoLogin: SsoLogin,
	userId: string,
	emailAddress: string,
): Promise<void> {
	const logger = useLogger();

	const heldIdentity = await fetchIdentity(
		context.knex,
		EMAIL_IDENTITY_KIND,
		emailAddress,
	);

	if (heldIdentity && heldIdentity.user === userId) {
		if (ssoLogin.emailVerified && !heldIdentity.verified) {
			await identitiesService(context)
				.updateOne(heldIdentity.id, { verified: true });
		}

		return;
	}

	const warnConflict = () => {
		logger.warn(
			`${ssoLogin.logPrefix} Email held by another user not synced for provider`
			+ ` ${JSON.stringify(ssoLogin.provider)}`,
		);
	};

	if (heldIdentity) {
		warnConflict();
		return;
	}

	let emailIdentityId;

	try {
		emailIdentityId = await identitiesService(context).createOne({
			user: userId,
			kind: EMAIL_IDENTITY_KIND,
			value: emailAddress,
			verified: ssoLogin.emailVerified,
		});
	}
 catch (error) {
		if (isDirectusError(error, ErrorCode.RecordNotUnique)) {
			warnConflict();
			return;
		}

		throw error;
	}

	const primaryWrites = await context.knex('directus_users')
		.update({ primary_identity: emailIdentityId })
		.where('id', userId)
		.whereNull('primary_identity');

	if (primaryWrites > 0) {
		await purgePrimaryIdentityWrites(context.schema, [userId]);
	}
}

/**
 * The refresh token a provider rotated on a session refresh.
 */
export async function updateIdentityAuthData(
	context: SsoContext,
	identityId: string,
	authData: string,
): Promise<void> {
	await identitiesService(context).updateOne(identityId, { auth_data: authData });
}

/**
 * Null accountability: the sync writes no activity and no revision, and
 * `auth_data` stays out of `directus_revisions`.
 */
function identitiesService(context: SsoContext): ItemsService<UserIdentity> {
	return new ItemsService<UserIdentity>(IDENTITIES_COLLECTION, {
		knex: context.knex,
		schema: context.schema,
		accountability: null,
	});
}
