import {
	ContainsNullValuesError,
	InvalidForeignKeyError,
	NotNullViolationError,
	RecordNotUniqueError,
} from '@directus/errors';
import type { DatabaseErrorContext, SQLiteError } from './types.js';
import type { Item } from '@directus/types';

// NOTE:
// - Sqlite doesn't have varchar with length support, so no ValueTooLongError
// - Sqlite doesn't have a max range for numbers, so no ValueOutOfRangeError

export function extractError(
	error: SQLiteError,
	data: Partial<Item>,
	context?: DatabaseErrorContext,
): SQLiteError | Error {
	if (error.message.includes('SQLITE_CONSTRAINT: NOT NULL')) {
		return notNullConstraint(error);
	}

	if (error.message.includes('SQLITE_CONSTRAINT: UNIQUE')) {
		const errorParts = error.message.split(' ');
		const [table, field] = errorParts[errorParts.length - 1]!.split('.');

		if (!table || !field) return error;

		return new RecordNotUniqueError({
			collection: table,
			field,
			value: field ? data[field] : null,
		});
	}

	if (error.message.includes('SQLITE_CONSTRAINT: FOREIGN KEY')) {
		// SQLite's error carries no table/column/value/direction. The operated
		// collection is threaded from the call site, and the direction can be derived
		// from the operation (a delete blocks a still-referenced parent, a create is a
		// bad reference) — an update is left unknown. Constraint/related stay null so
		// the extensions shape matches the other dialects.
		const operation = context?.operation ?? null;

		let reason: 'still_referenced' | 'invalid_reference' | null = null;

		if (operation === 'delete') {
			reason = 'still_referenced';
		}
		else if (operation === 'create') {
			reason = 'invalid_reference';
		}

		return new InvalidForeignKeyError({
			collection: context?.collection ?? null,
			field: null,
			value: null,
			constraint: null,
			relatedCollection: null,
			reason,
			operation,
		});
	}

	return error;
}

function notNullConstraint(error: SQLiteError) {
	const errorParts = error.message.split(' ');
	const [table, column] = errorParts[errorParts.length - 1]!.split('.');

	if (table && column) {
		// Now this gets a little finicky... SQLite doesn't have any native ALTER, so Knex implements
		// it by creating a new table, and then copying the data over. That also means we'll never get
		// a ContainsNullValues constraint error, as there is no ALTER. HOWEVER, we can hack around
		// that by checking for the collection name, as Knex's alter default template name will always
		// start with _knex_temp. The best we can do in this case is check for that, and use it to
		// decide between NotNullViolation and ContainsNullValues
		if (table.startsWith('_knex_temp_alter')) {
			return new ContainsNullValuesError({ collection: table, field: column });
		}

		return new NotNullViolationError({
			collection: table,
			field: column,
		});
	}

	return error;
}
