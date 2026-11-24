import type { Knex } from 'knex';

const UNIQUE_INDEX_NAME = 'directus_role_members_user_role_managed_by_unique';

/**
 * A user holds a role once per manager (#746): unique (user, role,
 * managed_by), a null `managed_by` counting as one manager. `up` refuses,
 * changing nothing, while a role is held twice, naming the rows.
 */
export async function up(knex: Knex): Promise<void> { // bb-unit-only: bb migrates an empty database
	const membershipRows: {
		id: string;
		user: string;
		role: string;
		managed_by: string | null;
	}[] = await knex
		.select('id', 'user', 'role', 'managed_by')
		.from('directus_role_members')
		.orderBy('id');

	const rowIdsByHolding = new Map<string, string[]>();

	for (const { id, user, role, managed_by } of membershipRows) {
		const holdingKey = JSON.stringify([user, role, managed_by]);

		rowIdsByHolding.set(holdingKey, [
			...rowIdsByHolding.get(holdingKey) ?? [],
			id,
		]);
	}

	const heldTwice = [...rowIdsByHolding].filter(([, rowIds]) => {
		return rowIds.length > 1;
	});

	if (heldTwice.length > 0) {
		const heldTwiceDescriptions = heldTwice.map(([holdingKey, rowIds]) => {
			const [user, role, managedBy] = JSON.parse(holdingKey);

			return `rows ${rowIds.map((id) => JSON.stringify(id)).join(', ')}`
				+ ` give user ${JSON.stringify(user)} the role`
				+ ` ${JSON.stringify(role)} with managed_by`
				+ ` ${JSON.stringify(managedBy)}`;
		});

		throw new Error(
			'Cannot make a role held once per manager: directus_role_members'
			+ ` ${heldTwiceDescriptions.join('; ')}; delete the extra rows first`,
		);
	}

	// TODO(#610): MariaDB indexes no expression, so two rows of the same role
	// with a null managed_by still pass there.
	if (String(knex.client.dialect).startsWith('mysql')) { // bb-out-of-scope: #610 MySQL
		await knex.schema.alterTable('directus_role_members', (table) => {
			table.unique(['user', 'role', 'managed_by'], {
				indexName: UNIQUE_INDEX_NAME,
			});
		});

		return;
	}

	// A plain unique index counts every null as distinct.
	await knex.raw(
		`create unique index "${UNIQUE_INDEX_NAME}" on "directus_role_members"`
		+ ' ("user", "role", coalesce("managed_by", \'\'))',
	);
}

export async function down(knex: Knex): Promise<void> { // bb-unit-only: bb never migrates down
	if (String(knex.client.dialect).startsWith('mysql')) { // bb-out-of-scope: #610 MySQL
		await knex.schema.alterTable('directus_role_members', (table) => {
			table.dropUnique(['user', 'role', 'managed_by'], UNIQUE_INDEX_NAME);
		});

		return;
	}

	await knex.raw(`drop index "${UNIQUE_INDEX_NAME}"`);
}
