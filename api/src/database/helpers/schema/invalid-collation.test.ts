import type { Knex } from 'knex';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Break the schema/types.ts -> database/index.ts -> schema/index.ts -> dialects circular import,
// which otherwise leaves SchemaHelper undefined when a dialect is imported directly under vitest.
vi.mock('../../index.js', () => ({ default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') }));

import { SchemaHelperMySQL } from './dialects/mysql.js';
import { SchemaHelperPostgres } from './dialects/postgres.js';

describe('getColumnsWithInvalidCollation', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
	});

	function columnsQuery() {
		return tracker.history.select.find((s) => /information_schema.*columns/i.test(s.sql));
	}

	it('base helper queries information_schema.columns with no dialect special-casing', async () => {
		tracker.on.select(/information_schema/i).response([]);

		const helper = new SchemaHelperPostgres(db);
		await helper.getColumnsWithInvalidCollation('mydb', 'utf8');

		const q = columnsQuery();
		expect(q).toBeDefined();
		// No VERSION() probe and no MariaDB longtext/utf8mb4_bin carve-out on the base path.
		expect(q!.sql.toLowerCase()).not.toContain('column_type');
	});

	it('mysql: reports columns whose collation differs from the DB default, no MariaDB carve-out', async () => {
		tracker.on.select(/version\(\)/i).response([{ version: '8.0.36' }]);

		tracker.on.select(/information_schema/i).response([{ table_name: 't', name: 'c', collation: 'latin1_swedish_ci' }]);

		const helper = new SchemaHelperMySQL(db);
		const rows = await helper.getColumnsWithInvalidCollation('mydb', 'utf8mb4_general_ci');

		expect(rows).toEqual([{ table_name: 't', name: 'c', collation: 'latin1_swedish_ci' }]);
		// Plain MySQL → no longtext/utf8mb4_bin exclusion.
		expect(columnsQuery()!.sql.toLowerCase()).not.toContain('column_type');
	});

	it('mariadb: excludes the expected longtext + utf8mb4_bin JSON pairing', async () => {
		tracker.on.select(/version\(\)/i).response([{ version: '10.11.6-MariaDB' }]);
		tracker.on.select(/information_schema/i).response([]);

		const helper = new SchemaHelperMySQL(db);
		await helper.getColumnsWithInvalidCollation('mydb', 'utf8mb4_general_ci');

		const sql = columnsQuery()!.sql.toLowerCase();
		const bindings = columnsQuery()!.bindings.map(String);
		// NOT(longtext AND utf8mb4_bin): a nested negated group on column_type + collation_name.
		expect(sql).toContain('column_type');
		expect(sql).toContain('not (');
		expect(bindings).toContain('longtext');
		expect(bindings).toContain('utf8mb4_bin');
	});
});
