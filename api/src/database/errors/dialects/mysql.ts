import {
	ContainsNullValuesError,
	InvalidForeignKeyError,
	NotNullViolationError,
	RecordNotUniqueError,
	ValueOutOfRangeError,
	ValueTooLongError,
} from '@directus/errors';
import type { DatabaseErrorContext, MySQLError } from './types.js';
import type { Item } from '@directus/types';

enum MySQLErrorCodes {
	UNIQUE_VIOLATION = 'ER_DUP_ENTRY',
	NUMERIC_VALUE_OUT_OF_RANGE = 'ER_WARN_DATA_OUT_OF_RANGE',
	ER_DATA_TOO_LONG = 'ER_DATA_TOO_LONG',
	NOT_NULL_VIOLATION = 'ER_BAD_NULL_ERROR',
	// Insert/update a child with a bad parent reference.
	FOREIGN_KEY_VIOLATION = 'ER_NO_REFERENCED_ROW_2',
	// Delete/update a parent a child still references (RESTRICT/NO ACTION).
	FOREIGN_KEY_STILL_REFERENCED = 'ER_ROW_IS_REFERENCED_2',
	ER_INVALID_USE_OF_NULL = 'ER_INVALID_USE_OF_NULL',
	WARN_DATA_TRUNCATED = 'WARN_DATA_TRUNCATED',
}

export function extractError(
	error: MySQLError,
	data: Partial<Item>,
	context?: DatabaseErrorContext,
): MySQLError | Error {
	switch (error.code) {
		case MySQLErrorCodes.UNIQUE_VIOLATION:
			return uniqueViolation();
		case MySQLErrorCodes.NUMERIC_VALUE_OUT_OF_RANGE:
			return numericValueOutOfRange();
		case MySQLErrorCodes.ER_DATA_TOO_LONG:
			return valueLimitViolation();
		case MySQLErrorCodes.NOT_NULL_VIOLATION:
			return notNullViolation();
		case MySQLErrorCodes.FOREIGN_KEY_VIOLATION:
		case MySQLErrorCodes.FOREIGN_KEY_STILL_REFERENCED:
			return foreignKeyViolation(context);
		// Note: MariaDB throws data truncated for null value error
		case MySQLErrorCodes.ER_INVALID_USE_OF_NULL:
		case MySQLErrorCodes.WARN_DATA_TRUNCATED:
			return containsNullValues();
	}

	return error;

	function uniqueViolation() {
		const betweenQuotes = /'([^']+)'/g;
		const matches = error.sqlMessage.match(betweenQuotes);

		if (!matches) return error;

		/**
		 * MySQL's error doesn't return the field name in the error. In case the field is created through
		 * Directus (/ Knex), the key name will be `<collection>_<field>_unique` in which case we can pull
		 * the field name from the key name.
		 * If the field is the primary key it instead will be `<collection>_PRIMARY` for MySQL 8+
		 * and `PRIMARY` for MySQL 5.7 and MariaDB.
		 */

		let collection: string | null;
		let indexName: string;
		let field = null;

		if (matches[1]!.includes('.')) {
			// MySQL 8+ style error message

			// In case of primary key matches[1] is `'<collection>.PRIMARY'`
			// In case of other field matches[1] is `'<collection>.<collection>_<field>_unique'`
			[collection, indexName] = matches[1]!.slice(1, -1).split('.') as [string, string];
		} else {
			// MySQL 5.7 and MariaDB style error message

			// In case of primary key matches[1] is `'PRIMARY'`
			// In case of other field matches[1] is `'<collection>_<field>_unique'`
			indexName = matches[1]!.slice(1, -1);
			collection = indexName.includes('_') ? indexName.split('_')[0]! : null;
		}

		if (collection !== null && indexName.startsWith(`${collection}_`) && indexName.endsWith('_unique')) {
			field = indexName?.slice(collection.length + 1, -7);
		}

		return new RecordNotUniqueError({
			collection,
			field,
			value: field ? data[field] : null,
			primaryKey: indexName === 'PRIMARY', // propagate information about primary key violation
		});
	}

	function numericValueOutOfRange() {
		const betweenTicks = /`([^`]+)`/g;
		const betweenQuotes = /'([^']+)'/g;

		const tickMatches = error.sql.match(betweenTicks);
		const quoteMatches = error.sqlMessage.match(betweenQuotes);

		if (!tickMatches || !quoteMatches) return error;

		const collection = tickMatches[0]?.slice(1, -1);
		const field = quoteMatches[0]?.slice(1, -1);

		return new ValueOutOfRangeError({
			collection,
			field,
			value: field ? data[field] : null,
		});
	}

	function valueLimitViolation() {
		const betweenTicks = /`([^`]+)`/g;
		const betweenQuotes = /'([^']+)'/g;

		const tickMatches = error.sql.match(betweenTicks);
		const quoteMatches = error.sqlMessage.match(betweenQuotes);

		if (!tickMatches || !quoteMatches) return error;

		const collection = tickMatches[0]?.slice(1, -1);
		const field = quoteMatches[0]?.slice(1, -1);

		return new ValueTooLongError({
			collection,
			field,
			value: field ? data[field] : null,
		});
	}

	function notNullViolation() {
		const betweenTicks = /`([^`]+)`/g;
		const betweenQuotes = /'([^']+)'/g;

		const tickMatches = error.sql.match(betweenTicks);
		const quoteMatches = error.sqlMessage.match(betweenQuotes);

		if (!tickMatches || !quoteMatches) return error;

		const collection = tickMatches[0]?.slice(1, -1);
		const field = quoteMatches[0]?.slice(1, -1);

		return new NotNullViolationError({
			collection,
			field,
		});
	}

	function foreignKeyViolation(context?: DatabaseErrorContext) {
		const betweenTicks = /`([^`]+)`/g;

		// The constraint clause is in sqlMessage; error.sql isn't parsed (a delete
		// carries no value parens, so requiring them would drop the delete case).
		const tickMatches = error.sqlMessage.match(betweenTicks);

		if (!tickMatches) {
			return error;
		}

		// Tick groups in the constraint clause: [1]=child table, [2]=constraint,
		// [3]=child column, [4]=parent table. On delete the referrer child is [1]
		// and the user acted on the parent, so prefer the operated-on collection.
		const childTable = tickMatches[1]!.slice(1, -1);
		const field = tickMatches[3]!.slice(1, -1);
		const constraint = tickMatches[2]?.slice(1, -1) ?? null;
		const parentTable = tickMatches[4]?.slice(1, -1) ?? null;

		const stillReferenced =
			error.code === MySQLErrorCodes.FOREIGN_KEY_STILL_REFERENCED;

		const reason = stillReferenced
			? 'still_referenced'
			: 'invalid_reference';

		const collection = context?.collection ?? childTable;

		const relatedCollection = stillReferenced
			? childTable
			: parentTable;

		const value =
			field && data[field] !== undefined
				? data[field]
				: null;

		return new InvalidForeignKeyError({
			collection,
			field,
			value,
			constraint,
			relatedCollection,
			reason,
			operation: context?.operation ?? null,
		});
	}

	function containsNullValues() {
		const betweenTicks = /`([^`]+)`/g;

		// Normally, we shouldn't read from the executed SQL. In this case, we're altering a single
		// column, so we shouldn't have the problem where multiple columns are altered at the same time
		const tickMatches = error.sql.match(betweenTicks);

		if (!tickMatches) return error;

		const collection = tickMatches[0]!.slice(1, -1)!;
		const field = tickMatches[1]!.slice(1, -1)!;

		return new ContainsNullValuesError({ collection, field });
	}
}
