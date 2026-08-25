import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';

// Break the schema/types.ts -> database/index.ts -> schema/index.ts -> dialects
// circular import, which otherwise leaves SchemaHelper undefined when a dialect
// is imported directly under vitest.
vi.mock('../../index.js', () => {
	return { default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') };
});

import { SchemaHelperCockroachDb } from './dialects/cockroachdb.js';
import { SchemaHelperDefault } from './dialects/default.js';
import { SchemaHelperPostgres } from './dialects/postgres.js';
import { SchemaHelperSQLite } from './dialects/sqlite.js';

function makeKnex(has: boolean) {
	return {
		raw: vi.fn(async () => ({ rows: [{ has }] })),
	} as unknown as Knex;
}

describe('the Timescale probes', () => {
	it('read the extension out of the catalog on postgres', async () => {
		const knex = makeKnex(true);

		expect(await new SchemaHelperPostgres(knex).hasTimescale()).toBe(true);

		expect(knex.raw).toHaveBeenCalledWith(
			expect.stringContaining(`extname = 'timescaledb'`),
		);
	});

	it('answer false on a postgres the extension never reached', async () => {
		expect(await new SchemaHelperPostgres(makeKnex(false)).hasTimescale())
			.toBe(false);
	});

	it('bind the table name rather than splicing it into the probe', async () => {
		const knex = makeKnex(true);

		expect(await new SchemaHelperPostgres(knex).isHypertable('a_fact'))
			.toBe(true);

		expect(knex.raw).toHaveBeenCalledWith(
			expect.stringContaining('timescaledb_information.hypertables'),
			['a_fact'],
		);
	});

	it.each([
		['default', SchemaHelperDefault],
		['sqlite', SchemaHelperSQLite],
		// Its helper extends the base rather than the postgres one, so it never
		// inherits a probe whose catalog it does not have.
		['cockroachdb', SchemaHelperCockroachDb],
	])('answer false without asking on %s', async (_name, Helper) => {
		const knex = makeKnex(true);
		const helper = new Helper(knex);

		expect(await helper.hasTimescale()).toBe(false);
		expect(await helper.isHypertable('a_fact')).toBe(false);
		expect(knex.raw).not.toHaveBeenCalled();
	});
});
