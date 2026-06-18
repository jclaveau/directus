import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { getDefaultIndexName } from '../../../../utils/get-default-index-name.js';
import { type InvalidCollationColumn, SchemaHelper, type SortRecord } from '../types.js';

const env = useEnv();

export class SchemaHelperMySQL extends SchemaHelper {
	override generateIndexName(
		type: 'unique' | 'foreign' | 'index',
		collection: string,
		fields: string | string[],
	): string {
		return getDefaultIndexName(type, collection, fields, { maxLength: 64 });
	}

	// MySQL has no DROP ... IF EXISTS for indexes/constraints (and MariaDB rides this same client),
	// so check the catalog first. Unique constraints and plain indexes both surface in
	// information_schema.statistics, so one lookup serves both drops below.
	private async hasIndex(knex: Knex, collection: string, indexName: string): Promise<boolean> {
		const result = await knex
			.select('index_name')
			.from('information_schema.statistics')
			.whereRaw('table_schema = database()')
			.andWhere({ table_name: collection, index_name: indexName })
			.first();

		return Boolean(result);
	}

	override async dropUniqueIfExists(knex: Knex, collection: string, field: string): Promise<void> {
		const constraintName = this.generateIndexName('unique', collection, field);

		if (await this.hasIndex(knex, collection, constraintName)) {
			await knex.schema.alterTable(collection, (table) => {
				table.dropUnique([field], constraintName);
			});
		}
	}

	override async dropIndexIfExists(knex: Knex, collection: string, field: string): Promise<void> {
		const indexName = this.generateIndexName('index', collection, field);

		if (await this.hasIndex(knex, collection, indexName)) {
			await knex.schema.alterTable(collection, (table) => {
				table.dropIndex([field], indexName);
			});
		}
	}

	override async getDatabaseSize(): Promise<number | null> {
		try {
			const result = (await this.knex
				.sum('size AS size')
				.from(
					this.knex
						.select(this.knex.raw('data_length + index_length AS size'))
						.from('information_schema.TABLES')
						.where('table_schema', '=', String(env['DB_DATABASE']))
						.as('size'),
				)) as Record<string, any>[];

			return result[0]?.['size'] ? Number(result[0]?.['size']) : null;
		} catch {
			return null;
		}
	}

	override addInnerSortFieldsToGroupBy(
		groupByFields: (string | Knex.Raw)[],
		sortRecords: SortRecord[],
		hasRelationalSort: boolean,
	) {
		if (hasRelationalSort) {
			/*
			** MySQL **

			MySQL only requires all selected sort columns that are not functionally dependent on the primary key to be included.

			> If the ONLY_FULL_GROUP_BY SQL mode is enabled (which it is by default),
			  MySQL rejects queries for which the select list, HAVING condition, or ORDER BY list refer to
			  nonaggregated columns that are neither named in the GROUP BY clause nor are functionally dependent on them.

			https://dev.mysql.com/doc/refman/8.4/en/group-by-handling.html

			MySQL allows aliases to be used in the GROUP BY clause

			> You can use the alias in GROUP BY, ORDER BY, or HAVING clauses to refer to the column:

			https://dev.mysql.com/doc/refman/8.4/en/problems-with-alias.html

			** MariaDB **

			MariaDB does not document how it supports functional dependent columns in GROUP BY clauses.
			But testing shows that it does support the same features as MySQL in this area.

			MariaDB allows aliases to be used in the GROUP BY clause

			> The GROUP BY expression can be a computed value, and can refer back to an identifer specified with AS.

			https://mariadb.com/kb/en/group-by/#group-by-examples
			 */

			groupByFields.push(...sortRecords.map(({ alias }) => alias));
		}
	}

	override async getColumnsWithInvalidCollation(schema: string, collation: string): Promise<InvalidCollationColumn[]> {
		const { version } = await this.knex.select(this.knex.raw('VERSION() as version')).first();
		const isMariaDB = String(version).split('-').includes('MariaDB');

		return this.knex('information_schema.columns')
			.select<InvalidCollationColumn[]>({
				table_name: 'TABLE_NAME',
				name: 'COLUMN_NAME',
				collation: 'COLLATION_NAME',
			})
			.where({ TABLE_SCHEMA: schema })
			.whereNot({ COLLATION_NAME: collation })
			.modify((queryBuilder) => {
				// MariaDB has no native JSON type; it stores JSON as LONGTEXT with the utf8mb4_bin
				// collation, so that pairing is expected rather than a real collation mismatch.
				// Exclude only the pairing — NOT(longtext AND utf8mb4_bin) — so a longtext column
				// with a genuinely wrong collation (or a utf8mb4_bin non-longtext) is still reported.
				if (isMariaDB) {
					queryBuilder.andWhereNot((qb) => {
						void qb.where({ COLUMN_TYPE: 'longtext' }).andWhere({ COLLATION_NAME: 'utf8mb4_bin' });
					});
				}
			});
	}
}
