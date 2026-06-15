import knex, { type Knex } from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { describe, expect, test, vi } from 'vitest';
import { SchemaHelperDefault } from './default.js';

vi.mock('../../index.js', () => ({
	getDatabaseClient: vi.fn(),
}));

describe('SchemaHelperDefault', () => {
	function createHelper() {
		const mockKnex = { raw: vi.fn() } as unknown as Knex;
		const helper = new SchemaHelperDefault(mockKnex);
		return { helper, mockKnex };
	}

	test('createIndex creates a standard index without options', async () => {
		const { helper, mockKnex } = createHelper();

		await helper.createIndex('users', 'email');

		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE INDEX ?? ON ?? (??)', ['users_email_index', 'users', 'email']);
	});

	test('createIndex creates a unique index when unique option is true', async () => {
		const { helper, mockKnex } = createHelper();

		await helper.createIndex('users', 'email', { unique: true });

		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE UNIQUE INDEX ?? ON ?? (??)', [
			'users_email_unique',
			'users',
			'email',
		]);
	});

	test('createIndex creates a standard index when unique option is false', async () => {
		const { helper, mockKnex } = createHelper();

		await helper.createIndex('products', 'sku', { unique: false });

		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE INDEX ?? ON ?? (??)', ['products_sku_index', 'products', 'sku']);
	});

	test('createIndex ignores attemptConcurrentIndex option', async () => {
		const { helper, mockKnex } = createHelper();

		await helper.createIndex('orders', 'status', { attemptConcurrentIndex: true });

		// Default implementation inherits from base SchemaHelper which doesn't support CONCURRENTLY
		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE INDEX ?? ON ?? (??)', [
			'orders_status_index',
			'orders',
			'status',
		]);
	});

	test('createIndex handles empty options object', async () => {
		const { helper, mockKnex } = createHelper();

		await helper.createIndex('categories', 'name', {});

		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE INDEX ?? ON ?? (??)', [
			'categories_name_index',
			'categories',
			'name',
		]);
	});

	describe('getColumnsWithInvalidCollation', () => {
		test('queries information_schema columns without dialect-specific exclusions', async () => {
			const db = knex.default({ client: MockClient });
			const tracker = createTracker(db);
			tracker.on.select('information_schema').response([]);
			const helper = new SchemaHelperDefault(db);

			await helper.getColumnsWithInvalidCollation('directus', 'utf8mb4_general_ci');

			const query = tracker.history.select.find((q) => q.sql.includes('information_schema'));

			expect(query?.sql).not.toMatch(/column_type/i);
			expect(query?.bindings).toEqual(expect.arrayContaining(['directus', 'utf8mb4_general_ci']));		});
	});

	describe('drop ... ifExists (redshift/default: plain knex drop, no existence check)', () => {
		function makeKnex() {
			const table = { dropIndex: vi.fn(), dropUnique: vi.fn() };
			const alterTable = vi.fn(async (_table: string, cb: (t: typeof table) => void) => cb(table));
			const knex = { schema: { alterTable } } as unknown as Knex;
			return { knex, table, alterTable };
		}

		test('dropUniqueIfExists drops the unique constraint unconditionally', async () => {
			const { helper } = createHelper();
			const { knex, table } = makeKnex();

			await helper.dropUniqueIfExists(knex, 'users', 'email');

			expect(table.dropUnique).toHaveBeenCalledWith(['email'], expect.stringMatching(/unique/));
		});

		test('dropIndexIfExists drops the index unconditionally', async () => {
			const { helper } = createHelper();
			const { knex, table } = makeKnex();

			await helper.dropIndexIfExists(knex, 'users', 'email');

			expect(table.dropIndex).toHaveBeenCalledWith(['email'], expect.stringMatching(/index/));
		});
	});
});
