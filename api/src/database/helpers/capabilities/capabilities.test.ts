import type { FieldOverview } from '@directus/types';
import type { Knex } from 'knex';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CapabilitiesHelperDefault } from './dialects/default.js';
import { CapabilitiesHelperMSSQL } from './dialects/mssql.js';
import { CapabilitiesHelperMySQL } from './dialects/mysql.js';
import { CapabilitiesHelperOracle } from './dialects/oracle.js';
import { CapabilitiesHelperPostgres } from './dialects/postgres.js';
import { CapabilitiesHelperSqlite } from './dialects/sqlite.js';

// vitest hoists vi.hoisted + vi.mock above the imports above, so @directus/env is
// mocked before mssql.ts captures useEnv() at module load.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, unknown> }));

vi.mock('@directus/env', () => ({
	useEnv: () => mockEnv,
}));

const noKnex = {} as unknown as Knex;

function field(overrides: Partial<FieldOverview>): FieldOverview {
	return { nullable: true, defaultValue: null, ...overrides } as FieldOverview;
}

describe('CapabilitiesHelper (default)', () => {
	const helper = new CapabilitiesHelperDefault(noKnex);

	test('does not support column position in GROUP BY', () => {
		expect(helper.supportsColumnPositionInGroupBy()).toBe(false);
	});

	test('supports deduplication of parameters', () => {
		expect(helper.supportsDeduplicationOfParameters()).toBe(true);
	});

	test('does not preserve insert order in RETURNING', async () => {
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(false);
	});

	test('padRowsForBatchInsert is a no-op', () => {
		const rows = [{ id: 1 }, { id: 2 }];
		expect(helper.padRowsForBatchInsert(rows, { fields: {}, primaryKeyField: 'id' })).toBe(rows);
	});

	test('insertReturningOptions is undefined', () => {
		expect(helper.insertReturningOptions()).toBeUndefined();
	});
});

describe('CapabilitiesHelperPostgres', () => {
	const helper = new CapabilitiesHelperPostgres(noKnex);

	test('supports column position in GROUP BY', () => {
		expect(helper.supportsColumnPositionInGroupBy()).toBe(true);
	});

	test('does not support deduplication of parameters', () => {
		expect(helper.supportsDeduplicationOfParameters()).toBe(false);
	});

	test('preserves insert order in RETURNING', async () => {
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(true);
	});
});

describe('CapabilitiesHelperMySQL', () => {
	const helper = new CapabilitiesHelperMySQL(noKnex);

	test('supports column position in GROUP BY', () => {
		expect(helper.supportsColumnPositionInGroupBy()).toBe(true);
	});

	test('does not preserve insert order in RETURNING', async () => {
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(false);
	});
});

describe('CapabilitiesHelperOracle', () => {
	const helper = new CapabilitiesHelperOracle(noKnex);

	test('preserves insert order in RETURNING', async () => {
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(true);
	});
});

describe('CapabilitiesHelperMSSQL', () => {
	const helper = new CapabilitiesHelperMSSQL(noKnex);

	afterEach(() => {
		delete mockEnv['DB_MSSQL_TRUST_BATCH_RETURNING'];
	});

	test('preserves insert order only when DB_MSSQL_TRUST_BATCH_RETURNING is set', async () => {
		mockEnv['DB_MSSQL_TRUST_BATCH_RETURNING'] = true;
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(true);

		mockEnv['DB_MSSQL_TRUST_BATCH_RETURNING'] = false;
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(false);
	});

	test('always requests trigger modifications on the per-row insert', () => {
		expect(helper.insertReturningOptions()).toEqual({ includeTriggerModifications: true });
	});
});

describe('CapabilitiesHelperSqlite', () => {
	function createHelper(version: string) {
		const first = vi.fn().mockResolvedValue({ version });
		const select = vi.fn().mockReturnValue({ first });
		const mockKnex = { raw: vi.fn(), select } as unknown as Knex;
		return { helper: new CapabilitiesHelperSqlite(mockKnex), select };
	}

	test('preserves insert order on SQLite >= 3.35 (RETURNING support)', async () => {
		const { helper } = createHelper('3.45.1');
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(true);
	});

	test('does not preserve insert order on SQLite < 3.35', async () => {
		const { helper } = createHelper('3.34.0');
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(false);
	});

	test('treats a missing version row as unsupported', async () => {
		const first = vi.fn().mockResolvedValue(undefined);
		const mockKnex = { raw: vi.fn(), select: vi.fn().mockReturnValue({ first }) } as unknown as Knex;
		const helper = new CapabilitiesHelperSqlite(mockKnex);
		await expect(helper.preservesInsertOrderInReturning()).resolves.toBe(false);
	});

	test('probes the SQLite version only once and caches the result', async () => {
		const { helper, select } = createHelper('3.45.1');
		await helper.preservesInsertOrderInReturning();
		await helper.preservesInsertOrderInReturning();
		expect(select).toHaveBeenCalledTimes(1);
	});

	test('pads non-nullable fields with their defaults, keeping explicit row values', () => {
		const { helper } = createHelper('3.45.1');

		const rows = [{ title: 'set' }, {}];

		const padded = helper.padRowsForBatchInsert(rows as Record<string, unknown>[], {
			primaryKeyField: 'id',
			fields: {
				id: field({ nullable: false, defaultValue: 0 }),
				title: field({ nullable: false, defaultValue: 'untitled' }),
				note: field({ nullable: true, defaultValue: null }),
			},
		});

		// id is the primary key -> never padded; title default fills the gap but the
		// explicit value wins; nullable note is left out entirely.
		expect(padded).toEqual([{ title: 'set' }, { title: 'untitled' }]);
		expect('id' in padded[1]!).toBe(false);
		expect('note' in padded[1]!).toBe(false);
	});
});
