import { orderBy } from "../../utils/lodash-es-used.js";
import { useLogger } from "../../logger/index.js";
import { getHelpers } from "../helpers/index.js";
import { listMigrations } from "./list.js";
import { getDatabaseClient } from "../index.js";
import { flushCaches } from "../../cache.js";

//#region src/database/migrations/run.ts
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
async function run(database, direction, log = true, options = {}) {
	const logger = useLogger();
	const listedMigrations = await listMigrations(options.extensionMigrations);
	const completedMigrations = await database.select("*").from("directus_migrations").orderBy("version");
	const completedVersions = new Set(completedMigrations.map((migration) => migration.version));
	const pendingMigrations = listedMigrations.filter((migration) => options.phase === void 0 || migration.phase === options.phase).filter((migration) => !completedVersions.has(migration.version));
	if (direction === "up") await up();
	if (direction === "down") await down();
	if (direction === "latest") await latest();
	async function up() {
		const nextVersion = pendingMigrations[0];
		if (!nextVersion) throw Error("Nothing to upgrade");
		if (options.phase === void 0 && nextVersion.phase === "after-schema") throw new Error(`Migration ${JSON.stringify(nextVersion.version)} runs after the schema: run "migrate:latest --snapshot <path>" instead`);
		const migrationModule = await nextVersion.loadModule();
		if (log) logger.info(`Applying ${nextVersion.name}...`);
		if (wrapsInTransaction(migrationModule, nextVersion.file)) await withTransaction(async (trx) => {
			await applyUp(migrationModule, nextVersion, trx);
		});
		else await applyUp(migrationModule, nextVersion, database);
		await flushCaches(true);
	}
	async function down() {
		const runOrder = (completed) => {
			const index = listedMigrations.findIndex((listedMigration) => listedMigration.version === completed.version);
			return index === -1 ? listedMigrations.length : index;
		};
		const lastAppliedMigration = orderBy(completedMigrations, ["timestamp", runOrder], ["desc", "desc"])[0];
		if (!lastAppliedMigration) throw Error("Nothing to downgrade");
		const migration = listedMigrations.find((listedMigration) => listedMigration.version === lastAppliedMigration.version);
		if (!migration) throw new Error(describeMissingMigration(lastAppliedMigration.version));
		const migrationModule = await migration.loadModule();
		if (!migrationModule.down) logger.warn(`Couldn't find the "down" function from migration ${migration.file}`);
		if (log) logger.info(`Undoing ${migration.name}...`);
		async function revert(connection) {
			await migrationModule.down(connection);
			await connection("directus_migrations").delete().where({ version: migration.version });
		}
		if (wrapsInTransaction(migrationModule, migration.file)) await withTransaction(revert);
		else await revert(database);
		await flushCaches(true);
	}
	async function latest() {
		const pending = pendingMigrations;
		if (pending.length === 0) return;
		const batches = clientWrapsMigrations();
		let batch;
		let committed = false;
		try {
			for (const migration of pending) {
				const migrationModule = await migration.loadModule();
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
					await withTransaction(async (trx) => {
						await applyUp(migrationModule, migration, trx);
					});
					committed = true;
				} else {
					if (!batch) {
						batch = await database.transaction();
						await relaxTimeouts(batch);
					}
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
	/**
	* A migration's transaction is the only place its timeouts can be told apart
	* from a request's — it connects as the same role, to the same database — and
	* only a dialect knows how to say so. Migrations declaring
	* `transactionScope: 'none'` open no transaction and so keep the server's.
	*/
	async function relaxTimeouts(trx) {
		let helpers;
		try {
			helpers = getHelpers(database);
		} catch {
			return;
		}
		await helpers.schema.relaxMigrationTimeouts(trx);
	}
	async function withTransaction(work) {
		await database.transaction(async (trx) => {
			await relaxTimeouts(trx);
			await work(trx);
		});
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
	async function applyUp(migrationModule, migration, connection) {
		if (!migrationModule.up) logger.warn(`Couldn't find the "up" function from migration ${migration.file}`);
		await migrationModule.up(connection);
		await connection.insert({
			version: migration.version,
			name: migration.name
		}).into("directus_migrations");
	}
}
/**
* A bundle's migration is versioned `<bundle>:<date>`, so a row the list does
* not hold names the bundle that applied it.
*/
function describeMissingMigration(version) {
	const separatorIndex = String(version).lastIndexOf(":");
	if (separatorIndex === -1) return "Couldn't find migration";
	const bundleName = version.slice(0, separatorIndex);
	return `Migration ${JSON.stringify(version)} was applied by ${JSON.stringify(bundleName)}, which is not installed`;
}

//#endregion
export { run as default };