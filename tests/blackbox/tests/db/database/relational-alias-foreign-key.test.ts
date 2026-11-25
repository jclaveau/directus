import config from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const postgresVendors = ['postgres', 'postgres10'];

const feature = loadFeature(
	'./tests/db/database/relational-alias-foreign-key.feature',
);

describe.each(vendors)('%s', (vendor) => {
	if (postgresVendors.includes(vendor) === false) {
		// TODO(#610): hold the relational aliases on the other dialects too.
		test.skip('the foreign key is held on Postgres only');
		return;
	}

	let database: Knex;

	beforeAll(async () => {
		database = knex(config.knexConfig[vendor]!);
	});

	afterAll(async () => {
		await database('directus_fields')
			.where({ collection: 'fk_owner' })
			.delete();

		await database('directus_relations')
			.where({ one_collection: 'fk_owner' })
			.delete();

		await database.destroy();
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'A — an o2m alias inserted by SQL with no relation naming it is refused',
			({ given, when, then, and }) => {
				let sqlRun: Promise<unknown>;

				given(
					'the rows of directus_relations:',
					async (relationRows: Record<string, string>[]) => {
						await database('directus_relations').insert(
							relationRows.map((relationRow) => {
								return {
									...relationRow,
									one_field: relationRow['one_field'] || null,
								};
							}),
						);
					},
				);

				when('this SQL is run:', (sqlRows: { sql: string }[]) => {
					sqlRun = database.raw(
						sqlRows.map((sqlRow) => sqlRow.sql).join(' '),
					);

					sqlRun.catch(() => undefined);
				});

				then(
					'the commit fails naming directus_fields_relation_alias_foreign',
					async () => {
						await expect(sqlRun).rejects.toMatchObject({
							constraint: 'directus_fields_relation_alias_foreign',
						});
					},
				);

				and(
					'directus_fields holds for fk_owner:',
					async (fieldRows: { field: string }[]) => {
						await expect(database('directus_fields')
							.select('field')
							.where({ collection: 'fk_owner' }))
							.resolves.toEqual(fieldRows);
					},
				);
			},
			60_000,
		);
	});
});
