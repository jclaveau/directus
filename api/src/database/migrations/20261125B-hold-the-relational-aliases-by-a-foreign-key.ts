import type { Knex } from 'knex';
import { RELATIONAL_ALIAS_SPECIALS } from '../../utils/relational-alias.js';
import { getDatabaseClient } from '../index.js';

const FOREIGN_KEY_NAME = 'directus_fields_relation_alias_foreign';

/**
 * `relation_alias` holds the field name of a relational alias, null on every
 * other row, so the foreign key refuses at commit an alias no relation names
 * in `one_field`. It is deferred: the app and `/schema/apply` may write the
 * alias and its relation in either order within one transaction.
 *
 * Postgres refuses ON UPDATE CASCADE on a generated column, so a rename of
 * `one_field` renames the alias in the same transaction.
 */
export async function up(knex: Knex): Promise<void> {
	// TODO(#610): hold the relational aliases on the other dialects too.
	if (getDatabaseClient(knex) !== 'postgres') {
		return;
	}

	const specialPattern = `(^|,)(${RELATIONAL_ALIAS_SPECIALS.join('|')})(,|$)`;

	// A DDL statement takes no bind parameter: the pattern is a constant.
	await knex.raw(
		'alter table directus_fields add column relation_alias varchar(64)'
		+ ` generated always as (case when special ~ '${specialPattern}'`
		+ ' then field end) stored',
	);

	await knex.raw(
		`alter table directus_fields add constraint ${FOREIGN_KEY_NAME}`
		+ ' foreign key (collection, relation_alias)'
		+ ' references directus_relations (one_collection, one_field)'
		+ ' on delete cascade deferrable initially deferred',
	);
}

export async function down(knex: Knex): Promise<void> {
	if (getDatabaseClient(knex) !== 'postgres') {
		return;
	}

	await knex.raw(
		`alter table directus_fields drop constraint ${FOREIGN_KEY_NAME}`,
	);

	await knex.raw('alter table directus_fields drop column relation_alias');
}
