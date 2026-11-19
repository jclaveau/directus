import type { Accountability, Permission, PrimaryKey } from '@directus/types';
import {
	fetchPermittedAstRootFields,
} from '../../database/run-ast/modules/fetch-permitted-ast-root-fields.js';
import type { AST } from '../../types/ast.js';
import { fetchPermissions } from './fetch-permissions.js';
import { fetchPolicyAccessRows } from './fetch-policies.js';
import { fetchRolesTree } from './fetch-roles-tree.js';
import type { Context } from '../types.js';
import { fetchRawPermissions } from '../utils/fetch-raw-permissions.js';
import {
	fetchGlobalAccessForRoles,
} from '../modules/fetch-global-access/lib/fetch-global-access-for-roles.js';
import {
	hasItemPermissions,
} from '../modules/process-ast/utils/has-item-permissions.js';

export interface FetchAllowingMemberRolesOptions {
	accountability: Accountability;
	action: 'create' | 'update';
	collection: string;
	primaryKeys: PrimaryKey[];
}

/**
 * The member roles whose policies allowed the write, by membership `sort`. A
 * policy a member role inherits from a parent counts as the member role's, a
 * policy given to the user directly counts as no role's. An admin's are the
 * member roles holding an `admin_access` policy.
 */
export async function fetchAllowingMemberRoles(
	options: FetchAllowingMemberRolesOptions,
	context: Context,
): Promise<string[]> {
	const { accountability } = options;
	const allowingRoles: string[] = [];

	if (accountability.admin) {
		for (const memberRole of accountability.memberRoles) {
			const chainRoles = await fetchRolesTree(memberRole, context.knex);

			const { admin: grantsAdmin } = await fetchGlobalAccessForRoles(
				{ roles: chainRoles, ip: accountability.ip },
				context.knex,
			);

			if (grantsAdmin) {
				allowingRoles.push(memberRole);
			}
		}

		return allowingRoles;
	}

	const accessRows = await fetchPolicyAccessRows(accountability, context);

	const allowingPolicies = await fetchAllowingPolicies(
		options,
		accessRows.map(({ policy }) => policy.id),
		context,
	);

	for (const memberRole of accountability.memberRoles) {
		const chainRoles = await fetchRolesTree(memberRole, context.knex);

		const holdsAllowingPolicy = accessRows.some(({ policy, role }) => {
			return role !== null
				&& chainRoles.includes(role)
				&& allowingPolicies.has(policy.id);
		});

		if (holdsAllowingPolicy) {
			allowingRoles.push(memberRole);
		}
	}

	return allowingRoles;
}

/**
 * A create is checked as `processPayload` checks it: every permission's
 * validation already had to pass, so each create permission allowed it. An
 * update also needs the permission's item rule to match every row written,
 * read as `validateItemAccess` reads it, one rule at a time.
 */
async function fetchAllowingPolicies(
	options: FetchAllowingMemberRolesOptions,
	policies: string[],
	context: Context,
): Promise<Set<string>> {
	const { accountability, action, collection } = options;
	const allowingPolicies = new Set<string>();

	if (action === 'create') {
		const createPermissions = await fetchRawPermissions(
			{
				action,
				policies,
				collections: [collection],
				accountability,
				bypassMinimalAppPermissions: false,
			},
			context,
		);

		for (const { policy } of createPermissions) {
			if (policy !== null) {
				allowingPolicies.add(policy);
			}
		}

		return allowingPolicies;
	}

	if (options.primaryKeys.length === 0) {
		throw new Error(
			`An update of ${JSON.stringify(collection)} names no row to check`
			+ ' the permissions of',
		);
	}

	const updatePermissions = await fetchPermissions(
		{ action, policies, collections: [collection], accountability },
		context,
	);

	for (const permission of updatePermissions) {
		if (permission.policy === null) {
			continue;
		}

		const allowsRows = !hasItemPermissions(permission)
			|| await permissionMatchesRows(permission, options, context);

		if (allowsRows) {
			allowingPolicies.add(permission.policy);
		}
	}

	return allowingPolicies;
}

async function permissionMatchesRows(
	permission: Permission,
	{ accountability, collection, primaryKeys }: FetchAllowingMemberRolesOptions,
	context: Context,
) {
	const primaryKeyField = context.schema.collections[collection]!.primary;

	const ast: AST = {
		type: 'root',
		name: collection,
		query: {
			limit: primaryKeys.length,
			filter: { [primaryKeyField]: { _in: primaryKeys } },
		},
		children: [],
		cases: [permission.permissions!],
	};

	const permittedRows = await fetchPermittedAstRootFields(ast, {
		schema: context.schema,
		accountability,
		knex: context.knex,
		action: 'update',
	});

	return permittedRows.length === primaryKeys.length;
}
