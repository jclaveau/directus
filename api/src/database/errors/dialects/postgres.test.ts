import {
	ContainsNullValuesError,
	DatabasePoolExhaustedError,
	InvalidForeignKeyError,
	NotNullViolationError,
	RecordNotUniqueError,
	ValueOutOfRangeError,
	ValueTooLongError,
} from '@directus/errors';
import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import { extractError, getPoolExhaustedError } from './postgres.js';
import type { PostgresError } from './types.js';

function pgError(
	overrides: { [K in keyof PostgresError]?: PostgresError[K] | undefined },
): PostgresError {
	return {
		message: '',
		length: 0,
		code: '',
		detail: '',
		schema: 'public',
		table: 'articles',
		...overrides,
	} as PostgresError;
}

describe('unique violation (23505)', () => {
	it('maps to RecordNotUniqueError with the field pulled from detail', () => {
		const error = pgError({
			code: '23505',
			table: 'articles',
			detail: 'Key (email)=(a@b.c) already exists.',
		});

		const result = extractError(error, { email: 'a@b.c' });

		expect(result).toBeInstanceOf(RecordNotUniqueError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'email',
			value: 'a@b.c',
		});
	});

	it('returns the raw error when detail has no parenthesised group', () => {
		const error = pgError({ code: '23505', detail: 'no parens here' });

		expect(extractError(error, {})).toBe(error);
	});

	it(oneLine`
		stays a RecordNotUniqueError when the stored value contains a pool phrase,
		not a false DatabasePoolExhaustedError
	`, () => {
		const error = pgError({
			code: '23505',
			table: 'articles',
			detail: 'Key (note)=(pool is probably full) already exists.',
			message:
				'duplicate key value violates unique constraint — '
				+ 'Key (note)=(pool is probably full) already exists.',
		});

		const result = extractError(error, { note: 'pool is probably full' });

		expect(result).toBeInstanceOf(RecordNotUniqueError);
		expect(result).not.toBeInstanceOf(DatabasePoolExhaustedError);
	});
});

describe('numeric value out of range (22003)', () => {
	it('maps to ValueOutOfRangeError with collection and field', () => {
		const error = pgError({
			code: '22003',
			message: 'out of range for "articles" "amount"',
		});

		const result = extractError(error, { amount: 999 });

		expect(result).toBeInstanceOf(ValueOutOfRangeError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'amount',
			value: 999,
		});
	});

	it('leaves field and value null when only the collection is quoted', () => {
		const error = pgError({ code: '22003', message: 'range on "articles"' });

		const result = extractError(error, { amount: 999 });

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: null,
			value: null,
		});
	});

	it('returns the raw error when nothing is quoted', () => {
		const error = pgError({ code: '22003', message: 'no quotes here' });

		expect(extractError(error, {})).toBe(error);
	});
});

describe('value limit violation (22001)', () => {
	it('maps to ValueTooLongError with collection and field', () => {
		const error = pgError({
			code: '22001',
			message: 'too long for "articles" "title"',
		});

		const result = extractError(error, { title: 'x'.repeat(300) });

		expect(result).toBeInstanceOf(ValueTooLongError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
			value: 'x'.repeat(300),
		});
	});

	it('returns the raw error when nothing is quoted', () => {
		const error = pgError({ code: '22001', message: 'no quotes here' });

		expect(extractError(error, {})).toBe(error);
	});
});

describe('not null violation (23502)', () => {
	it('maps to NotNullViolationError for a plain not-null failure', () => {
		const error = pgError({
			code: '23502',
			table: 'articles',
			column: 'title',
			message: 'null value in column "title" violates not-null constraint',
		});

		const result = extractError(error, {});

		expect(result).toBeInstanceOf(NotNullViolationError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
		});
	});

	it('maps to ContainsNullValuesError when the alter reports existing nulls', () => {
		const error = pgError({
			code: '23502',
			table: 'articles',
			column: 'title',
			message: 'column "title" of relation "articles" contains null values',
		});

		const result = extractError(error, {});

		expect(result).toBeInstanceOf(ContainsNullValuesError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
		});
	});

	it('returns the raw error when no column is reported', () => {
		const error = pgError({ code: '23502', message: 'not null', column: undefined });

		expect(extractError(error, {})).toBe(error);
	});
});

describe('foreign key violation (23503)', () => {
	it('maps an invalid reference, naming the referenced parent + constraint', () => {
		const error = pgError({
			code: '23503',
			table: 'articles',
			constraint: 'articles_author_authors_foreign',
			detail: 'Key (author)=(42) is not present in table "authors".',
		});

		const result = extractError(error, { author: 42 });

		expect(result).toBeInstanceOf(InvalidForeignKeyError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'author',
			value: 42,
			constraint: 'articles_author_authors_foreign',
			relatedCollection: 'authors',
			reason: 'invalid_reference',
			operation: null,
		});
	});

	it(oneLine`
		maps a still-referenced delete to the operated-on parent, naming the
		referring child and the still_referenced reason
	`, () => {
		const error = pgError({
			code: '23503',
			// pg reports the child (referrer) as error.table on a delete-restrict.
			table: 'student_enrollment',
			constraint: 'student_enrollment_enrollment_foreign',
			detail: 'Key (id)=(5) is still referenced from table "student_enrollment".',
		});

		// The delete ran on the parent `enrollment`; threaded from the call site.
		const result = extractError(error, {}, {
			collection: 'enrollment',
			operation: 'delete',
		});

		expect(result).toBeInstanceOf(InvalidForeignKeyError);

		expect((result as any).extensions).toEqual({
			collection: 'enrollment',
			field: 'id',
			value: '5',
			constraint: 'student_enrollment_enrollment_foreign',
			relatedCollection: 'student_enrollment',
			reason: 'still_referenced',
			operation: 'delete',
		});
	});

	it('resolves the direction from the operation, not the localized detail', () => {
		// A create whose detail text (misleadingly) says "still referenced" must
		// still resolve to invalid_reference — the operation is authoritative and
		// locale-independent, unlike pg's lc_messages-localized detail.
		const error = pgError({
			code: '23503',
			table: 'articles',
			detail: 'Key (author)=(42) is still referenced from table "authors".',
		});

		const result = extractError(error, { author: 42 }, {
			collection: 'articles',
			operation: 'create',
		});

		expect((result as any).extensions.reason).toBe('invalid_reference');
	});

	it('classifies a delete as still_referenced on a non-English detail', () => {
		const error = pgError({
			code: '23503',
			table: 'student_enrollment',
			// French lc_messages; only the (id)=(5) parens are locale-stable.
			detail: 'La clé (id)=(5) est encore référencée depuis « student_enrollment ».',
		});

		const result = extractError(error, {}, {
			collection: 'enrollment',
			operation: 'delete',
		});

		expect((result as any).extensions.reason).toBe('still_referenced');
		expect((result as any).extensions.collection).toBe('enrollment');
		expect((result as any).extensions.relatedCollection).toBe('student_enrollment');
	});

	it('names only the referring child on the read path (no context)', () => {
		// No operated collection → the still-referenced parent is unknowable, so
		// collection stays null (never the child) and only the referrer is named.
		const error = pgError({
			code: '23503',
			table: 'student_enrollment',
			detail: 'Key (id)=(5) is still referenced from table "student_enrollment".',
		});

		const result = extractError(error, {});
		const ext = (result as any).extensions;

		expect(ext.reason).toBe('still_referenced');
		expect(ext.collection).toBeNull();
		expect(ext.relatedCollection).toBe('student_enrollment');
	});

	it('falls back to the driver table without an operated collection', () => {
		const error = pgError({
			code: '23503',
			table: 'articles',
			detail: 'Key (author)=(42) is not present in table "authors".',
		});

		const result = extractError(error, { author: 42 });

		expect((result as any).extensions.collection).toBe('articles');
		expect((result as any).extensions.constraint).toBeNull();
	});

	it('returns the raw error when detail has no parenthesised group', () => {
		const error = pgError({ code: '23503', detail: 'no parens here' });

		expect(extractError(error, {})).toBe(error);
	});
});

describe('unhandled code', () => {
	it('returns the raw error for an unknown SQLSTATE', () => {
		const error = pgError({ code: '99999', message: 'something else' });

		expect(extractError(error, {})).toBe(error);
	});
});

describe('pool exhaustion (folded into extractError)', () => {
	it('maps SQLSTATE 53300 to DatabasePoolExhaustedError', () => {
		const error = pgError({ code: '53300', message: 'too many clients' });

		expect(extractError(error, {})).toBeInstanceOf(DatabasePoolExhaustedError);
	});

	it(oneLine`
		maps a tarn acquire timeout (no SQLSTATE) to DatabasePoolExhaustedError
	`, () => {
		const error = pgError({ message: 'Timeout acquiring a connection' });

		expect(extractError(error, {})).toBeInstanceOf(DatabasePoolExhaustedError);
	});
});

describe('getPoolExhaustedError', () => {
	it('classifies pg 53300 -> too_many_connections', () => {
		const result = getPoolExhaustedError(pgError({ code: '53300' }));

		expect(result?.extensions.reason).toBe('too_many_connections');
	});

	it('classifies a tarn acquire timeout -> client_pool_timeout', () => {
		const error = pgError({ message: 'Timeout acquiring a connection' });
		const result = getPoolExhaustedError(error);

		expect(result?.extensions.reason).toBe('client_pool_timeout');
	});

	it('classifies pgbouncer query_wait_timeout -> pool_queue_timeout', () => {
		const result = getPoolExhaustedError(pgError({ message: 'query_wait_timeout' }));

		expect(result?.extensions.reason).toBe('pool_queue_timeout');
	});

	it('classifies pgbouncer max_client_conn -> max_client_connections', () => {
		const error = pgError({ message: 'no more connections allowed' });
		const result = getPoolExhaustedError(error);

		expect(result?.extensions.reason).toBe('max_client_connections');
	});

	it('returns null for a non-pool error or non-object', () => {
		expect(getPoolExhaustedError(pgError({ code: '23505' }))).toBeNull();
		expect(getPoolExhaustedError(null)).toBeNull();
	});
});
