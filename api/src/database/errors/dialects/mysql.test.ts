import {
	ContainsNullValuesError,
	InvalidForeignKeyError,
	NotNullViolationError,
	RecordNotUniqueError,
	ValueOutOfRangeError,
	ValueTooLongError,
} from '@directus/errors';
import { describe, expect, it } from 'vitest';
import { extractError } from './mysql.js';
import type { MySQLError } from './types.js';

function mysqlError(overrides: Partial<MySQLError>): MySQLError {
	return {
		message: '',
		code: '',
		errno: 0,
		sqlMessage: '',
		sqlState: '',
		index: 0,
		sql: '',
		...overrides,
	} as MySQLError;
}

describe('unique violation (ER_DUP_ENTRY)', () => {
	it('maps a MySQL 8+ index name to collection and field', () => {
		const error = mysqlError({
			code: 'ER_DUP_ENTRY',
			sqlMessage: `Duplicate entry 'a@b.c' for key 'articles.articles_email_unique'`,
		});

		const result = extractError(error, { email: 'a@b.c' });

		expect(result).toBeInstanceOf(RecordNotUniqueError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'email',
			value: 'a@b.c',
			primaryKey: false,
		});
	});

	it('maps a MySQL 5.7 / MariaDB index name to collection and field', () => {
		const error = mysqlError({
			code: 'ER_DUP_ENTRY',
			sqlMessage: `Duplicate entry 'a@b.c' for key 'articles_email_unique'`,
		});

		const result = extractError(error, { email: 'a@b.c' });

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'email',
			value: 'a@b.c',
			primaryKey: false,
		});
	});

	it('flags a MySQL 8+ primary key violation', () => {
		const error = mysqlError({
			code: 'ER_DUP_ENTRY',
			sqlMessage: `Duplicate entry '1' for key 'articles.PRIMARY'`,
		});

		expect((extractError(error, {}) as any).extensions).toEqual({
			collection: 'articles',
			field: null,
			value: null,
			primaryKey: true,
		});
	});

	it('flags a MySQL 5.7 primary key violation with an unknown collection', () => {
		const error = mysqlError({
			code: 'ER_DUP_ENTRY',
			sqlMessage: `Duplicate entry '1' for key 'PRIMARY'`,
		});

		expect((extractError(error, {}) as any).extensions).toEqual({
			collection: null,
			field: null,
			value: null,
			primaryKey: true,
		});
	});

	it('returns the raw error when nothing is quoted', () => {
		const error = mysqlError({ code: 'ER_DUP_ENTRY', sqlMessage: 'no quotes here' });

		expect(extractError(error, {})).toBe(error);
	});
});

describe('numeric value out of range (ER_WARN_DATA_OUT_OF_RANGE)', () => {
	it('maps to ValueOutOfRangeError with collection and field', () => {
		const error = mysqlError({
			code: 'ER_WARN_DATA_OUT_OF_RANGE',
			sql: 'insert into `articles` (`amount`) values (?)',
			sqlMessage: `Out of range value for column 'amount' at row 1`,
		});

		const result = extractError(error, { amount: 999 });

		expect(result).toBeInstanceOf(ValueOutOfRangeError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'amount',
			value: 999,
		});
	});

	it('returns the raw error when the SQL has no back-ticked identifier', () => {
		const error = mysqlError({
			code: 'ER_WARN_DATA_OUT_OF_RANGE',
			sql: 'no ticks',
			sqlMessage: `Out of range value for column 'amount' at row 1`,
		});

		expect(extractError(error, {})).toBe(error);
	});
});

describe('value too long (ER_DATA_TOO_LONG)', () => {
	it('maps to ValueTooLongError with collection and field', () => {
		const error = mysqlError({
			code: 'ER_DATA_TOO_LONG',
			sql: 'insert into `articles` (`title`) values (?)',
			sqlMessage: `Data too long for column 'title' at row 1`,
		});

		const result = extractError(error, { title: 'x' });

		expect(result).toBeInstanceOf(ValueTooLongError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
			value: 'x',
		});
	});

	it('returns the raw error when the SQL message has no quoted identifier', () => {
		const error = mysqlError({
			code: 'ER_DATA_TOO_LONG',
			sql: 'insert into `articles` (`title`) values (?)',
			sqlMessage: 'no quotes',
		});

		expect(extractError(error, {})).toBe(error);
	});
});

describe('not null violation (ER_BAD_NULL_ERROR)', () => {
	it('maps to NotNullViolationError with collection and field', () => {
		const error = mysqlError({
			code: 'ER_BAD_NULL_ERROR',
			sql: 'insert into `articles` (`title`) values (?)',
			sqlMessage: `Column 'title' cannot be null`,
		});

		const result = extractError(error, {});

		expect(result).toBeInstanceOf(NotNullViolationError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
		});
	});

	it('returns the raw error when the SQL has no back-ticked identifier', () => {
		const error = mysqlError({
			code: 'ER_BAD_NULL_ERROR',
			sql: 'no ticks',
			sqlMessage: `Column 'title' cannot be null`,
		});

		expect(extractError(error, {})).toBe(error);
	});
});

describe('foreign key violation', () => {
	it('maps an invalid reference, naming the parent + constraint', () => {
		const error = mysqlError({
			code: 'ER_NO_REFERENCED_ROW_2',
			sqlMessage:
				'a foreign key constraint fails (`db`.`articles`, ' +
				'CONSTRAINT `fk` FOREIGN KEY (`author`) REFERENCES `authors` (`id`))',
			sql: 'insert into `articles` (`author`) values (?)',
		});

		const result = extractError(error, { author: 42 });

		expect(result).toBeInstanceOf(InvalidForeignKeyError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'author',
			value: 42,
			constraint: 'fk',
			relatedCollection: 'authors',
			reason: 'invalid_reference',
		});
	});

	it('maps a still-referenced delete to the operated parent', () => {
		const error = mysqlError({
			code: 'ER_ROW_IS_REFERENCED_2',
			sqlMessage:
				'Cannot delete or update a parent row: a foreign key constraint ' +
				'fails (`db`.`student_enrollment`, CONSTRAINT `fk` FOREIGN KEY ' +
				'(`enrollment`) REFERENCES `enrollment` (`id`))',
			sql: 'delete from `enrollment` where `id` = ?',
		});

		const result = extractError(error, {}, 'enrollment');

		expect(result).toBeInstanceOf(InvalidForeignKeyError);

		expect((result as any).extensions).toEqual({
			collection: 'enrollment',
			field: 'enrollment',
			value: null,
			constraint: 'fk',
			relatedCollection: 'student_enrollment',
			reason: 'still_referenced',
		});
	});

	it('returns the raw error when the message has no back-ticked identifier', () => {
		const error = mysqlError({
			code: 'ER_NO_REFERENCED_ROW_2',
			sqlMessage: 'no ticks',
			sql: 'insert into `articles` (`author`) values (?)',
		});

		expect(extractError(error, {})).toBe(error);
	});
});

describe('contains null values', () => {
	it('maps ER_INVALID_USE_OF_NULL to ContainsNullValuesError', () => {
		const error = mysqlError({
			code: 'ER_INVALID_USE_OF_NULL',
			sql: 'alter table `articles` modify `title` varchar(255) not null',
		});

		const result = extractError(error, {});

		expect(result).toBeInstanceOf(ContainsNullValuesError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
		});
	});

	it('maps the MariaDB WARN_DATA_TRUNCATED variant to ContainsNullValues', () => {
		const error = mysqlError({
			code: 'WARN_DATA_TRUNCATED',
			sql: 'alter table `articles` modify `title` varchar(255) not null',
		});

		expect(extractError(error, {})).toBeInstanceOf(ContainsNullValuesError);
	});

	it('returns the raw error when the SQL has no back-ticked identifier', () => {
		const error = mysqlError({ code: 'ER_INVALID_USE_OF_NULL', sql: 'no ticks' });

		expect(extractError(error, {})).toBe(error);
	});
});

describe('unhandled code', () => {
	it('returns the raw error for an unknown MySQL code', () => {
		const error = mysqlError({ code: 'ER_SOMETHING_ELSE' });

		expect(extractError(error, {})).toBe(error);
	});
});
