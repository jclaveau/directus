import type { SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { DEFAULT_AUTH_PROVIDER } from '../../constants.js';
import {
	createScopedCacheExtensionHandle,
} from '../../extensions/lib/scoped-cache-handle.js';
import { scopedCachePurgeEnabled } from '../../scoped-cache/index.js';
import type { UserIdentity } from '../../types/index.js';

export const IDENTITIES_COLLECTION = 'directus_user_identities';
export const EMAIL_IDENTITY_KIND = 'email';

/**
 * The `default` provider logs in with an email identity, every other provider
 * with an identity of its own name.
 */
export function toIdentityKind(providerName: string): string {
	return providerName === DEFAULT_AUTH_PROVIDER
		? EMAIL_IDENTITY_KIND
		: providerName;
}

export function toProviderName(identityKind: string): string {
	return identityKind === EMAIL_IDENTITY_KIND
		? DEFAULT_AUTH_PROVIDER
		: identityKind;
}

/**
 * The identity of that kind and value, case aside: the unique index on
 * `(kind, lower(value))` holds at most one.
 */
export async function fetchIdentity(
	knex: Knex,
	identityKind: string,
	identityValue: string,
): Promise<UserIdentity | undefined> {
	return await knex
		.select<UserIdentity>('*')
		.from(IDENTITIES_COLLECTION)
		.where('kind', identityKind)
		.andWhereRaw('LOWER(??) = ?', ['value', identityValue.toLowerCase()])
		.first();
}

export async function fetchIdentityById(
	knex: Knex,
	identityId: string,
): Promise<UserIdentity | undefined> {
	return await knex
		.select<UserIdentity>('*')
		.from(IDENTITIES_COLLECTION)
		.where('id', identityId)
		.first();
}

/**
 * The email identity a password login is made with: the account's primary
 * identity whatever its `verified`, or any verified email identity.
 */
export async function fetchPasswordLoginIdentity(
	knex: Knex,
	emailAddress: string,
): Promise<UserIdentity | undefined> {
	return await knex
		.select<UserIdentity>('identity.*')
		.from({ identity: IDENTITIES_COLLECTION })
		.innerJoin({ owner: 'directus_users' }, 'owner.id', 'identity.user')
		.where('identity.kind', EMAIL_IDENTITY_KIND)
		.andWhereRaw('LOWER(??) = ?', ['identity.value', emailAddress.toLowerCase()])
		.andWhere((builder) => {
			builder
				.where('identity.verified', true)
				.orWhere('identity.id', knex.ref('owner.primary_identity'));
		})
		.first();
}

/**
 * The address shown for an account: its primary identity's value when that
 * identity is an email, else its first email identity.
 */
export async function fetchUserEmail(
	knex: Knex,
	userId: string,
): Promise<string | null> {
	const emailRow: { value: string } | undefined = await knex
		.select('identity.value')
		.from({ identity: IDENTITIES_COLLECTION })
		.leftJoin({ owner: 'directus_users' }, 'owner.primary_identity', 'identity.id')
		.where('identity.user', userId)
		.andWhere('identity.kind', EMAIL_IDENTITY_KIND)
		.orderByRaw('?? IS NULL', ['owner.id'])
		.orderBy('identity.id')
		.first();

	return emailRow?.value ?? null;
}

/**
 * A raw knex write of `primary_identity` skips the ItemsService purge, so the
 * scoped reads of the account would keep the old primary identity.
 */
export async function purgePrimaryIdentityWrites(
	schema: SchemaOverview,
	userIds: string[],
): Promise<void> {
	if (userIds.length === 0 || !scopedCachePurgeEnabled()) {
		return;
	}

	await createScopedCacheExtensionHandle(async () => schema)
		.purgeForMutatedRows(
			'directus_users',
			userIds.map((userId) => ({ id: userId })),
		);
}
