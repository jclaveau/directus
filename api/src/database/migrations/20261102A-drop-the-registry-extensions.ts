import type { Knex } from 'knex';

const TABLE = 'directus_extensions';

/**
 * Extensions change only with a deploy (#627): nothing loads a registry install,
 * so its settings row would only list a missing extension. An entry of a
 * registry bundle goes with its bundle, whatever source it carries.
 */
export async function up(knex: Knex): Promise<void> {
	const registryRows: { id: string }[] = await knex
		.select('id')
		.from(TABLE)
		.where({ source: 'registry' });

	const registryIds = registryRows.map(({ id }) => id);

	if (registryIds.length === 0) {
		return;
	}

	await knex(TABLE)
		.whereIn('bundle', registryIds)
		.delete();

	await knex(TABLE)
		.whereIn('id', registryIds)
		.delete();
}

/**
 * The deleted rows stay deleted: they named Marketplace installs, which a deploy
 * brings back as packages, with settings rows of their own.
 */
export async function down(_knex: Knex): Promise<void> {
	return;
}
