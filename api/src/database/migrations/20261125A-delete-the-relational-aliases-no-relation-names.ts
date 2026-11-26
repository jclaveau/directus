import type { Knex } from 'knex';
import { findRelationalSpecial } from '../../utils/relational-alias.js';
import { getDatabaseClient } from '../index.js';

const UNIQUE_KEY_NAME = 'relations_one_field_unique';
const DELETE_CHUNK_SIZE = 500;

/**
 * A relational alias no relation names in `one_field` is read as a column,
 * and every read of its collection then fails on a column the table does not
 * hold. Such rows are deleted, and one relation per alias is held by the
 * database.
 *
 * An instance where two relations name one alias is refused rather than
 * repaired: which of them the alias reads through is its owner's call.
 */
export async function up(knex: Knex): Promise<void> {
	await refuseAliasesNamedTwice(knex);
	await deleteUnnamedRelationalAliases(knex);

	// TODO(#610): hold one relation per alias on the other dialects too.
	if (getDatabaseClient(knex) === 'postgres') {
		await knex.schema.alterTable('directus_relations', (table) => {
			table.unique(['one_collection', 'one_field'], {
				indexName: UNIQUE_KEY_NAME,
			});
		});
	}
}

/**
 * The deleted aliases are not restored: nothing kept them, and each one only
 * failed the reads of its collection.
 */
export async function down(knex: Knex): Promise<void> {
	if (getDatabaseClient(knex) === 'postgres') {
		await knex.schema.alterTable('directus_relations', (table) => {
			table.dropUnique(['one_collection', 'one_field'], UNIQUE_KEY_NAME);
		});
	}
}

async function refuseAliasesNamedTwice(knex: Knex) {
	const namingRows: { id: number; one_collection: string; one_field: string }[]
		= await knex
			.select('id', 'one_collection', 'one_field')
			.from('directus_relations')
			.whereIn(['one_collection', 'one_field'], knex
				.select('one_collection', 'one_field')
				.from('directus_relations')
				.whereNotNull('one_collection')
				.whereNotNull('one_field')
				.groupBy('one_collection', 'one_field')
				.havingRaw('count(*) > 1'))
			.orderBy('one_collection')
			.orderBy('one_field')
			.orderBy('id');

	if (namingRows.length === 0) {
		return;
	}

	const idsByAlias = new Map<string, number[]>();

	for (const namingRow of namingRows) {
		const aliasName = `field ${JSON.stringify(namingRow.one_field)}`
			+ ` of ${JSON.stringify(namingRow.one_collection)}`;

		idsByAlias.set(aliasName, [...idsByAlias.get(aliasName) ?? [], namingRow.id]);
	}

	const aliasList = [...idsByAlias]
		.map(([aliasName, rowIds]) => {
			return `${aliasName} (rows ${rowIds.join(', ')})`;
		})
		.join(', ');

	throw new Error(
		`directus_relations names more than once in one_field the alias ${aliasList}.`
		+ ' Keep one relation per alias, clear one_field on the others, then run'
		+ ' the migrations again.',
	);
}

async function deleteUnnamedRelationalAliases(knex: Knex) {
	const aliasRows: {
		id: number;
		collection: string;
		field: string;
		special: string | null;
	}[] = await knex
			.select('id', 'collection', 'field', 'special')
			.from('directus_fields')
			.whereNotNull('special');

	const namingRows: { one_collection: string; one_field: string }[] = await knex
		.select('one_collection', 'one_field')
		.from('directus_relations')
		.whereNotNull('one_collection')
		.whereNotNull('one_field');

	const namedAliases = new Set(namingRows.map((namingRow) => {
		return JSON.stringify([namingRow.one_collection, namingRow.one_field]);
	}));

	const unnamedIds = aliasRows
		.filter((aliasRow) => {
			return findRelationalSpecial(aliasRow.special) !== undefined
				&& namedAliases.has(
					JSON.stringify([aliasRow.collection, aliasRow.field]),
				) === false;
		})
		.map((aliasRow) => aliasRow.id);

	for (
		let chunkStart = 0;
		chunkStart < unnamedIds.length;
		chunkStart += DELETE_CHUNK_SIZE
	) {
		const chunkEnd = chunkStart + DELETE_CHUNK_SIZE;

		await knex('directus_fields')
			.whereIn('id', unnamedIds.slice(chunkStart, chunkEnd))
			.delete();
	}
}
