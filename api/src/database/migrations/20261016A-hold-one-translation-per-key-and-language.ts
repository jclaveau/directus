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
	const duplicatedPairs = knex
		.select('key', 'language')
		.from(TABLE)
		.groupBy('key', 'language')
		.havingRaw('count(*) > 1')
		.as('duplicated');

	const duplicateRows: { id: string; key: string; language: string }[] =
		await knex
			.select('translation.id', 'translation.key', 'translation.language')
			.from({ translation: TABLE })
			.join(duplicatedPairs, function joinPair() {
				this.on('translation.key', 'duplicated.key')
					.andOn('translation.language', 'duplicated.language');
			})
			.orderBy(['translation.key', 'translation.language'])
			.orderBy('translation.id');

	if (duplicateRows.length > 0) {
		const idsByPair = new Map<string, string[]>();

		for (const { id, key, language } of duplicateRows) {
			const pairLabel = `"${key}" in "${language}"`;
			idsByPair.set(pairLabel, [...idsByPair.get(pairLabel) ?? [], id]);
		}

		const pairList = [...idsByPair]
			.map(([pairLabel, rowIds]) => {
				return `${pairLabel} (rows ${rowIds.join(', ')})`;
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
