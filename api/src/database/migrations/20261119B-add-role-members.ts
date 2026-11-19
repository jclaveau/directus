import { createInspector } from '@directus/schema';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

/**
 * A user holds several roles (#746): `directus_role_members` replaces
 * `directus_users.role`. Each user's role becomes their one membership, then
 * the column goes. `down` puts each user's one membership back in the column,
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

	const usersWithRole: { id: string; role: string }[] = await knex
		.select('id', 'role')
		.from('directus_users')
		.whereNotNull('role');

	const memberships = usersWithRole.map(({ id, role }) => {
		return {
			id: randomUUID(),
			user: id,
			role,
			sort: 1,
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
			.onDelete('SET NULL');
	});

	for (const [user, role] of roleByUser) {
		await knex('directus_users')
			.update({ role })
			.where({ id: user });
	}

	await knex.schema.dropTable('directus_role_members');
}
