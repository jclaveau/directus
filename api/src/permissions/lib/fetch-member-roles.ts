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
 * The member roles and the ancestors of each, in the order presets apply, the
 * last one winning on a field. First the parents, every role that is an
 * ancestor of another role of the list, root first, one depth in the
 * membership `sort` of the chain it came through; then the leaf roles, the
 * member roles that are no ancestor of another, by membership `sort`. A member
 * role parenting another member role counts as a parent.
 *
 * press (sort 1), editors under staff (sort 2) → staff, press, editors
 * editors under staff (sort 1), staff (sort 2) → staff, editors
 *
 * `readMemberRoles` reads the member roles, cached unless one says otherwise.
 */
export async function fetchUserRoles(
	user: string | null,
	knex: Knex,
	readMemberRoles = fetchMemberRoles,
) {
	const memberRoles = await readMemberRoles(user, knex);
	const memberChains: string[][] = [];

	for (const memberRole of memberRoles) {
		memberChains.push(await fetchRolesTree(memberRole, knex));
	}

	const chainDepths = memberChains.flatMap((memberChain) => {
		return memberChain.slice(0, -1).map((parentRole, parentDepth) => {
			return { parentRole, parentDepth };
		});
	});

	// A stable sort keeps the membership order within one depth.
	const parentRoles = [
		...new Set(chainDepths
			.sort((left, right) => left.parentDepth - right.parentDepth)
			.map(({ parentRole }) => parentRole)),
	];

	const leafRoles = memberRoles.filter((memberRole) => {
		return !parentRoles.includes(memberRole);
	});

	return { memberRoles, roles: [...parentRoles, ...leafRoles] };
}
