import config from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { type Column, createInspector } from '@directus/schema';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const INSPECTED_TABLE = 'inspected_concurrent_drop';

const postgresVendors = ['postgres', 'postgres10'];

const feature = loadFeature(
	'./tests/db/schema/inspector-concurrent-drop.feature',
);

describe.each(vendors)('%s', (vendor) => {
	describe.runIf(postgresVendors.includes(vendor))('inspector', () => {
		let readingDatabase: Knex;
		let droppingDatabase: Knex;

		beforeAll(() => {
			readingDatabase = knex(config.knexConfig[vendor]!);
			droppingDatabase = knex(config.knexConfig[vendor]!);
		});

		afterAll(async () => {
			await droppingDatabase.schema.dropTableIfExists(INSPECTED_TABLE);
			await readingDatabase.destroy();
			await droppingDatabase.destroy();
		});

		defineFeature(feature, (scenario) => {
			scenario(
				'the columns of a table dropped after the snapshot are still read',
				({ given, and, when, then }) => {
					let snapshotTransaction: Knex.Transaction;
					let inspectedColumns: Column[];

					given(
						'a table with a serial primary key and a text column',
						async () => {
							await droppingDatabase.schema.createTable(
								INSPECTED_TABLE,
								(table) => {
									table.increments('id');
									table.text('label');
								},
							);
						},
					);

					and('a repeatable-read transaction took its snapshot', async () => {
						snapshotTransaction = await readingDatabase.transaction({
							isolationLevel: 'repeatable read',
						});

						await snapshotTransaction.raw('SELECT count(*) FROM pg_class');
					});

					and('another connection dropped the table', async () => {
						await droppingDatabase.schema.dropTable(INSPECTED_TABLE);
					});

					when(
						'the inspector reads the table\'s columns in the transaction',
						async () => {
							try {
								inspectedColumns = await createInspector(snapshotTransaction)
									.columnInfo(INSPECTED_TABLE);
							}
							finally {
								await snapshotTransaction.rollback();
							}
						},
					);

					then('it answers:', (table: Record<string, string>[]) => {
						expect(inspectedColumns).toMatchObject(parseGherkinTable(table));
					});
				},
			);
		});
	});
});
