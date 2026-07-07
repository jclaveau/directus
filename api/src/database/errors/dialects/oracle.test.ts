import { ContainsNullValuesError } from '@directus/errors';
import { describe, expect, it } from 'vitest';
import { extractError } from './oracle.js';
import type { OracleError } from './types.js';

function oracleError(overrides: Partial<OracleError>): OracleError {
	return { message: '', errorNum: 0, offset: 0, ...overrides } as OracleError;
}

describe('contains null values (ORA-02296)', () => {
	it('maps to ContainsNullValuesError with collection and field', () => {
		const error = oracleError({
			errorNum: 2296,
			message: 'ORA-02296: cannot enable ("ARTICLES"."TITLE") - null values found',
		});

		const result = extractError(error);

		expect(result).toBeInstanceOf(ContainsNullValuesError);

		expect((result as any).extensions).toEqual({
			collection: 'ARTICLES',
			field: 'TITLE',
		});
	});

	it('returns the raw error when the message has no quoted identifiers', () => {
		const error = oracleError({
			errorNum: 2296,
			message: 'ORA-02296: cannot enable',
		});

		expect(extractError(error)).toBe(error);
	});
});

describe('unhandled code', () => {
	it('returns the raw error for an unknown Oracle error number', () => {
		const error = oracleError({
			errorNum: 1,
			message: 'ORA-00001: unique constraint',
		});

		expect(extractError(error)).toBe(error);
	});
});
