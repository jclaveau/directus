import {
	ContainsNullValuesError,
	InvalidForeignKeyError,
	NotNullViolationError,
	RecordNotUniqueError,
	ValueOutOfRangeError,
	ValueTooLongError,
} from '@directus/errors';
import { describe, expect, it, vi } from 'vitest';
import { extractError } from './mssql.js';
import type { MSSQLError } from './types.js';

// The unique-violation path reads the offending column back from information_schema,
// so getDatabase() is stubbed with a chainable that resolves to `constraintRow`.
const state = vi.hoisted(() => ({ constraintRow: undefined as unknown }));

vi.mock('../../index.js', () => {
	const join: any = { on: () => join, andOn: () => join };

	const builder: any = {
		select: () => builder,
		from: () => builder,
		innerJoin: (_table: string, callback: (join: any) => void) => {
			callback(join);
			return builder;
		},
		where: () => builder,
		first: () => Promise.resolve(state.constraintRow),
	};

	const database: any = {
		select: () => builder,
		raw: () => 'raw',
	};

	return { default: () => database };
});

function mssqlError(overrides: Partial<MSSQLError>): MSSQLError {
	return {
		message: '',
		code: 'EREQUEST',
		number: 0,
		state: 0,
		class: 0,
		serverName: '',
		procName: '',
		lineNumber: 0,
		...overrides,
	} as MSSQLError;
}

const uniqueMessage = `UNIQUE constraint 'UQ' object 'dbo.articles' value (a@b.c)`;

describe('unique violation (2601 / 2627)', () => {
	it('resolves the field from information_schema', async () => {
		state.constraintRow = { collection: 'articles', field: 'email' };

		const error = mssqlError({ number: 2601, message: uniqueMessage });

		const result = await extractError(error, { email: 'a@b.c' });

		expect(result).toBeInstanceOf(RecordNotUniqueError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'email',
			value: 'a@b.c',
		});
	});

	it('also handles error number 2627', async () => {
		state.constraintRow = { collection: 'articles', field: 'email' };

		const error = mssqlError({ number: 2627, message: uniqueMessage });

		expect(await extractError(error, {})).toBeInstanceOf(RecordNotUniqueError);
	});

	it('leaves collection and field empty when the lookup finds nothing', async () => {
		state.constraintRow = undefined;

		const error = mssqlError({ number: 2601, message: uniqueMessage });

		const result = await extractError(error, {});

		expect((result as any).extensions).toEqual({
			collection: undefined,
			field: undefined,
			value: null,
		});
	});

	it('returns the raw error when the message has no quotes or parens', async () => {
		const error = mssqlError({ number: 2601, message: 'no quotes or parens' });

		expect(await extractError(error, {})).toBe(error);
	});
});

describe('numeric value out of range (220)', () => {
	it('maps to ValueOutOfRangeError with a null field', async () => {
		const error = mssqlError({
			number: 220,
			message: 'insert into [articles] ([amount]) - Arithmetic overflow',
		});

		const result = await extractError(error, { amount: 999 });

		expect(result).toBeInstanceOf(ValueOutOfRangeError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: null,
			value: null,
		});
	});

	it('returns the raw error when the message has no bracketed table', async () => {
		const error = mssqlError({ number: 220, message: 'Arithmetic overflow' });

		expect(await extractError(error, {})).toBe(error);
	});
});

describe('value too long (2628)', () => {
	it('maps to ValueTooLongError with collection and field', async () => {
		const error = mssqlError({
			number: 2628,
			message: `truncated 'dbo.articles' column 'title' in [articles]`,
		});

		const result = await extractError(error, { title: 'x' });

		expect(result).toBeInstanceOf(ValueTooLongError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
			value: 'x',
		});
	});

	it('returns the raw error when the message has no bracketed table', async () => {
		const error = mssqlError({ number: 2628, message: `column 'title'` });

		expect(await extractError(error, {})).toBe(error);
	});
});

describe('not null violation (515)', () => {
	it('maps to NotNullViolationError for a plain not-null failure', async () => {
		const error = mssqlError({
			number: 515,
			message: `Column 'title' does not allow nulls in [articles].`,
		});

		const result = await extractError(error, {});

		expect(result).toBeInstanceOf(NotNullViolationError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
		});
	});

	it('maps to ContainsNullValuesError when inserting NULL into a column', async () => {
		const error = mssqlError({
			number: 515,
			message: `Cannot insert the value NULL into column 'title', table [articles].`,
		});

		const result = await extractError(error, {});

		expect(result).toBeInstanceOf(ContainsNullValuesError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'title',
		});
	});

	it('returns the raw error when the message has no bracketed table', async () => {
		const error = mssqlError({
			number: 515,
			message: `Column 'title' does not allow nulls.`,
		});

		expect(await extractError(error, {})).toBe(error);
	});
});

describe('foreign key violation (547)', () => {
	it('maps to InvalidForeignKeyError from the constraint name', async () => {
		const error = mssqlError({
			number: 547,
			message: `FK __articles__author__ value is (42)`,
		});

		const result = await extractError(error, { author: 42 });

		expect(result).toBeInstanceOf(InvalidForeignKeyError);

		expect((result as any).extensions).toEqual({
			collection: 'articles',
			field: 'author',
			value: 42,
		});
	});

	it('returns the raw error when the message has no constraint name', async () => {
		const error = mssqlError({ number: 547, message: 'FK conflict (42)' });

		expect(await extractError(error, {})).toBe(error);
	});
});

describe('unhandled code', () => {
	it('returns the raw error for an unknown SQL Server number', async () => {
		const error = mssqlError({ number: 99999, message: 'something else' });

		expect(await extractError(error, {})).toBe(error);
	});
});
