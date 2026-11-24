import { createInspector } from '@directus/schema';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';

const INVITES_UNIQUE_INDEX_NAME = 'directus_invites_user_role_inviter_unique';

// Self-contained on purpose: a migration must not move when runtime code does.
const ROLE_PATH_COLUMNS: Record<string, string[]> = {
	directus_permissions: ['permissions', 'validation', 'presets', 'fields'],
	directus_presets: ['filter'],
	directus_fields: ['options', 'conditions', 'validation'],
	directus_operations: ['options'],
	directus_panels: ['options'],
};

// The system fields relating to a user; a collection's own are in
// `directus_relations`.
const SYSTEM_USER_FIELDS: Record<string, string[]> = {
	directus_access: ['user'],
	directus_activity: ['user'],
	directus_comments: ['user_created', 'user_updated'],
	directus_dashboards: ['user_created'],
	directus_files: ['uploaded_by', 'modified_by'],
	directus_flows: ['user_created'],
	directus_notifications: ['recipient', 'sender'],
	directus_operations: ['user_created'],
	directus_panels: ['user_created'],
	directus_presets: ['user'],
	directus_sessions: ['user'],
	directus_shares: ['user_created'],
	directus_versions: ['user_created', 'user_updated'],
};

type RoleDirection = 'to-memberships' | 'to-column';

type StoredRow = {
	table: string;
	id: string | number;
	column: string;
	collection: string | null;
	value: unknown;
};

/**
 * A user holds several roles (#746): `directus_role_members` replaces
 * `directus_users.role`. Each user's role becomes their one membership,
 * managed by `auth:<provider>` for a user of a provider mapping roles, then
 * the column goes. `directus_invites` records who invited a user to which
 * role until they accept. `down` puts each user's one membership back in the
 * column, and refuses, changing nothing, while a user holds several roles.
 */
export async function up(knex: Knex): Promise<void> { // bb-unit-only: bb migrates an empty database
	await knex.schema.createTable('directus_role_members', (table) => {
		table.uuid('id').primary();

		table.uuid('user')
			.references('directus_users.id')
			.notNullable()
			.onDelete('CASCADE');

		table.uuid('role')
			.references('directus_roles.id')
			.notNullable()
			.onDelete('CASCADE');

		table.integer('sort');
		table.string('managed_by', 255);

		// Every request reads the roles of its user: Postgres indexes no FK.
		table.index(['user']);
	});

	// One row per user, role and inviter; null for an invite naming no user, or
	// whose inviter was deleted: the invite outlives them.
	await knex.schema.createTable('directus_invites', (table) => {
		table.uuid('id').primary();

		table.uuid('user')
			.references('directus_users.id')
			.notNullable()
			.onDelete('CASCADE');

		table.uuid('role')
			.references('directus_roles.id')
			.notNullable()
			.onDelete('CASCADE');

		table.uuid('inviter')
			.references('directus_users.id')
			.nullable()
			.onDelete('SET NULL');

		table.timestamp('date_created').defaultTo(knex.fn.now());
	});

	// Each null counts as distinct: an inviter deleted leaves as many invites
	// naming no user as they made, and code replaces its own before writing.
	await knex.schema.alterTable('directus_invites', (table) => {
		table.unique(['user', 'role', 'inviter'], {
			indexName: INVITES_UNIQUE_INDEX_NAME,
		});
	});

	const usersWithRole: {
		id: string;
		role: string;
		provider: string | null;
	}[] = await knex
		.select('id', 'role', 'provider')
		.from('directus_users')
		.whereNotNull('role');

	// A mapped SSO user's role came from its provider: managing the membership
	// by that provider lets the next login replace it. A provider mapping no
	// role never replaces it, so an admin keeps it in hand.
	const memberships = usersWithRole.map(({ id, role, provider }) => {
		return {
			id: randomUUID(),
			user: id,
			role,
			sort: 1,
			managed_by: provider !== null
				&& provider !== 'default'
				&& providerMapsRoles(provider)
				? `auth:${provider}`
				: null,
		};
	});

	await knex.batchInsert('directus_role_members', memberships, 200);

	await moveStoredRolePaths(knex, 'to-memberships');

	// An instance upgraded from an old release may hold the constraint under
	// another name than knex's default.
	const roleForeignKey = (await createInspector(knex).foreignKeys('directus_users'))
		.find(({ column }) => column === 'role');

	await knex.schema.alterTable('directus_users', (table) => {
		if (roleForeignKey) {
			table.dropForeign(['role'], roleForeignKey.constraint_name ?? undefined);
		}

		table.dropColumn('role');
	});
}

// As each driver decides at login whether the roles it maps replace the
// memberships it manages: oauth2 and openid by ROLE_MAPPING, ldap by GROUP_DN.
function providerMapsRoles(provider: string): boolean { // bb-unit-only: bb migrates an empty database
	const { driver, roleMapping, groupDn } = getConfigFromEnv(
		`AUTH_${provider.toUpperCase()}_`,
	);

	if (driver === 'ldap') {
		return Boolean(groupDn);
	}

	if (driver === 'oauth2' || driver === 'openid') {
		return Boolean(roleMapping);
	}

	return false;
}

export async function down(knex: Knex): Promise<void> { // bb-unit-only: bb never migrates down
	const memberships: { user: string; role: string }[] = await knex
		.select('user', 'role')
		.from('directus_role_members')
		.orderBy('id');

	const roleByUser = new Map<string, string>();
	const severalRoleUsers = new Set<string>();

	for (const { user, role } of memberships) {
		if (roleByUser.has(user) && roleByUser.get(user) !== role) {
			severalRoleUsers.add(user);
		}

		roleByUser.set(user, role);
	}

	// One column holds one role: the extra ones would be lost.
	if (severalRoleUsers.size > 0) {
		throw new Error(
			'Cannot roll back the multi-role migration: users'
			+ ` ${[...severalRoleUsers].map((user) => JSON.stringify(user)).join(', ')}`
			+ ' hold several roles; back up and remove the extra memberships first',
		);
	}

	await knex.schema.alterTable('directus_users', (table) => {
		table.uuid('role')
			.references('directus_roles.id')
			.nullable()
			.onDelete('SET NULL');
	});

	for (const [user, role] of roleByUser) {
		await knex('directus_users')
			.update({ role })
			.where({ id: user });
	}

	await moveStoredRolePaths(knex, 'to-column');

	await knex.schema.dropTable('directus_invites');
	await knex.schema.dropTable('directus_role_members');
}

/**
 * A stored filter, permission field list or preset reaching
 * `directus_users.role` moves to `roles.role`, the membership's role, so it
 * keeps answering once the column goes: `{"user_created":{"role":F}}` becomes
 * `{"user_created":{"roles":{"role":F}}}`. `down` moves it back.
 */
async function moveStoredRolePaths(
	knex: Knex,
	direction: RoleDirection,
): Promise<void> { // bb-unit-only: bb migrates an empty database
	const relationTargets = await readRelationTargets(knex);

	for (const storedRow of await readStoredRows(knex, relationTargets)) {
		const columnMovers: Record<string, () => unknown> = {
			fields: () => {
				return movePermissionFields(storedRow, direction);
			},
			presets: () => {
				return movePresetRole(storedRow, direction);
			},
		};

		const movedValue = columnMovers[storedRow.column]?.() ?? moveRolePaths(
			storedRow.value,
			storedRow.collection,
			relationTargets,
			direction,
		);

		if (JSON.stringify(movedValue) === JSON.stringify(storedRow.value)) {
			continue;
		}

		await knex(storedRow.table)
			.update({
				[storedRow.column]: typeof movedValue === 'string'
					? movedValue
					: JSON.stringify(movedValue),
			})
			.where({ id: storedRow.id });
	}
}

async function readRelationTargets(
	knex: Knex,
): Promise<Map<string, string>> { // bb-unit-only: bb migrates an empty database
	const relationTargets = new Map<string, string>();

	for (const [collection, fields] of Object.entries(SYSTEM_USER_FIELDS)) {
		for (const field of fields) {
			relationTargets.set(`${collection}.${field}`, 'directus_users');
		}
	}

	const relations: {
		many_collection: string;
		many_field: string;
		one_collection: string | null;
		one_field: string | null;
	}[] = await knex
		.select('many_collection', 'many_field', 'one_collection', 'one_field')
		.from('directus_relations');

	for (const relation of relations) {
		if (relation.one_collection === null) {
			continue;
		}

		relationTargets.set(
			`${relation.many_collection}.${relation.many_field}`,
			relation.one_collection,
		);

		if (relation.one_field !== null) {
			relationTargets.set(
				`${relation.one_collection}.${relation.one_field}`,
				relation.many_collection,
			);
		}
	}

	return relationTargets;
}

async function readStoredRows(
	knex: Knex,
	relationTargets: Map<string, string>,
): Promise<StoredRow[]> { // bb-unit-only: bb migrates an empty database
	const storedRows: StoredRow[] = [];

	for (const [table, columns] of Object.entries(ROLE_PATH_COLUMNS)) {
		const contextColumns = {
			directus_permissions: ['collection'],
			directus_presets: ['collection'],
			directus_fields: ['collection', 'field'],
		}[table] ?? [];

		const rows = await knex
			.select('id', ...contextColumns, ...columns)
			.from(table);

		for (const row of rows) {
			for (const column of columns) {
				if (row[column] === null || row[column] === undefined) {
					continue;
				}

				const value = column === 'fields'
					? row[column]
					: parsedColumnValue(row[column]);

				storedRows.push({
					table,
					id: row.id,
					column,
					collection: storedCollectionOf(row, value, relationTargets),
					value,
				});
			}
		}
	}

	return storedRows;
}

// The collection a stored value filters: its row's, the related one of a
// field's options, or the one named in an operation's or panel's options.
function storedCollectionOf(
	row: Record<string, unknown>,
	value: unknown,
	relationTargets: Map<string, string>,
): string | null { // bb-unit-only: bb migrates an empty database
	if (typeof row['collection'] === 'string') {
		const relatedCollection = typeof row['field'] === 'string'
			? relationTargets.get(`${row['collection']}.${row['field']}`)
			: undefined;

		return relatedCollection ?? row['collection'];
	}

	const optionsCollection = value !== null && typeof value === 'object'
		? (value as Record<string, unknown>)['collection']
		: undefined;

	return typeof optionsCollection === 'string'
		? optionsCollection
		: null;
}

// A JSON column reads as text outside Postgres.
function parsedColumnValue(columnValue: unknown) { // bb-unit-only: bb migrates an empty database
	if (typeof columnValue !== 'string') {
		return columnValue;
	}

	try {
		return JSON.parse(columnValue);
	}
	catch {
		return columnValue;
	}
}

export function moveRolePaths(
	value: unknown,
	collection: string | null,
	relationTargets: Map<string, string>,
	direction: RoleDirection,
): unknown { // bb-unit-only: bb migrates an empty database
	if (Array.isArray(value)) {
		return value.map((item) => {
			return moveRolePaths(item, collection, relationTargets, direction);
		});
	}

	if (value === null || typeof value !== 'object') {
		return value;
	}

	return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
		const isUsers = collection === 'directus_users';

		if (isUsers && direction === 'to-memberships' && key === 'role') {
			return ['roles', { role: nestedValue }];
		}

		const isMovedRole = isUsers
			&& direction === 'to-column'
			&& key === 'roles'
			&& nestedValue !== null
			&& typeof nestedValue === 'object'
			&& Object.keys(nestedValue).join() === 'role';

		if (isMovedRole) {
			return ['role', (nestedValue as { role: unknown }).role];
		}

		// An operator or a plain key filters the same collection.
		const nestedCollection = collection === null
			? null
			: relationTargets.get(`${collection}.${key}`) ?? collection;

		return [
			key,
			moveRolePaths(nestedValue, nestedCollection, relationTargets, direction),
		];
	}));
}

// A permission's field list names the user's top-level fields only.
function movePermissionFields(
	{ collection, value }: StoredRow,
	direction: RoleDirection,
): unknown { // bb-unit-only: bb migrates an empty database
	if (collection !== 'directus_users' || typeof value !== 'string') {
		return value;
	}

	const [fromField, toField] = direction === 'to-memberships'
		? ['role', 'roles']
		: ['roles', 'role'];

	return value.split(',')
		.map((field) => {
			return field === fromField
				? toField
				: field;
		})
		.join(',');
}

// A preset gives a value per field: the user's role becomes a membership.
function movePresetRole(
	{ collection, value }: StoredRow,
	direction: RoleDirection,
): unknown { // bb-unit-only: bb migrates an empty database
	if (
		collection !== 'directus_users'
		|| value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
	) {
		return value;
	}

	const { role, roles, ...otherPresets } = value as Record<string, unknown>;

	if (direction === 'to-memberships' && role !== undefined) {
		return { ...otherPresets, roles: [{ role }] };
	}

	const [onlyMembership] = Array.isArray(roles)
		? roles as Record<string, unknown>[]
		: [];

	const isMovedRole = direction === 'to-column'
		&& Array.isArray(roles)
		&& roles.length === 1
		&& Object.keys(onlyMembership ?? {}).join() === 'role';

	return isMovedRole
		? { ...otherPresets, role: onlyMembership!['role'] }
		: value;
}
