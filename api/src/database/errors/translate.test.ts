import {
	ContainsNullValuesError,
	DatabasePoolExhaustedError,
	NotNullViolationError,
	RecordNotUniqueError,
} from '@directus/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatabaseClient } from '../index.js';
import emitter from '../../emitter.js';
import { extractDatabaseError, translateDatabaseError } from './translate.js';
import type { SQLError } from './dialects/types.js';

vi.mock('../index.js', () => {
	return {
		default: vi.fn(() => ({})),
		getDatabaseClient: vi.fn(),
	};
});

vi.mock('../../emitter.js', () => {
	return {
		default: { emitFilter: vi.fn(async (_event, payload) => payload) },
	};
});

function asSqlError(error: Partial<SQLError>): SQLError {
	return error as SQLError;
}

const uniqueError = {
	code: '23505',
	table: 'articles',
	detail: 'Key (email)=(x) already exists.',
};

afterEach(() => {
	vi.clearAllMocks();
});

describe('client dispatch', () => {
	it('routes mysql errors through the mysql extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('mysql');

		const result = await translateDatabaseError(
			asSqlError({
				code: 'ER_DUP_ENTRY',
				sqlMessage: `Duplicate entry 'x' for key 'articles_email_unique'`,
			}),
			{ email: 'x' },
		);

		expect(result).toBeInstanceOf(RecordNotUniqueError);
	});

	it('routes postgres errors through the postgres extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');

		const result = await translateDatabaseError(asSqlError(uniqueError), { email: 'x' });

		expect(result).toBeInstanceOf(RecordNotUniqueError);
	});

	it('routes cockroachdb errors through the postgres extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('cockroachdb');

		const result = await translateDatabaseError(asSqlError(uniqueError), { email: 'x' });

		expect(result).toBeInstanceOf(RecordNotUniqueError);
	});

	it('routes sqlite errors through the sqlite extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('sqlite');

		const result = await translateDatabaseError(
			asSqlError({
				message: 'SQLITE_CONSTRAINT: NOT NULL constraint failed: articles.title',
			}),
			{},
		);

		expect(result).toBeInstanceOf(NotNullViolationError);
	});

	it('routes oracle errors through the oracle extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('oracle');

		const result = await translateDatabaseError(
			asSqlError({
				errorNum: 2296,
				message: 'ORA-02296: cannot enable ("ARTICLES"."TITLE") - null values',
			}),
			{},
		);

		expect(result).toBeInstanceOf(ContainsNullValuesError);
	});

	it('routes mssql errors through the mssql extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('mssql');

		const result = await translateDatabaseError(
			asSqlError({
				number: 515,
				message: `Column 'title' does not allow nulls in [articles].`,
			}),
			{},
		);

		expect(result).toBeInstanceOf(NotNullViolationError);
	});

	it('returns the raw error for an unmatched client', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('unknown' as any);
		const raw = asSqlError({ code: 'whatever' });

		const result = await translateDatabaseError(raw, {});

		expect(result).toBe(raw);
	});
});

describe('extractDatabaseError (pure, no hook)', () => {
	it('maps a postgres pool error to DatabasePoolExhaustedError', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');
		const error = asSqlError({ code: '53300', message: 'too many clients' });

		const result = await extractDatabaseError(error, {});

		expect(result).toBeInstanceOf(DatabasePoolExhaustedError);
	});

	it('does not fire the database.error hook', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');

		await extractDatabaseError(asSqlError(uniqueError), { email: 'x' });

		expect(emitter.emitFilter).not.toHaveBeenCalled();
	});

	it('returns the raw error for an unmatched client', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('unknown' as any);
		const raw = asSqlError({ code: 'whatever' });

		expect(await extractDatabaseError(raw, {})).toBe(raw);
	});
});

describe('database.error filter hook', () => {
	it('passes the translated error through emitFilter', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');

		const result = await translateDatabaseError(asSqlError(uniqueError), { email: 'x' });

		expect(emitter.emitFilter).toHaveBeenCalledWith(
			'database.error',
			expect.any(RecordNotUniqueError),
			{ client: 'postgres' },
			expect.any(Object),
		);

		expect(result).toBeInstanceOf(RecordNotUniqueError);
	});

	it('returns whatever the filter hook resolves to', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');
		const overridden = new Error('replaced by a hook');
		vi.mocked(emitter.emitFilter).mockResolvedValueOnce(overridden);

		const result = await translateDatabaseError(asSqlError({ code: '99999' }), {});

		expect(result).toBe(overridden);
	});
});
