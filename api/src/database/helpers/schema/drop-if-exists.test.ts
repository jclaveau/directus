import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';

// Break the schema/types.ts -> database/index.ts -> schema/index.ts -> dialects circular import,
// which otherwise leaves SchemaHelper undefined when a dialect is imported directly under vitest.
vi.mock('../../index.js', () => ({ default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') }));

import { SchemaHelperDefault } from './dialects/default.js';
import { SchemaHelperMSSQL } from './dialects/mssql.js';
import { SchemaHelperMySQL } from './dialects/mysql.js';
import { SchemaHelperOracle } from './dialects/oracle.js';
import { SchemaHelperPostgres } from './dialects/postgres.js';
import { SchemaHelperSQLite } from './dialects/sqlite.js';

const COLLECTION = 'articles';
const FIELD = 'slug';

// A minimal knex stand-in: `raw` and `schema.alterTable` capture the emitted DDL, and the
// query-builder chain (`select(...).from(...).where(...).first()`) returns `firstResult` so the
// catalog-check dialects (mysql/oracle) can be steered through both branches.
function makeKnex(firstResult: unknown = undefined) {
	const table = { dropUnique: vi.fn(), dropIndex: vi.fn() };

	const qb = {
		from: vi.fn().mockReturnThis(),
		whereRaw: vi.fn().mockReturnThis(),
		andWhere: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		first: vi.fn().mockResolvedValue(firstResult),
	};

	const knex = {
		raw: vi.fn().mockResolvedValue(undefined),
		select: vi.fn(() => qb),
		schema: {
			alterTable: vi.fn(async (_collection: string, cb: (t: typeof table) => void) => {
				cb(table);
			}),
		},
	};

	return { knex: knex as unknown as Knex, raw: knex.raw, alterTable: knex.schema.alterTable, table, first: qb.first };
}

describe('dropUniqueIfExists / dropIndexIfExists', () => {
	describe('postgres (base SchemaHelper)', () => {
		it('drops a unique via ALTER TABLE ... DROP CONSTRAINT IF EXISTS', async () => {
			const { knex, raw } = makeKnex();
			const helper = new SchemaHelperPostgres(knex);
			const name = helper.generateIndexName('unique', COLLECTION, FIELD);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(raw).toHaveBeenCalledWith('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [COLLECTION, name]);
		});

		it('drops an index via DROP INDEX IF EXISTS', async () => {
			const { knex, raw } = makeKnex();
			const helper = new SchemaHelperPostgres(knex);
			const name = helper.generateIndexName('index', COLLECTION, FIELD);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(raw).toHaveBeenCalledWith('DROP INDEX IF EXISTS ??', [name]);
		});
	});

	describe('redshift (SchemaHelperDefault)', () => {
		it('falls back to plain knex dropUnique (no IF EXISTS syntax)', async () => {
			const { knex, raw, alterTable, table } = makeKnex();
			const helper = new SchemaHelperDefault(knex);
			const name = helper.generateIndexName('unique', COLLECTION, FIELD);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(alterTable).toHaveBeenCalledWith(COLLECTION, expect.any(Function));
			expect(table.dropUnique).toHaveBeenCalledWith([FIELD], name);
			expect(raw).not.toHaveBeenCalled();
		});

		it('falls back to plain knex dropIndex', async () => {
			const { knex, table } = makeKnex();
			const helper = new SchemaHelperDefault(knex);
			const name = helper.generateIndexName('index', COLLECTION, FIELD);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(table.dropIndex).toHaveBeenCalledWith([FIELD], name);
		});
	});

	describe('mssql', () => {
		it('inherits the base DROP CONSTRAINT IF EXISTS for uniques', async () => {
			const { knex, raw } = makeKnex();
			const helper = new SchemaHelperMSSQL(knex);
			const name = helper.generateIndexName('unique', COLLECTION, FIELD);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(raw).toHaveBeenCalledWith('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [COLLECTION, name]);
		});

		it('drops an index with the required ON <table> clause', async () => {
			const { knex, raw } = makeKnex();
			const helper = new SchemaHelperMSSQL(knex);
			const name = helper.generateIndexName('index', COLLECTION, FIELD);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(raw).toHaveBeenCalledWith('DROP INDEX IF EXISTS ?? ON ??', [name, COLLECTION]);
		});
	});

	describe('sqlite', () => {
		it('drops the backing index for a unique (no DROP CONSTRAINT)', async () => {
			const { knex, raw } = makeKnex();
			const helper = new SchemaHelperSQLite(knex);
			const name = helper.generateIndexName('unique', COLLECTION, FIELD);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(raw).toHaveBeenCalledWith('DROP INDEX IF EXISTS ??', [name]);
		});

		it('inherits the base DROP INDEX IF EXISTS', async () => {
			const { knex, raw } = makeKnex();
			const helper = new SchemaHelperSQLite(knex);
			const name = helper.generateIndexName('index', COLLECTION, FIELD);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(raw).toHaveBeenCalledWith('DROP INDEX IF EXISTS ??', [name]);
		});
	});

	describe.each([
		['mysql', SchemaHelperMySQL],
		['oracle', SchemaHelperOracle],
	])('%s (catalog existence check)', (_name, Helper) => {
		it('drops the unique only when the catalog reports it exists', async () => {
			const { knex, table } = makeKnex({ index_name: 'present' });
			const helper = new Helper(knex);
			const name = helper.generateIndexName('unique', COLLECTION, FIELD);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(table.dropUnique).toHaveBeenCalledWith([FIELD], name);
		});

		it('is a no-op when the catalog reports the unique is absent', async () => {
			const { knex, table, alterTable } = makeKnex(undefined);
			const helper = new Helper(knex);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(alterTable).not.toHaveBeenCalled();
			expect(table.dropUnique).not.toHaveBeenCalled();
		});

		it('drops the index only when the catalog reports it exists', async () => {
			const { knex, table } = makeKnex({ index_name: 'present' });
			const helper = new Helper(knex);
			const name = helper.generateIndexName('index', COLLECTION, FIELD);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(table.dropIndex).toHaveBeenCalledWith([FIELD], name);
		});

		it('is a no-op when the catalog reports the index is absent', async () => {
			const { knex, table, alterTable } = makeKnex(undefined);
			const helper = new Helper(knex);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(alterTable).not.toHaveBeenCalled();
			expect(table.dropIndex).not.toHaveBeenCalled();
		});
	});
});
