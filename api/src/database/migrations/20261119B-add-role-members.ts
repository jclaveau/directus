import { createInspector } from '@directus/schema';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { chunk } from '../../utils/lodash-es-used.js';

const INVITES_UNIQUE_INDEX_NAME = 'directus_invites_email_role_inviter_unique';

// Stands for a null inviter in the unique index: no user holds that id.
const NO_INVITER_ID = '00000000-0000-0000-0000-000000000000';

type UserRow = {
	id: string;
	email: string | null;
	role: string | null;
	provider: string | null;
	status?: string;
};

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
 * the column goes. `directus_invites` records, by email, who invited whom to
 * which role until they accept: an `invited` user becomes the invite to its
 * role and goes. `up` refuses, changing nothing, while a foreign key
 * references an invited user. `down` puts each user's one membership back in
 * the column and each invite back as an invited user, and refuses, changing
 * nothing, while a user holds several roles or an email is invited to
 * several.
 */
export async function up(knex: Knex): Promise<void> { // bb-unit-only: bb migrates an empty database
	const userRows: UserRow[] = await knex
		.select('id', 'email', 'role', 'provider', 'status')
		.from('directus_users')
		.whereNotNull('role')
		.orWhere('status', 'invited');

	const invitedUsers = userRows.filter(({ status }) => {
		return status === 'invited';
	});

	refuseInvitedUsersLeavingNoInvite(invitedUsers);
	await refuseReferencedInvitedUsers(knex, invitedUsers);

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

	// One row per email, role and inviter; a null inviter for an invite made by
	// code, or whose inviter was deleted: the invite outlives them.
	await knex.schema.createTable('directus_invites', (table) => {
		table.uuid('id').primary();
		table.string('email', 255).notNullable();

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

	await createInvitesUniqueIndex(knex);

	// A mapped SSO user's role came from its provider: managing the membership
	// by that provider lets the next login replace it. A provider mapping no
	// role never replaces it, so an admin keeps it in hand.
	const memberships = userRows
		.filter(({ status }) => {
			return status !== 'invited';
		})
		.map(({ id, role, provider }) => {
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
	await moveInvitedUsersToInvites(knex, invitedUsers);
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

// An invite names an email and a role: without either, it would be lost.
function refuseInvitedUsersLeavingNoInvite(
	invitedUsers: UserRow[],
): void { // bb-unit-only: bb migrates an empty database
	const usersLeavingNoInvite = invitedUsers.filter(({ email, role }) => {
		return email === null || role === null;
	});

	if (usersLeavingNoInvite.length === 0) {
		return;
	}

	throw new Error(
		'Cannot move the invited users into invites: users'
		+ ` ${describeUsers(usersLeavingNoInvite)}`
		+ ' have no email or no role; give them one or delete them first',
	);
}

// Deleting an invited user would cascade to, or unlink, the rows naming it.
async function refuseReferencedInvitedUsers(
	knex: Knex,
	invitedUsers: UserRow[],
): Promise<void> { // bb-unit-only: bb migrates an empty database
	if (invitedUsers.length === 0) {
		return;
	}

	const userForeignKeys = (await createInspector(knex).foreignKeys())
		.filter(({ foreign_key_table }) => {
			return foreign_key_table === 'directus_users';
		});

	const referencedUserIds = new Set<string>();

	for (const { table, column } of userForeignKeys) {
		for (const invitedUsersChunk of chunk(invitedUsers, 1000)) {
			const referencingRows: Record<string, string>[] = await knex
				.distinct(column)
				.from(table)
				.whereIn(column, invitedUsersChunk.map(({ id }) => id));

			for (const referencingRow of referencingRows) {
				referencedUserIds.add(referencingRow[column]!);
			}
		}
	}

	const referencedUsers = invitedUsers.filter(({ id }) => {
		return referencedUserIds.has(id);
	});

	if (referencedUsers.length === 0) {
		return;
	}

	throw new Error(
		'Cannot move the invited users into invites: users'
		+ ` ${describeUsers(referencedUsers)}`
		+ ' are referenced by other records; remove those references first',
	);
}

function describeUsers(userRows: UserRow[]): string { // bb-unit-only: bb migrates an empty database
	return userRows
		.map(({ id, email }) => {
			return `${JSON.stringify(id)} (${JSON.stringify(email)})`;
		})
		.join(', ');
}

async function createInvitesUniqueIndex(knex: Knex): Promise<void> { // bb-unit-only: bb migrates an empty database
	// TODO(#610): MariaDB indexes no expression, so two invites of the same
	// email in another case, or with a null inviter, still pass there.
	if (String(knex.client.dialect).startsWith('mysql')) { // bb-out-of-scope: #610 MySQL
		await knex.schema.alterTable('directus_invites', (table) => {
			table.unique(['email', 'role', 'inviter'], {
				indexName: INVITES_UNIQUE_INDEX_NAME,
			});
		});

		return;
	}

	// An email matches in any case, as a login does; a plain unique index
	// counts every null inviter as distinct.
	await knex.raw(
		`create unique index "${INVITES_UNIQUE_INDEX_NAME}" on "directus_invites"`
		+ ` (lower("email"), "role", coalesce("inviter", '${NO_INVITER_ID}'))`,
	);
}

async function moveInvitedUsersToInvites(
	knex: Knex,
	invitedUsers: UserRow[],
): Promise<void> { // bb-unit-only: bb migrates an empty database
	const inviteRows = invitedUsers.map(({ email, role }) => {
		return { id: randomUUID(), email, role, inviter: null };
	});

	await knex.batchInsert('directus_invites', inviteRows, 200);

	for (const invitedUsersChunk of chunk(invitedUsers, 1000)) {
		await knex('directus_users')
			.whereIn('id', invitedUsersChunk.map(({ id }) => id))
			.delete();
	}
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

	const invitedRoleByEmail = await readInvitedRoleByEmail(knex);

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

	const invitedUsers = [...invitedRoleByEmail.values()].map(({ email, role }) => {
		return { id: randomUUID(), email, status: 'invited', role };
	});

	await knex.batchInsert('directus_users', invitedUsers, 200);
	await moveStoredRolePaths(knex, 'to-column');

	await knex.schema.dropTable('directus_invites');
	await knex.schema.dropTable('directus_role_members');
}

// An invited user holds one role and no account: an email invited to several
// roles, or holding an account, would lose its invites.
async function readInvitedRoleByEmail(
	knex: Knex,
): Promise<Map<string, { email: string; role: string }>> { // bb-unit-only: bb never migrates down
	const inviteRows: { email: string; role: string }[] = await knex
		.select('email', 'role')
		.from('directus_invites')
		.orderBy('date_created')
		.orderBy('id');

	// Keyed by the lower-case email, as the unique index compares them.
	const invitedRoleByEmail = new Map<string, { email: string; role: string }>();
	const severalRoleEmails = new Set<string>();

	for (const inviteRow of inviteRows) {
		const invitedEmail = inviteRow.email.toLowerCase();
		const firstInvite = invitedRoleByEmail.get(invitedEmail);

		if (firstInvite !== undefined && firstInvite.role !== inviteRow.role) {
			severalRoleEmails.add(invitedEmail);
		}

		invitedRoleByEmail.set(invitedEmail, firstInvite ?? inviteRow);
	}

	if (severalRoleEmails.size > 0) {
		throw new Error(
			'Cannot roll back the multi-role migration: emails'
			+ ` ${[...severalRoleEmails].map((email) => JSON.stringify(email)).join(', ')}`
			+ ' are invited to several roles; delete the extra invites first',
		);
	}

	const accountEmails = new Set<string>();

	for (const emailsChunk of chunk([...invitedRoleByEmail.keys()], 1000)) {
		const accountRows: { email: string }[] = await knex
			.select('email')
			.from('directus_users')
			.whereRaw(
				`lower(??) in (${emailsChunk.map(() => '?').join(', ')})`,
				['email', ...emailsChunk],
			);

		for (const { email } of accountRows) {
			accountEmails.add(email.toLowerCase());
		}
	}

	if (accountEmails.size > 0) {
		throw new Error(
			'Cannot roll back the multi-role migration: emails'
			+ ` ${[...accountEmails].map((email) => JSON.stringify(email)).join(', ')}`
			+ ' are invited and hold an account; delete their invites first',
		);
	}

	return invitedRoleByEmail;
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
