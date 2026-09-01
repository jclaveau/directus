import { useEnv } from '@directus/env';
import formatTitle from '@directus/format-title';
import fse from 'fs-extra';
import type { Knex } from 'knex';
import { orderBy } from 'lodash-es';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { flushCaches } from '../../cache.js';
import { useLogger } from '../../logger/index.js';
import type { DatabaseClient } from '@directus/types';
import type { Migration, MigrationTransactionScope } from '../../types/index.js';
import { getDatabaseClient } from '../index.js';
import getModuleDefault from '../../utils/get-module-default.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Only Postgres both rolls DDL back and tolerates the runner holding a transaction
 * open across a whole run.
 *
 * SQLite cannot: its alter-table rebuild runs under an outer transaction as a
 * savepoint, and the rebuild invalidates it — `20240204A-marketplace` leaves a
 * savepoint the next migration fails to release. MySQL-family DDL implicit-commits
 * either side of every statement, so a wrap there buys nothing to begin with.
 *
 * Everywhere else the runner behaves exactly as it always did.
 */
const TRANSACTIONAL_CLIENTS: DatabaseClient[] = ['postgres', 'cockroachdb'];

type MigrationModule = {
	up: (knex: Knex) => Promise<void>;
	down: (knex: Knex) => Promise<void>;
	transactionScope?: MigrationTransactionScope;
};

export default async function run(database: Knex, direction: 'up' | 'down' | 'latest', log = true): Promise<void> {
	const env = useEnv();
	const logger = useLogger();

	let migrationFiles = await fse.readdir(__dirname);

	const customMigrationsPath = path.resolve(env['MIGRATIONS_PATH'] as string);

	let customMigrationFiles =
		((await fse.pathExists(customMigrationsPath)) && (await fse.readdir(customMigrationsPath))) || [];

	migrationFiles = migrationFiles.filter((file: string) => /^[0-9]+[A-Z]-[^.]+\.(?:js|ts)$/.test(file));

	customMigrationFiles = customMigrationFiles.filter((file: string) => file.includes('-') && /\.(c|m)?js$/.test(file));

	const completedMigrations = await database.select<Migration[]>('*').from('directus_migrations').orderBy('version');

	const migrations = [
		...migrationFiles.map((path) => parseFilePath(path)),
		...customMigrationFiles.map((path) => parseFilePath(path, true)),
	].sort((a, b) => (a.version! > b.version! ? 1 : -1));

	const migrationKeys = new Set(migrations.map((m) => m.version));

	if (migrations.length > migrationKeys.size) {
		const filesByVersion = new Map<string, string[]>();

		for (const migration of migrations) {
			const files = filesByVersion.get(migration.version!) ?? [];
			files.push(migration.file);
			filesByVersion.set(migration.version!, files);
		}

		const collisions = [...filesByVersion]
			.filter(([, files]) => files.length > 1)
			.map(([version, files]) => `\t- "${version}": ${files.join(', ')}`)
			.join('\n');

		throw new Error(`Migration keys collide! Please ensure that every migration uses a unique key:\n${collisions}`);
	}

	function parseFilePath(filePath: string, custom = false) {
		const version = filePath.split('-')[0];
		const name = formatTitle(filePath.split('-').slice(1).join('_').split('.')[0]!);
		const completed = !!completedMigrations.find((migration) => migration.version === version);

		return {
			file: custom ? path.join(customMigrationsPath, filePath) : path.join(__dirname, filePath),
			version,
			name,
			completed,
		};
	}

	if (direction === 'up') await up();
	if (direction === 'down') await down();
	if (direction === 'latest') await latest();

	async function up() {
		const currentVersion = completedMigrations[completedMigrations.length - 1];

		let nextVersion: any;

		if (!currentVersion) {
			nextVersion = migrations[0];
		}
		else {
			nextVersion = migrations.find((migration) => {
				return migration.version! > currentVersion.version && migration.completed === false;
			});
		}

		if (!nextVersion) {
			throw Error('Nothing to upgrade');
		}

		const migrationModule = await loadMigration(nextVersion.file);

		if (log) {
			logger.info(`Applying ${nextVersion.name}...`);
		}

		if (wrapsInTransaction(migrationModule)) {
			await database.transaction(async (trx) => {
				await applyUp(migrationModule, nextVersion, trx);
			});
		}
		else {
			await applyUp(migrationModule, nextVersion, database);
		}

		await flushCaches(true);
	}

	async function down() {
		const lastAppliedMigration = orderBy(completedMigrations, ['timestamp', 'version'], ['desc', 'desc'])[0];

		if (!lastAppliedMigration) {
			throw Error('Nothing to downgrade');
		}

		const migration = migrations.find((migration) => migration.version === lastAppliedMigration.version);

		if (!migration) {
			throw new Error("Couldn't find migration");
		}

		const migrationModule = await loadMigration(migration.file);

		if (!migrationModule.down) {
			logger.warn(`Couldn't find the "down" function from migration ${migration.file}`);
		}

		if (log) {
			logger.info(`Undoing ${migration.name}...`);
		}

		async function revert(connection: Knex) {
			await migrationModule.down(connection);

			await connection('directus_migrations')
				.delete()
				.where({ version: migration!.version });
		}

		if (wrapsInTransaction(migrationModule)) {
			await database.transaction(revert);
		}
		else {
			await revert(database);
		}

		await flushCaches(true);
	}

	async function latest() {
		const pending = migrations.filter((migration) => migration.completed === false);

		if (pending.length === 0) {
			return;
		}

		const batches = clientWrapsMigrations();

		let batch: Knex.Transaction | undefined;

		try {
			for (const migration of pending) {
				const migrationModule = await loadMigration(migration.file);

				const scope = batches
					? migrationModule.transactionScope ?? 'batch'
					: 'none';

				if (scope !== 'batch' && batch) {
					// An escaping migration has to see everything before it, so the
					// open segment commits here and stops being able to roll back.
					await batch.commit();
					batch = undefined;

					logger.warn(
						`${migration.name} declares transactionScope "${scope}", so the`
							+ ` migrations applied before it in this run are now committed`
							+ ` and will not roll back if a later one fails.`,
					);
				}

				if (log) {
					logger.info(`Applying ${migration.name}...`);
				}

				if (scope === 'none') {
					await applyUp(migrationModule, migration, database);
				}
				else if (scope === 'own') {
					await database.transaction(async (trx) => {
						await applyUp(migrationModule, migration, trx);
					});
				}
				else {
					batch ??= await database.transaction();
					await applyUp(migrationModule, migration, batch);
				}
			}

			await batch?.commit();
		}
		catch (error) {
			if (batch && !batch.isCompleted()) {
				await batch.rollback();
			}

			throw error;
		}

		await flushCaches(true);
	}

	function wrapsInTransaction(migrationModule: MigrationModule): boolean {
		if (!clientWrapsMigrations()) {
			return false;
		}

		return (migrationModule.transactionScope ?? 'batch') !== 'none';
	}

	function clientWrapsMigrations(): boolean {
		try {
			return TRANSACTIONAL_CLIENTS.includes(getDatabaseClient(database));
		}
		catch {
			// `getDatabaseClient` throws on a connection it cannot name. Whatever that
			// is, it has not been shown to survive a run-long transaction, so it runs
			// the way it did before this guard existed.
			return false;
		}
	}

	async function loadMigration(file: string): Promise<MigrationModule> {
		return getModuleDefault<MigrationModule>(await import(`file://${file}`));
	}

	async function applyUp(
		migrationModule: MigrationModule,
		migration: ReturnType<typeof parseFilePath>,
		connection: Knex,
	) {
		if (!migrationModule.up) {
			logger.warn(
				`Couldn't find the "up" function from migration ${migration.file}`,
			);
		}

		await migrationModule.up(connection);

		await connection
			.insert({ version: migration.version, name: migration.name })
			.into('directus_migrations');
	}
}
