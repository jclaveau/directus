import config, { paths, type Env } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { spawnSync } from 'child_process';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const MIGRATION_VERSIONS = ['20261125A', '20261125B'];

const postgresVendors = ['postgres', 'postgres10'];

const feature = loadFeature(
	'./tests/db/database/relational-alias-migration.feature',
);

describe.each(vendors)('%s', (vendor) => {
	let database: Knex;

	beforeAll(async () => {
		database = knex(config.knexConfig[vendor]!);

		// The foreign key refuses the unnamed alias this scenario seeds.
		if (postgresVendors.includes(vendor)) {
			await database.raw(
				'alter table directus_fields drop column if exists relation_alias',
			);
		}
	});

	afterAll(async () => {
		await database('directus_relations')
			.where({ one_collection: 'migration_owner' })
			.delete();

		await database('directus_fields')
			.where({ collection: 'migration_owner' })
			.delete();

		await database.destroy();
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'an o2m alias no relation names is deleted, a named one is kept',
			({ given, and, when, then }) => {
				given(
					'the rows of directus_fields:',
					async (fieldRows: Record<string, string>[]) => {
						await database('directus_fields').insert(fieldRows);
					},
				);

				and(
					'the rows of directus_relations:',
					async (relationRows: Record<string, string>[]) => {
						await database('directus_relations').insert(relationRows);
					},
				);

				when(
					'the migration deleting the unnamed relational aliases is run again',
					async () => {
						await database('directus_migrations')
							.whereIn('version', MIGRATION_VERSIONS)
							.delete();

						if (postgresVendors.includes(vendor)) {
							await database.raw(
								'alter table directus_relations'
								+ ' drop constraint if exists relations_one_field_unique',
							);
						}

						const migrationRun = spawnSync(
							'node',
							[paths.cli, 'database', 'migrate:latest'],
							{
								cwd: paths.cwd,
								env: (config.envs as Record<string, Env>)[vendor],
								encoding: 'utf8',
							},
						);

						expect(migrationRun.status, migrationRun.stderr).toEqual(0);
					},
				);

				then(
					'directus_fields holds for migration_owner:',
					async (fieldRows: { field: string }[]) => {
						await expect(database('directus_fields')
							.select('field')
							.where({ collection: 'migration_owner' })
							.orderBy('field'))
							.resolves.toEqual(fieldRows);
					},
				);
			},
			60_000,
		);
	});
});
