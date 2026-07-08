import {
	ContainsNullValuesError,
	InvalidForeignKeyError,
	NotNullViolationError,
	RecordNotUniqueError,
} from '@directus/errors';
import { describe, expect, it } from 'vitest';
import { extractError } from './sqlite.js';
import type { SQLiteError } from './types.js';

function sqliteError(message: string): SQLiteError {
	return { message, errno: 0, code: 'SQLITE_CONSTRAINT' } as SQLiteError;
}

describe('not null constraint', () => {
	it('maps to NotNullViolationError for a real column', () => {
		const error = sqliteError('SQLITE_CONSTRAINT: NOT NULL articles.title');

		const result = extractError(error, {});

		expect(result).toBeInstanceOf(NotNullViolationError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
		});
	});

	it('maps to ContainsNullValuesError on a knex temp-alter table', () => {
		const error = sqliteError('SQLITE_CONSTRAINT: NOT NULL _knex_temp_alter1.title');

		const result = extractError(error, {});

		expect(result).toBeInstanceOf(ContainsNullValuesError);

		expect((result as any).extensions).toEqual({
			collection: '_knex_temp_alter1',
			field: 'title',
		});
	});

	it('returns the raw error when no dotted table.column can be parsed', () => {
		const error = sqliteError('SQLITE_CONSTRAINT: NOT NULL articles');

		expect(extractError(error, {})).toBe(error);
	});
});

describe('unique constraint', () => {
	it('maps to RecordNotUniqueError with collection and field', () => {
		const error = sqliteError('SQLITE_CONSTRAINT: UNIQUE articles.email');

		const result = extractError(error, { email: 'a@b.c' });

		expect(result).toBeInstanceOf(RecordNotUniqueError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'email',
			value: 'a@b.c',
		});
	});

	it('returns the raw error when no dotted table.column can be parsed', () => {
		const error = sqliteError('SQLITE_CONSTRAINT: UNIQUE articles');

		expect(extractError(error, {})).toBe(error);
	});
});

describe('foreign key constraint', () => {
	it('maps to InvalidForeignKeyError with null identifiers', () => {
		const error = sqliteError('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed');

		const result = extractError(error, {});

		expect(result).toBeInstanceOf(InvalidForeignKeyError);

		expect((result as any).extensions).toEqual({
			collection: null,
			field: null,
			value: null,
		});
	});
});

describe('unhandled message', () => {
	it('returns the raw error for an unrelated constraint', () => {
		const error = sqliteError('SQLITE_CONSTRAINT: CHECK constraint failed');

		expect(extractError(error, {})).toBe(error);
	});
});
