import type { Knex } from 'knex';
import { describe, expect, test, vi } from 'vitest';
import { SchemaHelperOracle } from './oracle.js';

vi.mock('../../index.js', () => ({
	getDatabaseClient: vi.fn(),
}));

describe('SchemaHelperOracle', () => {
	function createHelper() {
		const mockKnex = { raw: vi.fn() } as unknown as Knex;
		const helper = new SchemaHelperOracle(mockKnex);
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

	test('createIndex creates an online index when attemptConcurrentIndex is true', async () => {
		const { helper, mockKnex } = createHelper();
		await helper.createIndex('orders', 'status', { attemptConcurrentIndex: true });

		// Oracle uses ONLINE instead of CONCURRENTLY
		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE INDEX ?? ON ?? (??) ONLINE', [
			'orders_status_index',
			'orders',
			'status',
		]);
	});

	test('createIndex creates an online unique index when both options are true', async () => {
		const { helper, mockKnex } = createHelper();
		await helper.createIndex('users', 'username', { attemptConcurrentIndex: true, unique: true });

		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE UNIQUE INDEX ?? ON ?? (??) ONLINE', [
			'users_username_unique',
			'users',
			'username',
		]);
	});

	test('createIndex creates an online standard index when attemptConcurrentIndex is true and unique is false', async () => {
		const { helper, mockKnex } = createHelper();
		await helper.createIndex('posts', 'author_id', { attemptConcurrentIndex: true, unique: false });

		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE INDEX ?? ON ?? (??) ONLINE', [
			'posts_author_id_index',
			'posts',
			'author_id',
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

	test('createIndex works with different collection and field names', async () => {
		const { helper, mockKnex } = createHelper();
		await helper.createIndex('my_custom_table', 'my_custom_column');

		expect(mockKnex.raw).toHaveBeenCalledWith('CREATE INDEX ?? ON ?? (??)', [
			'my_custom_table_my_custom_column_index',
			'my_custom_table',
			'my_custom_column',
		]);
	});

	describe('drop ... ifExists (catalog-gated, no native IF EXISTS on oracle)', () => {
		function makeKnex(indexRow: unknown) {
			const first = vi.fn().mockResolvedValue(indexRow);
			const qb = { select: vi.fn(), from: vi.fn(), where: vi.fn(), first };
			qb.select.mockReturnValue(qb);
			qb.from.mockReturnValue(qb);
			qb.where.mockReturnValue(qb);
			const table = { dropIndex: vi.fn(), dropUnique: vi.fn() };
			const alterTable = vi.fn(async (_table: string, cb: (t: typeof table) => void) => cb(table));
			const knex = { select: qb.select, schema: { alterTable } } as unknown as Knex;
			return { knex, table, alterTable };
		}

		test('dropIndexIfExists drops the index when user_indexes lists it', async () => {
			const { helper } = createHelper();
			const { knex, table } = makeKnex({ index_name: 'users_email_index' });

			await helper.dropIndexIfExists(knex, 'users', 'email');

			expect(table.dropIndex).toHaveBeenCalledWith(['email'], 'users_email_index');
		});

		test('dropIndexIfExists is a no-op when the index is missing', async () => {
			const { helper } = createHelper();
			const { knex, alterTable } = makeKnex(undefined);

			await helper.dropIndexIfExists(knex, 'users', 'email');

			expect(alterTable).not.toHaveBeenCalled();
		});

		test('dropUniqueIfExists drops the unique constraint when it exists', async () => {
			const { helper } = createHelper();
			const { knex, table } = makeKnex({ index_name: 'users_email_unique' });

			await helper.dropUniqueIfExists(knex, 'users', 'email');

			expect(table.dropUnique).toHaveBeenCalledWith(['email'], 'users_email_unique');
		});

		test('dropUniqueIfExists is a no-op when the constraint is missing', async () => {
			const { helper } = createHelper();
			const { knex, alterTable } = makeKnex(undefined);

			await helper.dropUniqueIfExists(knex, 'users', 'email');

			expect(alterTable).not.toHaveBeenCalled();
		});
	});
});
