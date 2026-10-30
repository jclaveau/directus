import type { Type } from '@directus/types';
import { CapabilitiesHelper } from '../types.js';

// A json field arrives stringified and would land as a JSON string, a geometry
// as a raw call, and an unknown type as anything.
const JSON_BATCH_UPDATE_TYPES: ReadonlySet<Type> = new Set<Type>([
	'bigInteger',
	'boolean',
	'csv',
	'date',
	'dateTime',
	'decimal',
	'float',
	'hash',
	'integer',
	'string',
	'text',
	'time',
	'timestamp',
	'uuid',
]);

export class CapabilitiesHelperPostgres extends CapabilitiesHelper {
	override supportsColumnPositionInGroupBy(): boolean {
		// Supported in Postgres https://www.postgresql.org/docs/8.3/sql-select.html#SQL-GROUPBY
		// Supported in CockroachDB (tested manually)
		return true;
	}

	override supportsDeduplicationOfParameters(): boolean {
		// Postgres infers the type from the context in which the parameter is first referenced.
		// This causes issues when the same parameter is used in different contexts with different types.
		// See https://www.postgresql.org/docs/current/sql-prepare.html
		return false;
	}

	override async preservesInsertOrderInReturning(): Promise<boolean> {
		// Postgres's INSERT … RETURNING returns one row per inserted row, in insertion order,
		// within a single statement. Same semantics inherited by CockroachDB and Redshift.
		// https://www.postgresql.org/docs/current/sql-insert.html
		return true;
	}

	override supportsJsonBatchUpdate(): boolean {
		// knex expands the rows from one jsonb param via jsonb_populate_recordset.
		return true;
	}

	override jsonBatchUpdateTypes(): ReadonlySet<Type> {
		return JSON_BATCH_UPDATE_TYPES;
	}
}
