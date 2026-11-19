import type { Knex } from 'knex';
import { withCache } from '../utils/with-cache.js';
import { fetchRolesTree } from './fetch-roles-tree.js';

export const fetchMemberRoles = withCache('member-roles', _fetchMemberRoles);

/**
 * The roles the user is a member of, as stored, by membership `sort`: a later
 * one wins a preset the earlier ones also set. A role granted twice (two
 * inviters) counts once.
 */
export async function _fetchMemberRoles(
	user: string | null,
	knex: Knex,
): Promise<string[]> {
	if (!user) {
		return [];
	}

	const memberships: { role: string }[] = await knex
		.select('role')
		.from('directus_role_members')
		.where({ user })
		.orderBy([
			{ column: 'sort', nulls: 'first' },
			'id',
		]);

	return [...new Set(memberships.map(({ role }) => role))];
}

/**
 * The member roles and the ancestors of each, every chain root first: an
 * ancestor two member roles share comes once, before both.
 */
export async function fetchUserRoles(user: string | null, knex: Knex) {
	const memberRoles = await fetchMemberRoles(user, knex);
	const roles: string[] = [];

	for (const memberRole of memberRoles) {
		for (const chainRole of await fetchRolesTree(memberRole, knex)) {
			if (!roles.includes(chainRole)) {
				roles.push(chainRole);
			}
		}
	}

	return { memberRoles, roles };
}
