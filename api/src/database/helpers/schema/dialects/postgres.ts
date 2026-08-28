import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { getDefaultIndexName } from '../../../../utils/get-default-index-name.js';
import { SchemaHelper, type SortRecord } from '../types.js';

const env = useEnv();

/**
 * Whether the extension is installed, per connection.
 *
 * Uncached, the probe answered 26 times over one cursus registration while the size query it
 * gates ran 13 — the guard cost twice what it guarded (measured 2026-08-28). Keyed on the knex
 * instance rather than held in the module, so it is not process-global state shared by every
 * caller and a second connection answers for itself.
 *
 * An extension installed while the process runs is not seen until it restarts. Installing one
 * is a migration, which is a deploy, so that window closes on its own.
 */
const timescalePresence = new WeakMap<Knex, boolean>();

export class SchemaHelperPostgres extends SchemaHelper {
	override generateIndexName(
		type: 'unique' | 'foreign' | 'index',
		collection: string,
		fields: string | string[],
	): string {
		return getDefaultIndexName(type, collection, fields, { maxLength: 63 });
	}

	override async hasTimescale(): Promise<boolean> {
		const answered = timescalePresence.get(this.knex);

		if (answered !== undefined) {
			return answered;
		}

		const { rows } = await this.knex.raw(
			`SELECT EXISTS(SELECT 1 FROM pg_extension `
			+ `WHERE extname = 'timescaledb') AS has`,
		);

		const present = rows[0].has === true;
		timescalePresence.set(this.knex, present);

		return present;
	}

	override async isHypertable(table: string): Promise<boolean> {
		// The catalog view only exists with the extension, so the gate above has
		// to answer first — asking this of a plain Postgres throws.
		const { rows } = await this.knex.raw(
			`SELECT EXISTS(SELECT 1 FROM timescaledb_information.hypertables `
			+ `WHERE hypertable_name = ?) AS has`,
			[table],
		);

		return rows[0].has === true;
	}

	/**
	 * `hypertable_size()` for a chunked table — its rows live in chunks the parent
	 * relation knows nothing about, so `pg_total_relation_size()` reads near zero
	 * there — and `pg_total_relation_size()` for every other table.
	 *
	 * `to_regclass` answers null for a table this database never created, and SUM
	 * skips that row rather than failing the whole measurement.
	 */
	override async getTablesSize(tables: string[]): Promise<number | null> {
		try {
			const { rows } = await this.knex.raw(
				(await this.hasTimescale())
					? `SELECT COALESCE(SUM(CASE `
						+ `WHEN chunked.hypertable_name IS NOT NULL `
						+ `THEN hypertable_size(named.table_name::regclass) `
						+ `ELSE pg_total_relation_size(to_regclass(named.table_name)) `
						+ `END), 0) AS bytes `
						+ `FROM unnest(?::text[]) AS named(table_name) `
						+ `LEFT JOIN timescaledb_information.hypertables AS chunked `
						+ `ON chunked.hypertable_name = named.table_name`
					: `SELECT COALESCE(SUM(`
						+ `pg_total_relation_size(to_regclass(named.table_name))`
						+ `), 0) AS bytes `
						+ `FROM unnest(?::text[]) AS named(table_name)`,
				[tables],
			);

			return Number(rows[0].bytes);
		}
		catch {
			return null;
		}
	}

	override async dropOldestChunk(
		tables: string[],
		olderThan: Date,
	): Promise<{ table: string; upTo: Date } | null> {
		if (!(await this.hasTimescale())) {
			return null;
		}

		const { rows } = await this.knex.raw(
			`SELECT hypertable_name, range_end FROM timescaledb_information.chunks `
			+ `WHERE hypertable_name = ANY(?) AND range_end <= ? `
			+ `ORDER BY range_start LIMIT 1`,
			[tables, olderThan],
		);

		if (rows.length === 0) {
			return null;
		}

		const { hypertable_name: table, range_end: upTo } = rows[0];

		await this.knex.raw(
			`SELECT drop_chunks(?::regclass, older_than => ?::timestamptz)`,
			[table, upTo],
		);

		return { table, upTo: new Date(upTo) };
	}

	override async getDatabaseSize(): Promise<number | null> {
		try {
			const result = await this.knex.select(
				this.knex.raw(`pg_database_size(?) as size;`, [env['DB_DATABASE'] as string]),
			);

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
			Postgres only requires selected columns that are not functionally dependent on the primary key to be
			included in the GROUP BY clause. Since the results are already grouped by the primary key, we don't need to
			always include the sort columns in the GROUP BY but only if there is a relational sort involved, eg.
			a sort column that comes from a related M2O relation.

			> When GROUP BY is present, or any aggregate functions are present, it is not valid for the SELECT list
			  expressions to refer to ungrouped columns except within aggregate functions or when the ungrouped column is
			  functionally dependent on the grouped columns, since there would otherwise be more than one possible value to
			  return for an ungrouped column.
			https://www.postgresql.org/docs/current/sql-select.html

			Postgres allows aliases to be used in the GROUP BY clause

			> In strict SQL, GROUP BY can only group by columns of the source table but PostgreSQL extends this to also allow
			  GROUP BY to group by columns in the select list.
      https://www.postgresql.org/docs/16/queries-table-expressions.html#QUERIES-GROUP
			 */

			groupByFields.push(...sortRecords.map(({ alias }) => alias));
		}
	}
}
