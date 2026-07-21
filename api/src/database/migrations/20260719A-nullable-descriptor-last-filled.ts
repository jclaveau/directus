import type { Knex } from 'knex';

/**
 * Make `last_filled` nullable. An anomaly locator (a descriptor written only so the
 * anomaly resolves to a tree node) was never filled, so it stores NULL instead of a
 * fabricated fill time — which keeps Age/Expires honest and marks it out of the
 * entries listing (`WHERE last_filled IS NOT NULL`), no separate flag needed.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_descriptors', (table) => {
		table
			.timestamp('last_filled')
			.nullable()
			.alter();
	});
}

export async function down(knex: Knex): Promise<void> {
	// Locators hold a NULL last_filled and are disposable; drop them first, else
	// re-tightening to NOT NULL fails on "column contains null values".
	await knex('directus_cache_descriptors')
		.whereNull('last_filled')
		.delete();

	await knex.schema.alterTable('directus_cache_descriptors', (table) => {
		table
			.timestamp('last_filled')
			.notNullable()
			.alter();
	});
}
