import knexFactory, { type Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';

// Break the schema/types.ts -> database/index.ts -> schema/index.ts -> dialects circular import,
// which otherwise leaves SchemaHelper undefined when a dialect is imported directly under vitest.
vi.mock('../../index.js', () => ({ default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') }));

import { SchemaHelperCockroachDb } from './dialects/cockroachdb.js';
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

// A knex stand-in whose `schema.alterTable` compiles through a real,
// unconnected knex of `client` and records the DDL it would run.
function makeCompilingKnex(client: string) {
	const compiler = knexFactory({ client, useNullAsDefault: true });
	const emitted: string[] = [];

	const knex = {
		schema: {
			alterTable: async (
				collection: string,
				cb: (t: Knex.AlterTableBuilder) => void,
			) => {
				const compiled = compiler.schema.alterTable(collection, cb);

				emitted.push(compiled.toString());
			},
		},
	};

	return { knex: knex as unknown as Knex, emitted };
}

describe('dropUniqueIfExists / dropIndexIfExists', () => {
	describe('postgres (base SchemaHelper)', () => {
		it('drops a unique via ALTER TABLE ... DROP CONSTRAINT IF EXISTS', async () => {
			const { knex, emitted } = makeCompilingKnex('pg');

			const helper = new SchemaHelperPostgres(knex);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'alter table "articles" drop constraint if exists "articles_slug_unique"',
			]);
		});

		it('drops an index via DROP INDEX IF EXISTS', async () => {
			const { knex, emitted } = makeCompilingKnex('pg');

			const helper = new SchemaHelperPostgres(knex);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'drop index if exists "articles_slug_index"',
			]);
		});
	});

	describe('cockroachdb', () => {
		it('drops a unique via DROP INDEX IF EXISTS ... CASCADE', async () => {
			const { knex, emitted } = makeCompilingKnex('cockroachdb');

			const helper = new SchemaHelperCockroachDb(knex);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'drop index if exists "articles"@"articles_slug_unique" cascade',
			]);
		});

		it('drops an index via DROP INDEX IF EXISTS', async () => {
			const { knex, emitted } = makeCompilingKnex('cockroachdb');

			const helper = new SchemaHelperCockroachDb(knex);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'drop index if exists "articles_slug_index"',
			]);
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
		it('drops the unique index with the required ON <table> clause', async () => {
			const { knex, emitted } = makeCompilingKnex('mssql');

			const helper = new SchemaHelperMSSQL(knex);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'DROP INDEX IF EXISTS [articles_slug_unique] ON [articles]',
			]);
		});

		it('drops an index with the required ON <table> clause', async () => {
			const { knex, emitted } = makeCompilingKnex('mssql');

			const helper = new SchemaHelperMSSQL(knex);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'DROP INDEX IF EXISTS [articles_slug_index] ON [articles]',
			]);
		});
	});

	describe('sqlite', () => {
		it('drops the backing index for a unique (no DROP CONSTRAINT)', async () => {
			const { knex, emitted } = makeCompilingKnex('sqlite3');

			const helper = new SchemaHelperSQLite(knex);

			await helper.dropUniqueIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'drop index if exists `articles_slug_unique`',
			]);
		});

		it('drops an index via DROP INDEX IF EXISTS', async () => {
			const { knex, emitted } = makeCompilingKnex('sqlite3');

			const helper = new SchemaHelperSQLite(knex);

			await helper.dropIndexIfExists(knex, COLLECTION, FIELD);

			expect(emitted).toEqual([
				'drop index if exists `articles_slug_index`',
			]);
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
