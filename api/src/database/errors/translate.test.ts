import {
	ContainsNullValuesError,
	DatabasePoolExhaustedError,
	NotNullViolationError,
	RecordNotUniqueError,
} from '@directus/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
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

afterEach(() => {
	vi.clearAllMocks();
});

describe('client dispatch', () => {
	it('routes mysql errors through the mysql extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('mysql');

		const result = await translateDatabaseError(
			{
				code: 'ER_DUP_ENTRY',
				sqlMessage: `Duplicate entry 'x' for key 'articles_email_unique'`,
			} as SQLError,
			{ email: 'x' },
		);

		expect(result).toBeInstanceOf(RecordNotUniqueError);
	});

	it('routes postgres errors through the postgres extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');

		const result = await translateDatabaseError(
			{
				code: '23505',
				table: 'articles',
				detail: 'Key (email)=(x) already exists.',
			} as SQLError,
			{ email: 'x' },
		);

		expect(result).toBeInstanceOf(RecordNotUniqueError);
	});

	it('routes cockroachdb errors through the postgres extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('cockroachdb');

		const result = await translateDatabaseError(
			{
				code: '23505',
				table: 'articles',
				detail: 'Key (email)=(x) already exists.',
			} as SQLError,
			{ email: 'x' },
		);

		expect(result).toBeInstanceOf(RecordNotUniqueError);
	});

	it('routes sqlite errors through the sqlite extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('sqlite');

		const result = await translateDatabaseError(
			{
				message: 'SQLITE_CONSTRAINT: NOT NULL constraint failed: articles.title',
			} as SQLError,
			{},
		);

		expect(result).toBeInstanceOf(NotNullViolationError);
	});

	it('routes oracle errors through the oracle extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('oracle');

		const result = await translateDatabaseError(
			{
				errorNum: 2296,
				message: 'ORA-02296: cannot enable ("ARTICLES"."TITLE") - null values',
			} as SQLError,
			{},
		);

		expect(result).toBeInstanceOf(ContainsNullValuesError);
	});

	it('routes mssql errors through the mssql extractor', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('mssql');

		const result = await translateDatabaseError(
			{
				number: 515,
				message: `Column 'title' does not allow nulls in [articles].`,
			} as SQLError,
			{},
		);

		expect(result).toBeInstanceOf(NotNullViolationError);
	});

	it('returns the raw error for an unmatched client', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('unknown' as any);
		const raw = { code: 'whatever' } as SQLError;

		const result = await translateDatabaseError(raw, {});

		expect(result).toBe(raw);
	});

	it('dispatches on the passed connection, not the default client', async () => {
		// A routed named connection may run a different client than the default
		// pool. getDatabaseClient reflects whichever knex it is given, so the same
		// raw error must be parsed by that connection's dialect.
		const mysqlConnection = { tag: 'mysql' } as unknown as Knex;
		const pgConnection = { tag: 'pg' } as unknown as Knex;

		vi.mocked(getDatabaseClient).mockImplementation((db) => {
			if (db === mysqlConnection) {
				return 'mysql';
			}

			return 'postgres';
		});

		const mysqlError = {
			code: 'ER_DUP_ENTRY',
			sqlMessage: `Duplicate entry 'x' for key 'articles_email_unique'`,
		} as SQLError;

		// Routed to the mysql connection → mysql dialect recognises it.
		expect(
			await extractDatabaseError(mysqlError, { email: 'x' }, mysqlConnection),
		).toBeInstanceOf(RecordNotUniqueError);

		// Same error on a pg connection → the pg dialect doesn't match it → raw.
		expect(
			await extractDatabaseError(mysqlError, { email: 'x' }, pgConnection),
		).toBe(mysqlError);
	});
});

describe('extractDatabaseError (pure, no hook)', () => {
	it('maps a postgres pool error to DatabasePoolExhaustedError', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');
		const error = { code: '53300', message: 'too many clients' } as SQLError;

		const result = await extractDatabaseError(error, {});

		expect(result).toBeInstanceOf(DatabasePoolExhaustedError);
	});

	it('does not fire the database.error hook', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');

		await extractDatabaseError(
			{
				code: '23505',
				table: 'articles',
				detail: 'Key (email)=(x) already exists.',
			} as SQLError,
			{ email: 'x' },
		);

		expect(emitter.emitFilter).not.toHaveBeenCalled();
	});

	it('returns the raw error for an unmatched client', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('unknown' as any);
		const raw = { code: 'whatever' } as SQLError;

		expect(await extractDatabaseError(raw, {})).toBe(raw);
	});
});

describe('database.error filter hook', () => {
	it('passes the translated error through emitFilter', async () => {
		vi.mocked(getDatabaseClient).mockReturnValue('postgres');

		const result = await translateDatabaseError(
			{
				code: '23505',
				table: 'articles',
				detail: 'Key (email)=(x) already exists.',
			} as SQLError,
			{ email: 'x' },
		);

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

		const result = await translateDatabaseError({ code: '99999' } as SQLError, {});

		expect(result).toBe(overridden);
	});
});
