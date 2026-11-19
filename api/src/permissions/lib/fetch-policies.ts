import type { Accountability, Filter } from '@directus/types';
import { withoutMeta } from '../../utils/read-meta.js';
import type { Context } from '../types.js';
import { filterPoliciesByIp } from '../utils/filter-policies-by-ip.js';
import { withCache } from '../utils/with-cache.js';

export interface AccessRow {
	policy: { id: string; ip_access: string[] | null };
	role: string | null;
}

export const fetchPolicyAccessRows = withCache(
	'policy-access-rows',
	_fetchPolicyAccessRows,
	({ roles, user, ip }) => ({ roles, user, ip }),
);

/**
 * The policies of the accountability, by priority, each once: a policy
 * reached through several member roles counts at its last place, so its
 * presets win where the last role holding it would.
 * staff → p-pub, editors → p-rev, press → p-pub: p-rev, p-pub
 */
export async function fetchPolicies(
	accountability: Pick<Accountability, 'user' | 'roles' | 'ip'>,
	context: Context,
): Promise<string[]> {
	const accessRows = await fetchPolicyAccessRows(accountability, context);
	const policyIds = accessRows.map(({ policy }) => policy.id);

	// The access rows keep every role a policy came through, for the role
	// stamps; only the policy list drops the earlier places.
	return policyIds.filter((policyId, position) => {
		return policyIds.lastIndexOf(policyId) === position;
	});
}

/**
 * The access rows granting the accountability its policies, by priority, each
 * keeping the role it is attached to: null for a policy given to the user.
 * Role rows follow `roles` (fetchUserRoles: parents root first, then the leaf
 * roles by membership `sort`), and the user's own rows come last, so the
 * presets of a later row win.
 */
export async function _fetchPolicyAccessRows(
	{ roles, user, ip }: Pick<Accountability, 'user' | 'roles' | 'ip'>,
	context: Context,
): Promise<AccessRow[]> {
	const { AccessService } = await import('../../services/access.js');
	const accessService = new AccessService(context);

	let roleFilter: Filter;

	if (roles.length === 0) {
		// Users without role assumes the Public role permissions along with their attached policies
		roleFilter = { _and: [{ role: { _null: true } }, { user: { _null: true } }] };
	} else {
		roleFilter = { role: { _in: roles } };
	}

	// If the user is not null, we also want to include the policies attached to the user
	const filter = user ? { _or: [{ user: { _eq: user } }, roleFilter] } : roleFilter;

	const accessRows = withoutMeta(await accessService.readByQuery({
		filter,
		fields: ['policy.id', 'policy.ip_access', 'role'],
		limit: -1,
	})) as AccessRow[];

	const filteredAccessRows = filterPoliciesByIp(accessRows, ip);

	/*
	 * Sort rows by priority (goes bottom up):
	 * - Parent role policies
	 * - Child role policies
	 * - User policies
	 */
	filteredAccessRows.sort((a, b) => {
		if (!a.role && !b.role) return 0;
		if (!a.role) return 1;
		if (!b.role) return -1;

		return roles.indexOf(a.role) - roles.indexOf(b.role);
	});

	return filteredAccessRows;
}
