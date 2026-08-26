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

function makeKnex(has: boolean, rows: Record<string, unknown>[] = []) {
	return {
		raw: vi.fn(async (sql: string) => {
			// The size query joins the hypertable catalog too, so the queries that
			// carry an answer are matched first and the probes take the rest.
			if (sql.includes('unnest') || sql.includes('.chunks')) {
				return { rows };
			}

			return { rows: [{ has }] };
		}),
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

describe('measuring tables', () => {
	it('sums chunked by hypertable_size and the rest by relation', async () => {
		const knex = makeKnex(true, [{ bytes: '4398' }]);
		const helper = new SchemaHelperPostgres(knex);

		expect(await helper.getTablesSize(['a_fact', 'a_dimension'])).toBe(4398);

		const [sql, bindings] = vi.mocked(knex.raw).mock.calls.find(
			([statement]) => String(statement).includes('unnest'),
		)!;

		// A chunked table keeps its rows in chunks the parent knows nothing about,
		// so only hypertable_size() sees them; a plain table needs the other.
		expect(sql).toContain('hypertable_size');
		expect(sql).toContain('pg_total_relation_size');
		expect(bindings).toEqual([['a_fact', 'a_dimension']]);
	});

	it('asks for relation size alone where the extension is absent', async () => {
		const knex = makeKnex(false, [{ bytes: '10' }]);
		const helper = new SchemaHelperPostgres(knex);

		expect(await helper.getTablesSize(['a_table'])).toBe(10);

		const [sql] = vi.mocked(knex.raw).mock.calls.find(
			([statement]) => String(statement).includes('unnest'),
		)!;

		expect(sql).not.toContain('hypertable_size');
	});

	it('answers null when the measurement throws', async () => {
		// Not zero: a caller sizing tables against a budget must be able to tell
		// "nothing there" from "cannot see".
		expect(await new SchemaHelperPostgres({
			raw: vi.fn(async () => {
				throw new Error('boom');
			}),
		} as unknown as Knex).getTablesSize(['a_table'])).toBeNull();
	});

	it('answers null on a dialect with no cheap measure', async () => {
		const helper = new SchemaHelperSQLite(makeKnex(false));

		expect(await helper.getTablesSize(['a_table'])).toBeNull();
		expect(await helper.dropOldestChunk(['a_table'], new Date())).toBeNull();
	});
});

describe('dropping the oldest chunk', () => {
	const FLOOR = new Date('2026-08-20T00:00:00Z');
	const UP_TO = '2026-08-19T00:00:00Z';

	it('drops it and says which table it came from', async () => {
		const knex = makeKnex(true, [
			{ hypertable_name: 'a_fact', range_end: UP_TO },
		]);

		const helper = new SchemaHelperPostgres(knex);

		expect(await helper.dropOldestChunk(['a_fact', 'another'], FLOOR))
			.toEqual({ table: 'a_fact', upTo: new Date(UP_TO) });

		expect(knex.raw).toHaveBeenCalledWith(
			expect.stringContaining('drop_chunks'),
			['a_fact', UP_TO],
		);

		// Bounded by the floor, so a caller cannot cut newer than it asked for.
		const [, bindings] = vi.mocked(knex.raw).mock.calls.find(
			([statement]) => String(statement).includes('timescaledb_information.chunks'),
		)!;

		expect(bindings).toEqual([['a_fact', 'another'], FLOOR]);
	});

	it('answers null when nothing is old enough', async () => {
		const knex = makeKnex(true, []);
		const helper = new SchemaHelperPostgres(knex);

		expect(await helper.dropOldestChunk(['a_fact'], FLOOR)).toBeNull();

		expect(knex.raw).not.toHaveBeenCalledWith(
			expect.stringContaining('drop_chunks'),
			expect.anything(),
		);
	});

	it('answers null without asking where there are no chunks at all', async () => {
		const knex = makeKnex(false, []);
		const helper = new SchemaHelperPostgres(knex);

		expect(await helper.dropOldestChunk(['a_fact'], FLOOR)).toBeNull();

		expect(knex.raw).not.toHaveBeenCalledWith(
			expect.stringContaining('timescaledb_information.chunks'),
			expect.anything(),
		);
	});
});
