import type { Item, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { RoleMembersService } from '../../services/role-members.js';

/**
 * The `auth.create` / `auth.update` hooks still see the one mapped `role`:
 * it leaves the user payload here, and becomes the provider's membership.
 * `undefined` means the payload names no role, so the memberships stay.
 */
export function takeProviderRole(hookPayload: Item): {
	userPayload: Item;
	providerRole: string | null | undefined;
} {
	const { role: providerRole, ...userPayload } = hookPayload;

	return { userPayload, providerRole };
}

function providerManager(provider: string): string {
	return `auth:${provider}`;
}

export function providerMemberships(
	provider: string,
	providerRole: string | null | undefined,
): Item[] {
	return providerRole
		? [{ role: providerRole, managed_by: providerManager(provider) }]
		: [];
}

/**
 * Replace the memberships the provider granted, and only those: an invite's
 * (`invite:*`) or one given by hand stays. A login mapping the same role
 * again writes nothing, so it clears no cache.
 */
export async function syncProviderMemberships(
	user: string,
	provider: string,
	providerRole: string | null,
	context: { knex: Knex; schema: SchemaOverview },
): Promise<void> {
	const managedRows: { id: string; role: string }[] = await context.knex
		.select('id', 'role')
		.from('directus_role_members')
		.where({ user, managed_by: providerManager(provider) });

	const isUnchanged = providerRole === null
		? managedRows.length === 0
		: managedRows.length === 1 && managedRows[0]!.role === providerRole;

	if (isUnchanged) {
		return;
	}

	const roleMembersService = new RoleMembersService(context);

	if (managedRows.length > 0) {
		await roleMembersService.deleteMany(managedRows.map(({ id }) => id));
	}

	const createdMemberships = providerMemberships(provider, providerRole)
		.map((membership) => ({ ...membership, user }));

	if (createdMemberships.length > 0) {
		await roleMembersService.createMany(createdMemberships);
	}
}
