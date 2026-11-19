import type { Item, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { RoleMembersService } from '../../services/role-members.js';

function removedRoleError(eventName: string): Error {
	return new Error(
		`The ${JSON.stringify(eventName)} payload has no "role" since multi-role`
		+ ' (#746): read or set "roles"',
	);
}

/**
 * The `auth.create` / `auth.update` hook payload: `roles` lists the role ids
 * the login grants, and the single `role` it replaced throws on any use, so
 * a hook still written for one role fails loudly instead of being ignored.
 */
export function withProviderRoles(
	eventName: string,
	userPayload: Item,
	providerRoles: string[] | undefined,
): Item {
	const hookPayload: Item = providerRoles === undefined
		? { ...userPayload }
		: { ...userPayload, roles: providerRoles };

	Object.defineProperty(hookPayload, 'role', {
		enumerable: false,
		get() {
			throw removedRoleError(eventName);
		},
		set() {
			throw removedRoleError(eventName);
		},
	});

	return hookPayload;
}

/**
 * Splits what a hook returned into the user's fields and the roles to grant.
 * `undefined` roles means the payload names none, so the memberships stay.
 */
export function takeProviderRoles(eventName: string, hookPayload: Item): {
	userPayload: Item;
	providerRoles: string[] | undefined;
} {
	if (Object.getOwnPropertyDescriptor(hookPayload, 'role')?.enumerable) {
		throw removedRoleError(eventName);
	}

	const { roles: providerRoles, ...userPayload } = hookPayload;

	const isRoleIdList = Array.isArray(providerRoles)
		&& providerRoles.every((role) => typeof role === 'string');

	if (providerRoles !== undefined && !isRoleIdList) {
		throw new Error(
			`The ${JSON.stringify(eventName)} payload lists its "roles" as role`
			+ ` ids, got ${JSON.stringify(providerRoles)}`,
		);
	}

	return { userPayload, providerRoles };
}

function providerManager(provider: string): string {
	return `auth:${provider}`;
}

/**
 * A mapped role belongs to the provider, which replaces it on each login; a
 * role no mapping gave (the default role of an unmapped provider) belongs to
 * the admin, and no login touches it.
 */
export function providerMemberships(
	provider: string,
	providerRoles: string[] | undefined,
	isRoleMapped: boolean,
): Item[] {
	const managedBy = isRoleMapped
		? providerManager(provider)
		: null;

	return (providerRoles ?? []).map((role) => ({ role, managed_by: managedBy }));
}

/**
 * Replace the memberships the provider granted, and only those: an invite's
 * (`invite:*`), another provider's, or one given by hand stays. A login
 * mapping the same roles again writes nothing, so it clears no cache.
 */
export async function syncProviderMemberships(
	user: string,
	provider: string,
	providerRoles: string[],
	context: { knex: Knex; schema: SchemaOverview },
): Promise<void> {
	const managedRows: { id: string; role: string }[] = await context.knex
		.select('id', 'role')
		.from('directus_role_members')
		.where({ user, managed_by: providerManager(provider) });

	const isUnchanged = managedRows.length === providerRoles.length
		&& managedRows.every(({ role }, index) => role === providerRoles[index]);

	if (isUnchanged) {
		return;
	}

	const roleMembersService = new RoleMembersService(context);

	if (managedRows.length > 0) {
		await roleMembersService.deleteMany(managedRows.map(({ id }) => id));
	}

	const createdMemberships = providerMemberships(provider, providerRoles, true)
		.map((membership) => ({ ...membership, user }));

	if (createdMemberships.length > 0) {
		await roleMembersService.createMany(createdMemberships);
	}
}
