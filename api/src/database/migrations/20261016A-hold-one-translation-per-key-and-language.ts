import type { Knex } from 'knex';

const TABLE = 'directus_translations';
const INDEX_NAME = 'directus_translations_key_language_unique';

/**
 * One translation per key and language, held by the database. The service
 * reads before it writes, so two requests sent together both pass its check,
 * and a batch create never runs it.
 *
 * An instance already holding a duplicate is refused rather than merged: which
 * of two values is the right one is its owner's call, not a migration's.
 */
export async function up(knex: Knex): Promise<void> {
	const duplicatePairs = await knex
		.select('key', 'language')
		.count('* as copies')
		.from(TABLE)
		.groupBy('key', 'language')
		.havingRaw('count(*) > 1')
		.orderBy(['key', 'language']);

	if (duplicatePairs.length > 0) {
		const pairList = duplicatePairs
			.map(({ key, language, copies }) => {
				return `"${key}" in "${language}" (${copies} rows)`;
			})
			.join(', ');

		throw new Error(
			`${TABLE} holds more than one translation for ${pairList}. Delete`
			+ ` the extra rows, then run the migrations again.`,
		);
	}

	await knex.schema.alterTable(TABLE, (table) => {
		table.unique(['key', 'language'], { indexName: INDEX_NAME });
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable(TABLE, (table) => {
		table.dropUnique(['key', 'language'], INDEX_NAME);
	});
}
