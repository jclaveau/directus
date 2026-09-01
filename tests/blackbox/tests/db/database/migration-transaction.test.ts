import config, { paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { spawnSync } from 'child_process';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Staged in an extensions path of this run's own, so the versions below are
 * required of nothing else in the suite. `directus database migrate:latest` picks
 * them up alongside the core migrations, which are already applied on the shared
 * database, so these are the only two that run.
 */
const CREATES_TABLE = `export async function up(knex) {
	await knex.schema.createTable('blackbox_migration_probe', (table) => {
		table.integer('id');
	});
}
export async function down(knex) {
	await knex.schema.dropTableIfExists('blackbox_migration_probe');
}
`;

const THROWS = `export async function up() {
	throw new Error('blackbox migration failure');
}
export async function down() {}
`;

describe('database migrations', () => {
	const databases = new Map<Vendor, Knex>();
	const directories = {} as Record<Vendor, string>;
	const envs = {} as { [vendor: string]: Env };

	beforeAll(async () => {
		for (const vendor of vendors) {
			databases.set(vendor, knex(config.knexConfig[vendor]!));

			const directory = await mkdtemp(join(tmpdir(), 'directus-blackbox-migrate-'));
			await mkdir(join(directory, 'migrations'));
			directories[vendor] = directory;

			const env = cloneDeep(config.envs) as { [vendor: string]: Env };
			env[vendor]['EXTENSIONS_PATH'] = directory;
			env[vendor]['MIGRATIONS_PATH'] = join(directory, 'migrations');
			envs[vendor] = env;
		}
	}, 180_000);

	afterAll(async () => {
		for (const [vendor, connection] of databases) {
			await connection.schema.dropTableIfExists('blackbox_migration_probe');

			await connection('directus_migrations')
				.whereIn('version', ['20990101A', '20990102A'])
				.delete();

			await connection.destroy();
			await rm(directories[vendor]!, { recursive: true, force: true });
		}
	});

	function migrate(vendor: Vendor) {
		return spawnSync('node', [paths.cli, 'database', 'migrate:latest'], {
			cwd: paths.cwd,
			env: envs[vendor]![vendor],
			encoding: 'utf8',
		});
	}

	describe('when a migration fails', () => {
		it.each(vendors)('%s leaves no trace of either migration', async (vendor) => {
			const directory = join(directories[vendor]!, 'migrations');
			await writeFile(join(directory, '20990101A-creates-table.js'), CREATES_TABLE);
			await writeFile(join(directory, '20990102A-throws.js'), THROWS);

			expect(migrate(vendor).status).not.toBe(0);

			const connection = databases.get(vendor)!;

			const applied = await connection('directus_migrations')
				.whereIn('version', ['20990101A', '20990102A'])
				.select('version');

			// MariaDB has no transactional DDL — every statement implicit-commits
			// either side of itself — so the table survives there. The version row
			// still rolls back, which is what stops the runner believing the
			// migration was applied.
			expect(await connection.schema.hasTable('blackbox_migration_probe'))
				.toBe(vendor === 'maria');

			expect(applied).toEqual([]);
		});
	});

	describe('when every migration succeeds', () => {
		it.each(vendors)('%s applies it and records its version', async (vendor) => {
			const directory = join(directories[vendor]!, 'migrations');
			await rm(join(directory, '20990102A-throws.js'), { force: true });

			// MariaDB kept the table from the rolled-back run above; drop it so this
			// case proves the migration created it rather than inheriting it.
			await databases
				.get(vendor)!
				.schema.dropTableIfExists('blackbox_migration_probe');

			await writeFile(join(directory, '20990101A-creates-table.js'), CREATES_TABLE);

			expect(migrate(vendor).status).toBe(0);

			const connection = databases.get(vendor)!;

			const applied = await connection('directus_migrations')
				.whereIn('version', ['20990101A', '20990102A'])
				.select('version');

			expect(await connection.schema.hasTable('blackbox_migration_probe'))
				.toBe(true);

			expect(applied).toEqual([{ version: '20990101A' }]);
		});
	});
});
