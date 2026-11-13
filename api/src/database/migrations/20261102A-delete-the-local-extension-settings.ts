import type { Knex } from 'knex';

/**
 * Extensions load only as package dependencies, so the settings rows of the
 * extensions folder describe nothing this build reads.
 */
export async function up(knex: Knex): Promise<void> {
	await knex('directus_extensions')
		.whereIn(
			'bundle',
			knex
				.select('id')
				.from('directus_extensions')
				.where('source', 'local'),
		)
		.delete();

	await knex('directus_extensions')
		.where('source', 'local')
		.delete();
}

export async function down(_knex: Knex): Promise<void> {
	// One-way: a build reading an extensions folder again gives it fresh rows,
	// enabled by default.
}
