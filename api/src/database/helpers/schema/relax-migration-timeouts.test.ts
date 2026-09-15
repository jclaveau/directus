import type { Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Break the schema/types.ts -> database/index.ts -> schema/index.ts -> dialects
// circular import, which otherwise leaves SchemaHelper undefined when a dialect
// is imported directly under vitest.
vi.mock('../../index.js', () => {
	return { default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') };
});

// `vi.mock` is hoisted above every const in the file, so the object the factory
// closes over has to be hoisted with it.
const { env } = vi.hoisted(() => {
	return { env: {} as Record<string, unknown> };
});

vi.mock('@directus/env', () => {
	return { useEnv: () => env };
});

import { SchemaHelperCockroachDb } from './dialects/cockroachdb.js';
import { SchemaHelperDefault } from './dialects/default.js';
import { SchemaHelperPostgres } from './dialects/postgres.js';
import { SchemaHelperSQLite } from './dialects/sqlite.js';

function makeTransaction() {
	return { raw: vi.fn(async () => ({ rows: [] })) } as unknown as Knex.Transaction;
}

function settingsIssued(trx: Knex.Transaction) {
	return vi.mocked(trx.raw).mock.calls.map(([, bindings]) => bindings);
}

describe('relaxMigrationTimeouts', () => {
	beforeEach(() => {
		env['MIGRATIONS_STATEMENT_TIMEOUT'] = '0';
		env['MIGRATIONS_LOCK_TIMEOUT'] = '10s';
		env['MIGRATIONS_IDLE_IN_TRANSACTION_SESSION_TIMEOUT'] = '0';
	});

	it('scopes all three to the transaction, binding the value', async () => {
		const trx = makeTransaction();

		await new SchemaHelperPostgres({} as Knex).relaxMigrationTimeouts(trx);

		// `true` is set_config's is_local: released at COMMIT rather than left on
		// the pooled server connection for whoever runs next.
		expect(vi.mocked(trx.raw).mock.calls.every(([sql]) => {
			return String(sql) === 'SELECT set_config(?, ?, true)';
		})).toBe(true);

		expect(settingsIssued(trx)).toEqual([
			['statement_timeout', '0'],
			['lock_timeout', '10s'],
			['idle_in_transaction_session_timeout', '0'],
		]);
	});

	it('leaves a setting to the server when its value is empty', async () => {
		env['MIGRATIONS_LOCK_TIMEOUT'] = '';

		const trx = makeTransaction();

		await new SchemaHelperPostgres({} as Knex).relaxMigrationTimeouts(trx);

		expect(settingsIssued(trx)).toEqual([
			['statement_timeout', '0'],
			['idle_in_transaction_session_timeout', '0'],
		]);
	});

	it('issues nothing at all when every value is empty', async () => {
		env['MIGRATIONS_STATEMENT_TIMEOUT'] = '';
		env['MIGRATIONS_LOCK_TIMEOUT'] = '';
		env['MIGRATIONS_IDLE_IN_TRANSACTION_SESSION_TIMEOUT'] = '';

		const trx = makeTransaction();

		await new SchemaHelperPostgres({} as Knex).relaxMigrationTimeouts(trx);

		expect(trx.raw).not.toHaveBeenCalled();
	});

	it('coerces a value the env layer handed over as a number', async () => {
		env['MIGRATIONS_STATEMENT_TIMEOUT'] = 0;

		const trx = makeTransaction();

		await new SchemaHelperPostgres({} as Knex).relaxMigrationTimeouts(trx);

		// set_config takes text, and 0 is not empty — a number reaching it must be
		// issued rather than skipped as unset.
		expect(settingsIssued(trx)[0]).toEqual(['statement_timeout', '0']);
	});

	it.each([
		['cockroachdb', SchemaHelperCockroachDb],
		['sqlite', SchemaHelperSQLite],
		['the default', SchemaHelperDefault],
	])('says nothing on %s, whose settings these are not', async (_name, Helper) => {
		const trx = makeTransaction();

		await new Helper({} as Knex).relaxMigrationTimeouts(trx);

		expect(trx.raw).not.toHaveBeenCalled();
	});
});
