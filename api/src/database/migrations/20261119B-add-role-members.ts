import { createInspector } from '@directus/schema';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const INVITES_UNIQUE_INDEX_NAME = 'directus_invites_user_role_user_created_unique';
const INVITE_MEMBERSHIPS_INDEX_NAME = 'directus_role_members_invite_index';

/**
 * A user holds several roles (#746): `directus_role_members` replaces
 * `directus_users.role`. Each user's role becomes their one membership,
 * managed by `auth:<provider>` for a user of a provider other than "default",
 * then the column goes. `directus_invites` records who invited a user to
 * which role (D8). `down` puts each user's one membership back in the column,
 * and refuses, changing nothing, while a user holds several roles.
 */
export async function up(knex: Knex): Promise<void> {
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

	// One row per user, role and inviter; null for an invite naming no user. An
	// inviter deleted takes their invites along.
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

		table.uuid('user_created')
			.references('directus_users.id')
			.nullable()
			.onDelete('CASCADE');

		table.timestamp('date_created').defaultTo(knex.fn.now());
	});

	// TODO(#610): MariaDB indexes no expression, so two invites naming no user
	// to the same role still pass there.
	if (String(knex.client.dialect).startsWith('mysql')) {
		await knex.schema.alterTable('directus_invites', (table) => {
			table.unique(['user', 'role', 'user_created'], {
				indexName: INVITES_UNIQUE_INDEX_NAME,
			});
		});
	}
	else {
		// A plain unique index counts every null as distinct.
		await knex.raw(
			`create unique index "${INVITES_UNIQUE_INDEX_NAME}" on "directus_invites"`
			+ ' ("user", "role", coalesce(cast("user_created" as text), \'\'))',
		);
	}

	// A user deleted checks every `invite` membership for an invite left: the
	// rest of the memberships stay out of that scan.
	// TODO(#610): MariaDB has no partial index.
	if (!String(knex.client.dialect).startsWith('mysql')) {
		await knex.raw(
			`create index "${INVITE_MEMBERSHIPS_INDEX_NAME}" on "directus_role_members"`
			+ ' ("user", "role") where "managed_by" = \'invite\'',
		);
	}

	const usersWithRole: {
		id: string;
		role: string;
		provider: string | null;
	}[] = await knex
		.select('id', 'role', 'provider')
		.from('directus_users')
		.whereNotNull('role');

	// An SSO user's role came from its provider: managing the membership by
	// that provider lets the next mapped login replace it.
	const memberships = usersWithRole.map(({ id, role, provider }) => {
		return {
			id: randomUUID(),
			user: id,
			role,
			sort: 1,
			managed_by: provider === null || provider === 'default'
				? null
				: `auth:${provider}`,
		};
	});

	await knex.batchInsert('directus_role_members', memberships, 200);

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

export async function down(knex: Knex): Promise<void> {
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
			.onDelete('CASCADE');
	});

	for (const [user, role] of roleByUser) {
		await knex('directus_users')
			.update({ role })
			.where({ id: user });
	}

	if (!String(knex.client.dialect).startsWith('mysql')) {
		await knex.raw(`drop index "${INVITE_MEMBERSHIPS_INDEX_NAME}"`);
	}

	await knex.schema.dropTable('directus_invites');
	await knex.schema.dropTable('directus_role_members');
}
