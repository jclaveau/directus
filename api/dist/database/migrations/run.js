import { useLogger } from "../../logger/index.js";
import { getDatabaseClient } from "../index.js";
import { flushCaches } from "../../cache.js";
import getModuleDefault from "../../utils/get-module-default.js";
import { useEnv } from "@directus/env";
import { orderBy } from "lodash-es";
import path from "path";
import { fileURLToPath } from "node:url";
import fse from "fs-extra";
import { dirname } from "node:path";
import formatTitle from "@directus/format-title";

//#region src/database/migrations/run.ts
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
const TRANSACTIONAL_CLIENTS = ["postgres", "cockroachdb"];
async function run(database, direction, log = true) {
	const env = useEnv();
	const logger = useLogger();
	let migrationFiles = await fse.readdir(__dirname);
	const customMigrationsPath = path.resolve(env["MIGRATIONS_PATH"]);
	let customMigrationFiles = await fse.pathExists(customMigrationsPath) && await fse.readdir(customMigrationsPath) || [];
	migrationFiles = migrationFiles.filter((file) => /^[0-9]+[A-Z]-[^.]+\.(?:js|ts)$/.test(file));
	customMigrationFiles = customMigrationFiles.filter((file) => file.includes("-") && /\.(c|m)?js$/.test(file));
	const completedMigrations = await database.select("*").from("directus_migrations").orderBy("version");
	const migrations = [...migrationFiles.map((path$2) => parseFilePath(path$2)), ...customMigrationFiles.map((path$2) => parseFilePath(path$2, true))].sort((a, b) => a.version > b.version ? 1 : -1);
	const migrationKeys = new Set(migrations.map((m) => m.version));
	if (migrations.length > migrationKeys.size) {
		const filesByVersion = /* @__PURE__ */ new Map();
		for (const migration of migrations) {
			const files = filesByVersion.get(migration.version) ?? [];
			files.push(migration.file);
			filesByVersion.set(migration.version, files);
		}
		const collisions = [...filesByVersion].filter(([, files]) => files.length > 1).map(([version, files]) => `\t- "${version}": ${files.join(", ")}`).join("\n");
		throw new Error(`Migration keys collide! Please ensure that every migration uses a unique key:\n${collisions}`);
	}
	function parseFilePath(filePath, custom = false) {
		const version = filePath.split("-")[0];
		const name = formatTitle(filePath.split("-").slice(1).join("_").split(".")[0]);
		const completed = !!completedMigrations.find((migration) => migration.version === version);
		return {
			file: custom ? path.join(customMigrationsPath, filePath) : path.join(__dirname, filePath),
			version,
			name,
			completed
		};
	}
	if (direction === "up") await up();
	if (direction === "down") await down();
	if (direction === "latest") await latest();
	async function up() {
		const currentVersion = completedMigrations[completedMigrations.length - 1];
		let nextVersion;
		if (!currentVersion) nextVersion = migrations[0];
		else nextVersion = migrations.find((migration) => {
			return migration.version > currentVersion.version && migration.completed === false;
		});
		if (!nextVersion) throw Error("Nothing to upgrade");
		const migrationModule = await loadMigration(nextVersion.file);
		if (log) logger.info(`Applying ${nextVersion.name}...`);
		if (wrapsInTransaction(migrationModule, nextVersion.file)) await database.transaction(async (trx) => {
			await applyUp(migrationModule, nextVersion, trx);
		});
		else await applyUp(migrationModule, nextVersion, database);
		await flushCaches(true);
	}
	async function down() {
		const lastAppliedMigration = orderBy(completedMigrations, ["timestamp", "version"], ["desc", "desc"])[0];
		if (!lastAppliedMigration) throw Error("Nothing to downgrade");
		const migration = migrations.find((migration$1) => migration$1.version === lastAppliedMigration.version);
		if (!migration) throw new Error("Couldn't find migration");
		const migrationModule = await loadMigration(migration.file);
		if (!migrationModule.down) logger.warn(`Couldn't find the "down" function from migration ${migration.file}`);
		if (log) logger.info(`Undoing ${migration.name}...`);
		async function revert(connection) {
			await migrationModule.down(connection);
			await connection("directus_migrations").delete().where({ version: migration.version });
		}
		if (wrapsInTransaction(migrationModule, migration.file)) await database.transaction(revert);
		else await revert(database);
		await flushCaches(true);
	}
	async function latest() {
		const pending = migrations.filter((migration) => migration.completed === false);
		if (pending.length === 0) return;
		const batches = clientWrapsMigrations();
		let batch;
		let committed = false;
		try {
			for (const migration of pending) {
				const migrationModule = await loadMigration(migration.file);
				const declared = declaredScope(migrationModule, migration.file);
				const scope = batches ? declared : "none";
				if (scope !== "batch" && batch) {
					await batch.commit();
					batch = void 0;
					committed = true;
					logger.warn(`${migration.name} declares transactionScope "${scope}", so the migrations applied before it in this run are now committed and will not roll back if a later one fails.`);
				}
				if (log) logger.info(`Applying ${migration.name}...`);
				if (scope === "none") {
					await applyUp(migrationModule, migration, database);
					committed = true;
				} else if (scope === "own") {
					await database.transaction(async (trx) => {
						await applyUp(migrationModule, migration, trx);
					});
					committed = true;
				} else {
					batch ??= await database.transaction();
					await applyUp(migrationModule, migration, batch);
				}
			}
			await batch?.commit();
		} catch (error) {
			if (batch && !batch.isCompleted()) await batch.rollback();
			if (committed) await flushCaches(true).catch((flushError) => {
				logger.error(flushError, "Could not flush caches after a failed run");
			});
			throw error;
		}
		await flushCaches(true);
	}
	function wrapsInTransaction(migrationModule, file) {
		if (!clientWrapsMigrations()) return false;
		return declaredScope(migrationModule, file) !== "none";
	}
	/**
	* A migration is loaded through `import()`, so its exports reach us as `any` and
	* the type on `transactionScope` proves nothing. An unknown value would otherwise
	* fall through to the batch branch — wrapping the very migrations that declared
	* they must not be.
	*/
	function declaredScope(migrationModule, file) {
		const scope = migrationModule.transactionScope ?? "batch";
		if (scope !== "batch" && scope !== "own" && scope !== "none") throw new Error(`Migration ${file} declares an unknown transactionScope "${scope}". Expected "batch", "own" or "none".`);
		return scope;
	}
	function clientWrapsMigrations() {
		try {
			return TRANSACTIONAL_CLIENTS.includes(getDatabaseClient(database));
		} catch {
			return false;
		}
	}
	async function loadMigration(file) {
		return getModuleDefault(await import(`file://${file}`));
	}
	async function applyUp(migrationModule, migration, connection) {
		if (!migrationModule.up) logger.warn(`Couldn't find the "up" function from migration ${migration.file}`);
		await migrationModule.up(connection);
		await connection.insert({
			version: migration.version,
			name: migration.name
		}).into("directus_migrations");
	}
}

//#endregion
export { run as default };