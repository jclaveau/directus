export type RoleLink = {
	id: string;
	name: string;
	parent: string | null;
};

export type AccessLink = {
	user: string | null;
	role: string | null;
	policy: { id: string; name: string };
};

export type PolicySource =
	| { policy: AccessLink['policy']; source: 'direct' }
	| {
		policy: AccessLink['policy'];
		source: 'role';
		role: RoleLink;
	}
	| {
		policy: AccessLink['policy'];
		source: 'ancestor';
		role: RoleLink;
		memberRole: RoleLink;
	};

/**
 * Every policy a user holds and where it comes from (#746): attached to the
 * user, to one of its member roles, or to an ancestor of one. A policy reached
 * twice is listed twice. Member roles go in membership order, each followed
 * by its ancestors, nearest first.
 */
export function listPolicySources(
	userId: string,
	memberRoleIds: string[],
	allRoles: RoleLink[],
	accessRows: AccessLink[],
): PolicySource[] {
	const rolesById = new Map(allRoles.map((role) => [role.id, role]));

	const policySources: PolicySource[] = accessRows
		.filter((access) => access.user === userId)
		.map((access) => ({ policy: access.policy, source: 'direct' }));

	for (const memberRoleId of memberRoleIds) {
		const memberRole = findRole(rolesById, memberRoleId);

		for (const access of accessRowsOf(accessRows, memberRole.id)) {
			policySources.push({
				policy: access.policy,
				source: 'role',
				role: memberRole,
			});
		}

		const visitedRoleIds = new Set([memberRole.id]);
		let ancestorId = memberRole.parent;

		while (ancestorId && !visitedRoleIds.has(ancestorId)) {
			visitedRoleIds.add(ancestorId);

			const ancestor = findRole(rolesById, ancestorId);

			for (const access of accessRowsOf(accessRows, ancestor.id)) {
				policySources.push({
					policy: access.policy,
					source: 'ancestor',
					role: ancestor,
					memberRole,
				});
			}

			ancestorId = ancestor.parent;
		}
	}

	return policySources;
}

function findRole(rolesById: Map<string, RoleLink>, roleId: string) {
	const foundRole = rolesById.get(roleId);

	if (!foundRole) {
		throw new Error(`Role ${JSON.stringify(roleId)} is not among the roles read`);
	}

	return foundRole;
}

function accessRowsOf(accessRows: AccessLink[], roleId: string) {
	return accessRows.filter((access) => access.role === roleId);
}
