import config from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { createInspector, type SchemaOverview } from '@directus/schema';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const INSPECTED_TABLE = 'unique_index_columns';

const postgresVendors = ['postgres', 'postgres10'];

const feature = loadFeature('./tests/db/schema/unique-index-columns.feature');

describe.each(vendors)('%s', (vendor) => {
	describe.runIf(postgresVendors.includes(vendor))('overview', () => {
		let database: Knex;

		beforeAll(async () => {
			database = knex(config.knexConfig[vendor]!);
			await database.schema.dropTableIfExists(INSPECTED_TABLE);
		});

		afterAll(async () => {
			await database.schema.dropTableIfExists(INSPECTED_TABLE);
			await database.destroy();
		});

		defineFeature(feature, (scenario) => {
			scenario(
				'only the columns of a plain unique index are flagged',
				({ given, and, when, then }) => {
					let schemaOverview: SchemaOverview;

					given('a table with:', async (docString: string) => {
						await database.raw(
							`create table ${INSPECTED_TABLE} (${docString})`,
						);
					});

					and('the unique indexes:', async (docString: string) => {
						await database.raw(docString);
					});

					when('the overview of the schema is read', async () => {
						schemaOverview = await createInspector(database).overview();
					});

					then(
						'the table\'s columns answer:',
						(table: { column: string, in_unique_index: string }[]) => {
							// an empty cell is a column the overview leaves unflagged
							expect(schemaOverview[INSPECTED_TABLE]!.columns)
								.toMatchObject(Object.fromEntries(table.map((row) => {
									return [row.column, {
										column_name: row.column,
										in_unique_index: row.in_unique_index === 'true'
											? true
											: undefined,
									}];
								})));
						},
					);
				},
			);
		});
	});
});
