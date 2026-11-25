import type { Accountability, Permission, PrimaryKey } from '@directus/types';
import { getDBQuery } from '../../database/run-ast/lib/get-db-query.js';
import { fetchPermissions } from './fetch-permissions.js';
import {
	type AccessRow,
	fetchPolicies,
	fetchPolicyAccessRows,
} from './fetch-policies.js';
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
	// a permission allows the write when it lets one of these fields be set
	fields: string[];
}

/**
 * The member roles whose policies allowed the write, by membership `sort`. A
 * policy a member role inherits from a parent counts as the member role's, a
 * policy given to the user directly counts as no role's. An admin's are the
 * member roles holding an `admin_access` policy. An update lists the roles
 * allowing every row it writes.
 */
export async function fetchAllowingMemberRoles(
	options: FetchAllowingMemberRolesOptions,
	context: Context,
): Promise<string[]> {
	const { accountability } = options;

	if (options.action === 'update') {
		const rolesByRow = await fetchAllowingMemberRolesByRow(options, context);

		return accountability.memberRoles.filter((memberRole) => {
			return [...rolesByRow.values()].every((rowRoles) => {
				return rowRoles.includes(memberRole);
			});
		});
	}

	if (accountability.admin) {
		return await fetchAdminMemberRoles(accountability, context);
	}

	const accessRows = await fetchPolicyAccessRows(accountability, context);

	const createPermissions = await fetchRawPermissions(
		{
			action: 'create',
			policies: accessRows.map(({ policy }) => policy.id),
			collections: [options.collection],
			accountability,
			bypassMinimalAppPermissions: false,
		},
		context,
	);

	// Every create permission's validation already had to pass, as
	// `processPayload` checks them: each one letting a written field be set
	// allowed the create.
	const allowingPolicies = new Set<string>();

	for (const permission of createPermissions) {
		if (
			permission.policy !== null
			&& permitsAnyField(permission, options.fields)
		) {
			allowingPolicies.add(permission.policy);
		}
	}

	const memberRoleChains = await fetchMemberRoleChains(accountability, context);

	return memberRolesHolding(memberRoleChains, accessRows, allowingPolicies);
}

/**
 * The member roles allowing an update of each row, keyed by the row's key as a
 * string: one query per permission with an item rule, whatever the row count.
 */
export async function fetchAllowingMemberRolesByRow(
	options: FetchAllowingMemberRolesOptions,
	context: Context,
): Promise<Map<string, string[]>> {
	const { accountability, collection, primaryKeys } = options;

	if (primaryKeys.length === 0) {
		throw new Error(
			`An update of ${JSON.stringify(collection)} names no row to check`
			+ ' the permissions of',
		);
	}

	const rowNames = primaryKeys.map((key) => String(key));

	if (accountability.admin) {
		const adminRoles = await fetchAdminMemberRoles(accountability, context);

		return new Map(rowNames.map((rowName) => [rowName, adminRoles]));
	}

	const accessRows = await fetchPolicyAccessRows(accountability, context);

	const updatePermissions = await fetchPermissions(
		{
			action: 'update',
			policies: accessRows.map(({ policy }) => policy.id),
			collections: [collection],
			accountability,
		},
		context,
	);

	const policiesByRow = new Map(rowNames.map((rowName) => {
		return [rowName, new Set<string>()];
	}));

	for (const permission of updatePermissions) {
		if (
			permission.policy === null
			|| !permitsAnyField(permission, options.fields)
		) {
			continue;
		}

		const allowedRows = hasItemPermissions(permission)
			? await fetchRowsMatching(permission, options, context)
			: rowNames;

		for (const rowName of allowedRows) {
			policiesByRow.get(rowName)?.add(permission.policy);
		}
	}

	const memberRoleChains = await fetchMemberRoleChains(accountability, context);

	return new Map([...policiesByRow].map(([rowName, rowPolicies]) => {
		return [
			rowName,
			memberRolesHolding(memberRoleChains, accessRows, rowPolicies),
		];
	}));
}

async function fetchAdminMemberRoles(
	accountability: Accountability,
	context: Context,
): Promise<string[]> {
	const adminRoles: string[] = [];

	for (const memberRole of accountability.memberRoles) {
		const chainRoles = await fetchRolesTree(memberRole, context.knex);

		const { admin: grantsAdmin } = await fetchGlobalAccessForRoles(
			{ roles: chainRoles, ip: accountability.ip },
			context.knex,
		);

		if (grantsAdmin) {
			adminRoles.push(memberRole);
		}
	}

	return adminRoles;
}

async function fetchMemberRoleChains(
	accountability: Accountability,
	context: Context,
): Promise<[string, string[]][]> {
	const memberRoleChains: [string, string[]][] = [];

	for (const memberRole of accountability.memberRoles) {
		memberRoleChains.push([
			memberRole,
			await fetchRolesTree(memberRole, context.knex),
		]);
	}

	return memberRoleChains;
}

function memberRolesHolding(
	memberRoleChains: [string, string[]][],
	accessRows: AccessRow[],
	allowingPolicies: Set<string>,
): string[] {
	return memberRoleChains
		.filter(([, chainRoles]) => {
			return accessRows.some(({ policy, role }) => {
				return role !== null
					&& chainRoles.includes(role)
					&& allowingPolicies.has(policy.id);
			});
		})
		.map(([memberRole]) => memberRole);
}

// A write setting no field is not checked field by field.
function permitsAnyField(permission: Permission, writtenFields: string[]) {
	const permittedFields = permission.fields ?? [];

	return writtenFields.length === 0
		|| permittedFields.includes('*')
		|| writtenFields.some((field) => permittedFields.includes(field));
}

/**
 * The written rows the permission's item rule matches, read as
 * `validateItemAccess` reads them, the rule alone.
 */
async function fetchRowsMatching(
	permission: Permission,
	{ accountability, collection, primaryKeys }: FetchAllowingMemberRolesOptions,
	context: Context,
): Promise<string[]> {
	const primaryKeyField = context.schema.collections[collection]!.primary;
	const policies = await fetchPolicies(accountability, context);

	const permissions = await fetchPermissions(
		{ action: 'update', accountability, policies },
		context,
	);

	const matchedRows: Record<string, PrimaryKey>[] = await getDBQuery(
		{
			table: collection,
			fieldNodes: [{
				type: 'field',
				name: primaryKeyField,
				fieldKey: primaryKeyField,
				whenCase: [],
				alias: false,
			}],
			o2mNodes: [],
			query: {
				limit: primaryKeys.length,
				filter: { [primaryKeyField]: { _in: primaryKeys } },
			},
			cases: [permission.permissions!],
			permissions,
		},
		context,
	);

	const primaryKeyType = context.schema.collections[collection]!
		.fields?.[primaryKeyField]?.type;

	// Postgres reads a uuid back in lower case: name the row as the caller did.
	if (primaryKeyType === 'uuid') {
		const rowNameByUuid = new Map(primaryKeys.map((key) => {
			return [String(key).toLowerCase(), String(key)];
		}));

		return matchedRows.map((matchedRow) => {
			const matchedUuid = String(matchedRow[primaryKeyField]).toLowerCase();

			return rowNameByUuid.get(matchedUuid) ?? matchedUuid;
		});
	}

	return matchedRows.map((matchedRow) => String(matchedRow[primaryKeyField]));
}
