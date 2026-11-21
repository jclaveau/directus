import type { Item, SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import { RoleMembersService } from '../../services/role-members.js';
import { lowerCaseRowKey } from '../../utils/managed-rows.js';
import { transaction } from '../../utils/transaction.js';

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
 * (`invite`), another provider's, or one given by hand stays. A row whose role
 * is still mapped stays too, so a login mapping the same roles again, in any
 * order, writes nothing and clears no cache.
 *
 * A new row goes after the user's other roles, its `sort` one past the
 * highest (C3 of #749), read from the same select as the provider's rows.
 * user-1 holds sort 1 (hand) and 3 (invite); login maps [sso-a, sso-b]
 * → sso-a sort 4, sso-b sort 5
 *
 * The new rows go in before the old ones go, in one transaction: a user moved
 * from one admin role to another never holds zero roles in between, which the
 * last-admin check would refuse, and a refused create leaves the old rows.
 *
 * The `role` guard of `withProviderRoles` is a non-enumerable property: a hook
 * spreading the payload into a new object drops it with no error.
 */
export async function syncProviderMemberships(
	user: string,
	provider: string,
	providerRoles: string[],
	context: { knex: Knex; schema: SchemaOverview },
): Promise<void> {
	const userRows: {
		id: string;
		role: string;
		managed_by: string | null;
		sort: number | null;
	}[] = await context.knex
		.select('id', 'role', 'managed_by', 'sort')
		.from('directus_role_members')
		.where({ user });

	const managedRows = userRows.filter(({ managed_by }) => {
		return managed_by === providerManager(provider);
	});

	const lastSort = Math.max(0, ...userRows.map(({ sort }) => sort ?? 0));

	// Postgres hands a uuid back in lower case, whatever case the mapping
	// spells it in.
	const mappedRoleKeys = new Set(providerRoles.map(lowerCaseRowKey));
	const keptRoles = new Set<string>();

	const staleRowIds = managedRows.flatMap(({ id, role }) => {
		const roleKey = lowerCaseRowKey(role);

		if (mappedRoleKeys.has(roleKey) && !keptRoles.has(roleKey)) {
			keptRoles.add(roleKey);

			return [];
		}

		return [id];
	});

	const missingRoles = providerRoles.filter((role, position) => {
		const roleKey = lowerCaseRowKey(role);

		return !keptRoles.has(roleKey)
			&& providerRoles.findIndex((other) => {
				return lowerCaseRowKey(other) === roleKey;
			}) === position;
	});

	if (staleRowIds.length === 0 && missingRoles.length === 0) {
		return;
	}

	await transaction(context.knex, async (trx) => {
		const roleMembersService = new RoleMembersService({
			knex: trx,
			schema: context.schema,
		});

		if (missingRoles.length > 0) {
			await roleMembersService.createMany(
				providerMemberships(provider, missingRoles, true)
					.map((membership, position) => {
						return { ...membership, user, sort: lastSort + position + 1 };
					}),
			);
		}

		if (staleRowIds.length > 0) {
			await roleMembersService.deleteMany(staleRowIds);
		}
	});
}
