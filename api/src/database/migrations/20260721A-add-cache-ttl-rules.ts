import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_ttl_rules', (table) => {
		table.increments('id').primary();
		table.string('path').notNullable(); // endpoint prefix
		table.string('method', 10).notNullable().defaultTo('*');
		table.string('query_shape', 12).notNullable().defaultTo('*');
		table.string('ttl').notNullable(); // human ('1h') or ms string
		table.integer('sort').notNullable().defaultTo(0);
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_ttl_rules');
}
